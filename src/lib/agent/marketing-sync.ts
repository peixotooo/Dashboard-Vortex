/**
 * Marketing Planning → Project Context Sync
 *
 * Compiles active marketing actions into a markdown section
 * and appends it to the workspace's project_context.
 * All agents automatically see this via buildSystemPrompt().
 */

import { SupabaseClient } from "@supabase/supabase-js";
import { loadProjectContext, upsertDocument } from "./memory";

const SECTION_HEADER = "## Planejamento de Marketing";

const CATEGORY_LABELS: Record<string, string> = {
  campanha: "Campanha",
  conteudo: "Conteudo",
  social: "Social Media",
  email: "Email Marketing",
  seo: "SEO",
  lancamento: "Lancamento",
  evento: "Evento",
  geral: "Geral",
};

const STATUS_LABELS: Record<string, string> = {
  planned: "planejado",
  in_progress: "em andamento",
  done: "concluido",
  cancelled: "cancelado",
};

function formatDate(dateStr: string): string {
  const [y, m, d] = dateStr.split("-");
  return `${d}/${m}/${y}`;
}

export async function syncMarketingToProjectContext(
  supabase: SupabaseClient,
  workspaceId: string
): Promise<void> {
  // 1. Fetch all non-cancelled actions
  const { data: actions } = await supabase
    .from("marketing_actions")
    .select("*")
    .eq("workspace_id", workspaceId)
    .neq("status", "cancelled")
    .order("start_date", { ascending: true })
    .limit(50);

  // 2. Load current project context
  const currentContext = (await loadProjectContext(supabase, workspaceId)) || "";

  // 3. Strip existing marketing section
  const sectionRegex = new RegExp(
    `${SECTION_HEADER.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[\\s\\S]*?(?=\\n## |$)`,
    "g"
  );
  const baseContext = currentContext.replace(sectionRegex, "").trimEnd();

  // 4. Build new marketing section
  let marketingSection = "";

  if (actions && actions.length > 0) {
    // Group by category
    const grouped: Record<string, typeof actions> = {};
    for (const action of actions) {
      const cat = action.category || "geral";
      if (!grouped[cat]) grouped[cat] = [];
      grouped[cat].push(action);
    }

    const lines: string[] = [`\n\n${SECTION_HEADER}\n\nAcoes planejadas pela equipe:\n`];

    for (const [cat, catActions] of Object.entries(grouped)) {
      lines.push(`### ${CATEGORY_LABELS[cat] || cat}`);
      for (const a of catActions) {
        const dates = `${formatDate(a.start_date)} - ${formatDate(a.end_date)}`;
        const status = STATUS_LABELS[a.status] || a.status;
        const desc = a.description ? ` — ${a.description.slice(0, 200)}` : "";
        lines.push(`- [${dates}] ${a.title}${desc} (${status})`);
      }
      lines.push("");
    }

    marketingSection = lines.join("\n");
  }

  // 5. Save updated context
  const newContext = baseContext + marketingSection;
  await upsertDocument(supabase, workspaceId, null, "project_context", newContext);
}
