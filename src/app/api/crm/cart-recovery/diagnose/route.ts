import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { createAdminClient } from "@/lib/supabase-admin";

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

// GET — diagnóstico de carts abertos pra investigar suspeita de duplicação.
// Retorna: top emails com múltiplos carts, count de carts com token NULL,
// distribuição por idade, e config atual da régua.
export async function GET(request: NextRequest) {
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

    const admin = createAdminClient();

    // Pega todos os abertos pra analisar em JS.
    const { data: openCarts } = await admin
      .from("abandoned_carts")
      .select(
        "id, customer_email, vnda_cart_token, cart_total, abandoned_at, recovery_started_at"
      )
      .eq("workspace_id", workspaceId)
      .eq("status", "open");

    const carts = openCarts || [];
    const totalOpen = carts.length;
    const totalValue = carts.reduce(
      (s, c) => s + (Number(c.cart_total) || 0),
      0
    );

    // 1) Duplicação por email.
    const byEmail = new Map<
      string,
      { carts: number; value: number; tokens: Set<string | null> }
    >();
    for (const c of carts) {
      const key = c.customer_email || "(sem email)";
      if (!byEmail.has(key))
        byEmail.set(key, { carts: 0, value: 0, tokens: new Set() });
      const agg = byEmail.get(key)!;
      agg.carts++;
      agg.value += Number(c.cart_total) || 0;
      agg.tokens.add(c.vnda_cart_token);
    }
    const topDuplicates = Array.from(byEmail.entries())
      .filter(([, v]) => v.carts > 1)
      .map(([email, v]) => ({
        email,
        carts: v.carts,
        value: v.value,
        distinct_tokens: v.tokens.size,
      }))
      .sort((a, b) => b.carts - a.carts)
      .slice(0, 15);

    const emailsComMultiplosCarts = topDuplicates.reduce(
      (s, e) => s + e.carts,
      0
    );
    const valorEmailsComMultiplosCarts = topDuplicates.reduce(
      (s, e) => s + e.value,
      0
    );

    // 2) Token NULL.
    const nullToken = carts.filter((c) => !c.vnda_cart_token);
    const nullTokenAgg = {
      count: nullToken.length,
      value: nullToken.reduce((s, c) => s + (Number(c.cart_total) || 0), 0),
    };

    // 3) Distribuição por idade.
    const now = Date.now();
    const buckets = {
      ultimas_24h: { count: 0, value: 0 },
      "24h_a_7d": { count: 0, value: 0 },
      "7d_a_30d": { count: 0, value: 0 },
      mais_30d: { count: 0, value: 0 },
    };
    for (const c of carts) {
      const ageHours =
        (now - new Date(c.abandoned_at).getTime()) / 3600 / 1000;
      let key: keyof typeof buckets;
      if (ageHours <= 24) key = "ultimas_24h";
      else if (ageHours <= 24 * 7) key = "24h_a_7d";
      else if (ageHours <= 24 * 30) key = "7d_a_30d";
      else key = "mais_30d";
      buckets[key].count++;
      buckets[key].value += Number(c.cart_total) || 0;
    }

    // 4) Config régua.
    const { data: rule } = await admin
      .from("cart_recovery_rules")
      .select("expire_after_hours, enabled, updated_at")
      .eq("workspace_id", workspaceId)
      .maybeSingle();

    // Conclusão automática
    const expireHours = rule?.expire_after_hours ?? 168;
    const expectedToExpire = buckets.mais_30d.count + buckets["7d_a_30d"].count;
    const shouldBeExpired =
      (buckets.mais_30d.count > 0 && expireHours <= 720) ||
      (buckets["7d_a_30d"].count > 0 && expireHours <= 168);

    const verdict: string[] = [];
    if (topDuplicates.length > 0) {
      verdict.push(
        `${emailsComMultiplosCarts} carts (R$ ${valorEmailsComMultiplosCarts.toFixed(2)}) são de ${topDuplicates.length} cliente(s) com múltiplos abandonos (comportamento real, não bug).`
      );
    }
    if (nullTokenAgg.count > 0) {
      verdict.push(
        `${nullTokenAgg.count} carts SEM vnda_cart_token — podem estar duplicados de verdade (cada NULL é UNIQUE distinct no Postgres).`
      );
    }
    if (shouldBeExpired) {
      verdict.push(
        `Carts antigos NÃO expiraram (expire_after_hours=${expireHours}h). Cron rodando?`
      );
    }
    if (verdict.length === 0) {
      verdict.push(
        "Nenhum sinal claro de duplicação ou bug — provavelmente comportamento real."
      );
    }

    return NextResponse.json({
      summary: {
        total_open_carts: totalOpen,
        total_open_value: totalValue,
      },
      duplication_by_email: {
        emails_with_multiple_carts: topDuplicates.length,
        total_carts_envolvidos: emailsComMultiplosCarts,
        total_value_envolvido: valorEmailsComMultiplosCarts,
        top_15: topDuplicates,
      },
      null_token: nullTokenAgg,
      age_buckets: buckets,
      rule_config: rule || null,
      verdict,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
