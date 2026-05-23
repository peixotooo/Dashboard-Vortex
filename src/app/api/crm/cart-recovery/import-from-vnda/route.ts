import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { createAdminClient } from "@/lib/supabase-admin";
import { getVndaConfigForWorkspace } from "@/lib/coupons/vnda-coupons";
import {
  normalizeCart,
  validateAbandonedCartPayloadForImport,
} from "@/lib/cart-recovery/payload";
import type { VndaAbandonedCartPayload } from "@/lib/cart-recovery/types";

// Importa carrinhos abandonados das últimas N horas direto da API VNDA
// e injeta na régua de recuperação.
//
// Estratégia (a API VNDA tem limitações):
//   1. GET /api/v2/carts/?per_page=100&page=N — lista resumida (sem items,
//      sem client_id). Pagina até passar do cutoff por updated_at.
//   2. Pra cada cart com email e dentro da janela, GET /carts/{token}
//      pra puxar detalhes completos (items, client_id).
//   3. Constrói cart_url manualmente como https://{store_host}/carrinho/{token}
//      (o endpoint não retorna).
//   4. Upsert em abandoned_carts. Conflito por (workspace_id, vnda_cart_token)
//      → não duplica, atualiza. Status fica como estava (default 'open').
//
// Limites:
//   - Vercel maxDuration 60s → ~100 carts por execução (cada detail é ~300ms)
//   - Rate limit VNDA: sleep 150ms entre detail requests
//   - Carts sem email são pulados (não há como notificar)
//   - Carts já em status != 'open' (recovered/expired/closed) preservam status

export const maxDuration = 60;

function createSupabase(request: NextRequest) {
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll() {},
      },
    }
  );
}

interface VndaCartListItem {
  id: number;
  token: string;
  code: string;
  email: string | null;
  total: number;
  items_count: number;
  updated_at: string;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function vndaGet<T>(
  path: string,
  apiToken: string,
  storeHost: string
): Promise<T> {
  const res = await fetch(`https://api.vnda.com.br/api/v2/${path}`, {
    headers: {
      Authorization: `Bearer ${apiToken}`,
      Accept: "application/json",
      "X-Shop-Host": storeHost,
    },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`VNDA ${res.status} ${path}: ${text.slice(0, 200)}`);
  }
  return res.json();
}

export async function POST(request: NextRequest) {
  try {
    const supabase = createSupabase(request);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user)
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

    const workspaceId = request.headers.get("x-workspace-id") || "";
    if (!workspaceId)
      return NextResponse.json(
        { error: "Workspace not specified" },
        { status: 400 }
      );

    const body = await request.json().catch(() => ({}));
    const hours = Math.max(1, Math.min(168, Number(body.hours) || 48));
    const cutoff = new Date(Date.now() - hours * 3600 * 1000);

    const config = await getVndaConfigForWorkspace(workspaceId);
    if (!config) {
      return NextResponse.json(
        { error: "VNDA não configurado pra esse workspace." },
        { status: 400 }
      );
    }

    const admin = createAdminClient();

    // Carts já existentes nesse workspace pra evitar re-importar.
    // Limit alto pra workspaces grandes.
    const { data: existing } = await admin
      .from("abandoned_carts")
      .select("vnda_cart_token")
      .eq("workspace_id", workspaceId)
      .not("vnda_cart_token", "is", null)
      .limit(5000);
    const existingTokens = new Set(
      (existing || [])
        .map((r) => r.vnda_cart_token as string | null)
        .filter((t): t is string => !!t)
    );

    const stats = {
      fetched: 0,
      skipped_no_email: 0,
      skipped_outside_window: 0,
      skipped_existing: 0,
      skipped_invalid: 0,
      imported: 0,
      errors: 0,
    };

    // 1. Paginar lista. Para quando achar cart com updated_at < cutoff
    //    (assumindo ordenação desc).
    let page = 1;
    const perPage = 100;
    const maxPages = 5; // hard cap pra não estourar timeout
    const elegible: VndaCartListItem[] = [];

    pages: while (page <= maxPages) {
      const list = await vndaGet<VndaCartListItem[]>(
        `carts/?per_page=${perPage}&page=${page}`,
        config.apiToken,
        config.storeHost
      );
      if (!Array.isArray(list) || list.length === 0) break;
      stats.fetched += list.length;

      for (const cart of list) {
        const updatedAt = new Date(cart.updated_at);
        if (updatedAt < cutoff) {
          // Lista é desc por updated_at → tudo depois desse também é antigo.
          break pages;
        }
        if (!cart.email) {
          stats.skipped_no_email++;
          continue;
        }
        if (cart.items_count <= 0) {
          stats.skipped_invalid++;
          continue;
        }
        if (existingTokens.has(cart.token)) {
          stats.skipped_existing++;
          continue;
        }
        elegible.push(cart);
      }

      if (list.length < perPage) break;
      page++;
    }

    // 2. Pra cada elegível, busca detalhes + faz upsert. Sleep entre
    //    requests pra respeitar rate limit VNDA.
    const invalidSamples: Array<Record<string, unknown>> = [];
    for (const cart of elegible) {
      try {
        const detail = await vndaGet<VndaAbandonedCartPayload>(
          `carts/${cart.token}`,
          config.apiToken,
          config.storeHost
        );

        // Items vem em formatos variados (Array, string JSON, null) — normaliza.
        const detailNormalized = {
          ...detail,
          items: parseItems(detail.items as unknown),
        } as VndaAbandonedCartPayload;

        // Validation relaxada: aceita carts sem items (vamos disparar
        // mesmo assim — o importante é ter email + identificador).
        if (!validateAbandonedCartPayloadForImport(detailNormalized)) {
          stats.skipped_invalid++;
          // Guarda primeiros 3 invalid pra retornar no response (debug).
          if (invalidSamples.length < 3) {
            const detailObj = detail as unknown as Record<string, unknown>;
            invalidSamples.push({
              list_token: cart.token,
              list_email: cart.email,
              detail_keys: Object.keys(detailObj),
              detail_email: detailObj.email,
              detail_token: detailObj.token,
              detail_id: detailObj.id,
              detail_code: detailObj.code,
              detail_items_type: typeof detailObj.items,
              detail_items_value:
                typeof detailObj.items === "string"
                  ? (detailObj.items as string).slice(0, 200)
                  : Array.isArray(detailObj.items)
                  ? `array(${(detailObj.items as unknown[]).length})`
                  : detailObj.items,
            });
          }
          continue;
        }

        const normalized = normalizeCart(detailNormalized);

        // Cart URL não vem na API VNDA — construímos manualmente.
        if (!normalized.recovery_url && normalized.vnda_cart_token) {
          normalized.recovery_url = `https://${config.storeHost}/carrinho/${normalized.vnda_cart_token}`;
        }

        // recovery_started_at = now garante que o cron começa a régua
        // do zero pra esse cart (Step 1 daqui a delay_minutes, não
        // imediatamente como se fosse cart antigo). abandoned_at original
        // fica preservado pra métrica/auditoria.
        const nowIso = new Date().toISOString();
        const { error } = await admin.from("abandoned_carts").upsert(
          {
            workspace_id: workspaceId,
            vnda_cart_token: normalized.vnda_cart_token,
            vnda_cart_id: normalized.vnda_cart_id,
            vnda_client_id: normalized.vnda_client_id,
            customer_email: normalized.customer_email,
            customer_phone: normalized.customer_phone,
            customer_name: normalized.customer_name,
            items: normalized.items,
            cart_total: normalized.cart_total,
            recovery_url: normalized.recovery_url,
            coupon_code: normalized.coupon_code,
            abandoned_at: normalized.abandoned_at,
            recovery_started_at: nowIso,
            raw_payload: JSON.parse(JSON.stringify(detail)),
            updated_at: nowIso,
          },
          {
            onConflict: "workspace_id,vnda_cart_token",
            ignoreDuplicates: false,
          }
        );

        if (error) {
          stats.errors++;
          console.error(
            `[CartRecovery Import] Upsert failed for ${cart.token}:`,
            error.message
          );
        } else {
          stats.imported++;
        }
      } catch (err) {
        stats.errors++;
        console.error(
          `[CartRecovery Import] Failed to import ${cart.token}:`,
          err instanceof Error ? err.message : err
        );
      }

      // Rate limit VNDA: 150ms entre detail requests.
      await sleep(150);
    }

    return NextResponse.json({
      ok: true,
      window_hours: hours,
      ...stats,
      sample_invalid: invalidSamples,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("[CartRecovery Import]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// Items vem como Array<Item> ou string JSON. Normalizar pra Array.
function parseItems(raw: unknown): unknown[] {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw;
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}
