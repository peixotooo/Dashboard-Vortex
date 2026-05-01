// src/lib/email-templates/hero/storage.ts
//
// kie.ai delivers short-lived (24h) image URLs. We download the bytes once and
// re-upload to our B2 bucket so the stored hero stays addressable beyond the
// expiry window.

import { uploadFile, generateKey, getPublicUrl } from "@/lib/b2-storage";

export async function persistGeneratedHero(args: {
  workspace_id: string;
  vnda_product_id: string;
  layout_id: string;
  slot: number;
  source_url: string;
}): Promise<string> {
  const res = await fetch(args.source_url);
  if (!res.ok) {
    throw new Error(`download hero failed: ${res.status}`);
  }
  const contentType = res.headers.get("content-type") ?? "image/jpeg";
  const ext = contentType.includes("png") ? "png" : "jpg";
  const buf = Buffer.from(await res.arrayBuffer());
  // Stable-ish key: slot of work + a random suffix to avoid clobbering when a
  // re-generation is intentional. The cache row in `email_template_heroes`
  // points at exactly one URL per (workspace, product, layout, slot).
  const key = generateKey(
    `email-heroes/${args.workspace_id}/${args.layout_id}/slot${args.slot}-${args.vnda_product_id}.${ext}`
  );
  await uploadFile(key, buf, contentType);
  return getPublicUrl(key);
}
