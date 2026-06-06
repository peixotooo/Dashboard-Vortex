/* eslint-disable @typescript-eslint/no-explicit-any */
import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });

import { createClient } from "@supabase/supabase-js";
import { generateKey, uploadFile } from "../src/lib/b2-storage";

// Re-hospeda as fotos de cliente das avaliações (hoje em uploadedfiles.yviews.com.br)
// no nosso storage B2 — pra não depender da CDN da Yourviews depois da migração.
// Idempotente: pula o que já está no B2. Reescreve reviews.media com as URLs novas.
//
//   Dry-run:   npx tsx scripts/rehost-review-media.ts --workspace=<uuid>
//   Aplicar:   npx tsx scripts/rehost-review-media.ts --workspace=<uuid> --apply

const EXT_BY_TYPE: Record<string, string> = {
  "image/jpeg": "jpg", "image/jpg": "jpg", "image/png": "png",
  "image/webp": "webp", "image/gif": "gif", "video/mp4": "mp4", "video/quicktime": "mov",
};

function needsRehost(url: string): boolean {
  return /yviews\.com\.br|yourviews/i.test(url);
}

async function main() {
  const apply = process.argv.includes("--apply");
  const WS = process.argv.find((a) => a.startsWith("--workspace="))?.split("=")[1]
    || "36f37e88-a9c7-4ed7-89b9-45e62b8bba04";

  const url = (process.env.NEXT_PUBLIC_SUPABASE_URL || "").trim();
  const key = (process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  const admin = createClient(url, key, { auth: { persistSession: false } });

  console.log(`Workspace: ${WS}`);
  console.log(apply ? "Modo: APPLY (baixa + sobe pro B2)" : "Modo: DRY-RUN");

  // Pega reviews com mídia (paginado).
  const rows: { id: string; media: { url: string; type: string }[] }[] = [];
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await admin
      .from("reviews")
      .select("id, media")
      .eq("workspace_id", WS)
      .not("media", "eq", "[]")
      .range(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    if (!data || data.length === 0) break;
    rows.push(...(data as any));
    if (data.length < PAGE) break;
  }

  const withMedia = rows.filter((r) => Array.isArray(r.media) && r.media.length > 0);
  const pending = withMedia.filter((r) => r.media.some((m) => m.url && needsRehost(m.url)));
  const totalPhotos = pending.reduce((n, r) => n + r.media.filter((m) => needsRehost(m.url)).length, 0);
  console.log(`Reviews com mídia: ${withMedia.length} | a re-hospedar: ${pending.length} (${totalPhotos} arquivos)`);

  if (!apply) {
    console.log("\nDry-run: rode com --apply pra baixar e subir pro B2.");
    return;
  }

  let ok = 0, fail = 0;
  for (const r of pending) {
    let changed = false;
    const newMedia = [];
    for (const m of r.media) {
      if (!m.url || !needsRehost(m.url)) { newMedia.push(m); continue; }
      try {
        const res = await fetch(m.url);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const ct = (res.headers.get("content-type") || "image/jpeg").split(";")[0].trim();
        const ext = EXT_BY_TYPE[ct] || (m.type === "video" ? "mp4" : "jpg");
        const buf = Buffer.from(await res.arrayBuffer());
        const publicUrl = await uploadFile(generateKey(`review.${ext}`), buf, ct);
        newMedia.push({ url: publicUrl, type: ct.startsWith("video/") ? "video" : "image" });
        changed = true;
        ok++;
      } catch (e) {
        // Mantém a URL original se falhar (não perde a foto).
        newMedia.push(m);
        fail++;
        console.warn(`  falha ${m.url}: ${e instanceof Error ? e.message : e}`);
      }
    }
    if (changed) {
      await admin.from("reviews").update({ media: newMedia, updated_at: new Date().toISOString() }).eq("id", r.id);
    }
  }

  console.log(`\n=== Resultado ===`);
  console.log(`  Fotos re-hospedadas: ${ok}`);
  console.log(`  Falhas:              ${fail}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
