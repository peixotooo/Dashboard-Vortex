/**
 * Looks for any "club"/membership tag signal across:
 *   1. crm_vendas — columns we persist (probably none)
 *   2. vnda_webhook_logs.payload — raw incoming payloads (last 30 days)
 *   3. Live VNDA API — sample of recent orders via /api/v2/orders/{id}
 *
 * Read-only.
 */
import { createClient } from "@supabase/supabase-js";
import { createDecipheriv } from "crypto";
import dotenv from "dotenv";
import path from "path";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { autoRefreshToken: false, persistSession: false } });
const ENC_KEY = process.env.ENCRYPTION_KEY!;
function decrypt(t: string): string {
  if (!t.includes(":")) return t;
  const [iv, tag, enc] = t.split(":");
  const d = createDecipheriv("aes-256-gcm", Buffer.from(ENC_KEY, "hex"), Buffer.from(iv, "hex"));
  d.setAuthTag(Buffer.from(tag, "hex"));
  return d.update(enc, "hex", "utf8") + d.final("utf8");
}

async function main() {
  const { data: conn } = await db
    .from("vnda_connections")
    .select("workspace_id, store_host, api_token")
    .eq("enable_cashback", true)
    .limit(1)
    .single();
  const workspaceId = conn!.workspace_id as string;
  const apiToken = decrypt(conn!.api_token as string);
  const storeHost = conn!.store_host as string;

  // === 1. crm_vendas — does it have any tag column? ===
  console.log("=== 1. crm_vendas: colunas relacionadas a tags ===");
  const { data: sampleRow } = await db.from("crm_vendas").select("*").eq("workspace_id", workspaceId).limit(1).single();
  if (sampleRow) {
    const tagLikeCols = Object.keys(sampleRow).filter((k) => /tag|club|member|loyalty/i.test(k));
    if (tagLikeCols.length === 0) {
      console.log("  ❌ Nenhuma coluna relacionada a tag/club/member em crm_vendas");
    } else {
      console.log(`  ✓ Colunas encontradas: ${tagLikeCols.join(", ")}`);
    }
  }

  // === 2. vnda_webhook_logs.payload — has client_tags? ===
  console.log("\n=== 2. vnda_webhook_logs.payload — busca por client_tags ===");
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setUTCDate(thirtyDaysAgo.getUTCDate() - 30);
  const { data: logs } = await db
    .from("vnda_webhook_logs")
    .select("payload, created_at")
    .eq("workspace_id", workspaceId)
    .eq("status", "success")
    .gte("created_at", thirtyDaysAgo.toISOString())
    .order("created_at", { ascending: false })
    .limit(200);

  console.log(`  Analisando ${logs?.length || 0} payloads dos últimos 30 dias…`);
  const tagFreq = new Map<string, number>();
  let payloadsComTag = 0;
  let payloadsSemTag = 0;
  let payloadsSemPayload = 0;

  for (const l of logs || []) {
    const p = l.payload as { client_tags?: string | null } | null;
    if (!p) {
      payloadsSemPayload++;
      continue;
    }
    const ct = p.client_tags;
    if (!ct || (typeof ct === "string" && ct.trim() === "")) {
      payloadsSemTag++;
    } else {
      payloadsComTag++;
      // tags chegam como string "tag1,tag2,tag3"
      const list = String(ct).split(",").map((s) => s.trim()).filter(Boolean);
      for (const t of list) tagFreq.set(t, (tagFreq.get(t) || 0) + 1);
    }
  }
  console.log(`  ${payloadsComTag} com client_tags · ${payloadsSemTag} sem client_tags · ${payloadsSemPayload} sem payload bruto salvo`);
  if (tagFreq.size > 0) {
    console.log("  Tags encontradas (frequência):");
    const sorted = Array.from(tagFreq.entries()).sort((a, b) => b[1] - a[1]);
    for (const [tag, n] of sorted) {
      console.log(`    ${n.toString().padStart(4)}× "${tag}"`);
    }
  } else {
    console.log("  ❌ Nenhuma tag encontrada nos payloads salvos.");
  }

  // === 3. VNDA API live — get a fresh order with full client info ===
  console.log("\n=== 3. VNDA API ao vivo: buscar pedido recente e inspecionar client ===");
  // Pick the most recent crm_vendas row that has a numero_pedido
  const { data: recentSale } = await db
    .from("crm_vendas")
    .select("source_order_id, numero_pedido, email")
    .eq("workspace_id", workspaceId)
    .eq("source", "vnda_webhook")
    .order("data_compra", { ascending: false })
    .limit(1)
    .single();
  if (!recentSale?.source_order_id) {
    console.log("  Nenhum pedido recente encontrado.");
  } else {
    const orderId = recentSale.source_order_id;
    const url = `https://api.vnda.com.br/api/v2/orders/${orderId}`;
    const res = await fetch(url, {
      method: "GET",
      headers: { Authorization: `Bearer ${apiToken}`, "X-Shop-Host": storeHost, Accept: "application/json" },
    });
    console.log(`  GET ${url} → HTTP ${res.status}`);
    if (res.ok) {
      const body = (await res.json()) as Record<string, unknown>;
      const client = body.client as { tags?: unknown; email?: string; id?: number; name?: string } | undefined;
      console.log(`  pedido ${recentSale.numero_pedido} · cliente: ${client?.name || "?"} <${client?.email || recentSale.email}>`);
      console.log(`  client.tags = ${JSON.stringify(client?.tags) || "(undefined)"}`);
      console.log(`  payload.client_tags = ${JSON.stringify((body as { client_tags?: unknown }).client_tags) || "(undefined)"}`);
      // Also try to find tag-related fields anywhere in the body
      const tagPaths: string[] = [];
      function walk(obj: unknown, p: string) {
        if (!obj || typeof obj !== "object") return;
        for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
          const path = p ? `${p}.${k}` : k;
          if (/tag/i.test(k) && (typeof v === "string" || Array.isArray(v))) {
            tagPaths.push(`${path} = ${JSON.stringify(v)}`);
          }
          if (typeof v === "object" && v !== null && !Array.isArray(v)) walk(v, path);
        }
      }
      walk(body, "");
      if (tagPaths.length) {
        console.log("  Campos contendo 'tag' no body:");
        for (const t of tagPaths) console.log(`    ${t}`);
      }
    }
  }

  // === 4. VNDA API: GET client by email/id ===
  console.log("\n=== 4. VNDA API: GET /clients/{id} pra ver tags do cadastro do cliente ===");
  if (recentSale?.email) {
    // Try a few endpoints
    const probes = [
      `https://api.vnda.com.br/api/v2/clients?email=${encodeURIComponent(recentSale.email)}`,
      `https://api.vnda.com.br/api/v2/clients/search?email=${encodeURIComponent(recentSale.email)}`,
      `https://api.vnda.com.br/api/v2/clients/by_email?email=${encodeURIComponent(recentSale.email)}`,
    ];
    for (const url of probes) {
      const res = await fetch(url, {
        method: "GET",
        headers: { Authorization: `Bearer ${apiToken}`, "X-Shop-Host": storeHost, Accept: "application/json" },
      });
      console.log(`  ${res.status} ${url}`);
      if (res.ok) {
        const body = await res.json();
        console.log(`    body preview: ${JSON.stringify(body).slice(0, 400)}`);
        break;
      }
    }
  }
}
main().catch((e) => {
  console.error("fatal:", e);
  process.exit(1);
});
