// Sincroniza a base de conhecimento INSTITUCIONAL do assistente a partir das
// páginas públicas da loja (www.bulking.com.br/p/*). Extrai o texto visível,
// limpa e salva em assistant_settings.institutional_kb.
//
// As páginas VNDA servem o texto no HTML estático (sem JS), então basta fetch +
// strip de tags. Rode quando o conteúdo institucional mudar.
//
// Uso:
//   npx tsx scripts/assistant-kb-sync.ts            → dry-run (mostra o que puxaria)
//   npx tsx scripts/assistant-kb-sync.ts --apply    → grava no banco
//
// Requer migration-127-assistant-kb.sql aplicada.

import * as dotenv from "dotenv";
import * as path from "path";
dotenv.config({ path: path.join(process.cwd(), ".env.local") });
import { createClient } from "@supabase/supabase-js";

const PAGES: Array<{ slug: string; label: string }> = [
  { slug: "termos", label: "TERMOS, TROCAS, FRETE, PAGAMENTO, FAQ, PRIVACIDADE" },
  { slug: "atendimento", label: "ATENDIMENTO E CONTATO" },
  { slug: "pagamentos", label: "PAGAMENTOS" },
  { slug: "default", label: "SOBRE A LOJA" },
];

// Recortes do topo/rodapé que aparecem em toda página e não são conteúdo útil.
const BOILERPLATE = [
  /Shop Masculino.*?TODOS OS PRODUTOS/is,
  /Todos Lançamentos Mais Vendidos.*?CASHBACK/is,
];

function stripHtml(html: string): string {
  let h = html.replace(/<(script|style|noscript)[^>]*>[\s\S]*?<\/\1>/gi, " ");
  h = h.replace(/<[^>]+>/g, " ");
  h = h
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&aacute;/gi, "á")
    .replace(/&eacute;/gi, "é")
    .replace(/&ccedil;/gi, "ç");
  h = h.replace(/\s+/g, " ").trim();
  for (const re of BOILERPLATE) h = h.replace(re, " ");
  return h.replace(/\s+/g, " ").trim();
}

async function fetchPage(storeHost: string, slug: string): Promise<string | null> {
  const url = `https://${storeHost}/p/${slug}`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
    if (!res.ok) {
      console.warn(`  ! ${slug}: HTTP ${res.status}`);
      return null;
    }
    const html = await res.text();
    const text = stripHtml(html);
    // páginas renderizadas via JS voltam quase vazias — ignora
    if (text.length < 200) {
      console.warn(`  ! ${slug}: conteúdo curto (${text.length} chars), pulando`);
      return null;
    }
    return text.slice(0, 8000);
  } catch (err) {
    console.warn(`  ! ${slug}: ${err instanceof Error ? err.message : err}`);
    return null;
  }
}

(async () => {
  const apply = process.argv.includes("--apply");

  const sb = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  );

  const { data: conn } = await sb
    .from("vnda_connections")
    .select("workspace_id, store_host")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!conn) {
    console.error("Nenhuma vnda_connection encontrada.");
    process.exit(1);
  }
  const ws = conn.workspace_id as string;
  const storeHost = (conn.store_host as string) || "www.bulking.com.br";
  console.log(`workspace: ${ws} · loja: ${storeHost}\n`);

  const sections: string[] = [];
  for (const p of PAGES) {
    process.stdout.write(`buscando /p/${p.slug} ... `);
    const text = await fetchPage(storeHost, p.slug);
    if (text) {
      console.log(`ok (${text.length} chars)`);
      sections.push(`### ${p.label}\n${text}`);
    }
  }

  if (sections.length === 0) {
    console.error("\nNenhuma página institucional pôde ser lida. Abortando.");
    process.exit(1);
  }

  const kb =
    `BASE DE CONHECIMENTO INSTITUCIONAL DA LOJA (fonte: ${storeHost}/p/*).\n` +
    `Use como referência para políticas. NÃO invente o que não estiver aqui.\n\n` +
    sections.join("\n\n---\n\n");

  console.log(`\n== KB montada: ${kb.length} chars, ${sections.length} seções ==`);
  console.log(kb.slice(0, 500) + "...\n");

  if (!apply) {
    console.log("Dry-run. Rode com --apply pra gravar em assistant_settings.institutional_kb");
    return;
  }

  const { error } = await sb
    .from("assistant_settings")
    .upsert(
      { workspace_id: ws, institutional_kb: kb, updated_at: new Date().toISOString() },
      { onConflict: "workspace_id" }
    );
  if (error) {
    console.error("Falha ao salvar:", error.message);
    console.error("→ migration-127-assistant-kb.sql já foi aplicada?");
    process.exit(1);
  }
  console.log("✓ base de conhecimento institucional salva.");
})();
