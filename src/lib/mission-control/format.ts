// Display helpers — Mission Control stores UTC, shows America/Sao_Paulo.

export const TIMEZONE = "America/Sao_Paulo";

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "-";
  try {
    return new Date(iso).toLocaleString("pt-BR", {
      timeZone: TIMEZONE,
      day: "2-digit",
      month: "2-digit",
      year: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "-";
  }
}

export function formatShortDateTime(iso: string | null | undefined): string {
  if (!iso) return "-";
  try {
    return new Date(iso).toLocaleString("pt-BR", {
      timeZone: TIMEZONE,
      day: "2-digit",
      month: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "-";
  }
}

export function formatRelative(iso: string | null | undefined): string {
  if (!iso) return "-";
  const diff = new Date(iso).getTime() - Date.now();
  const abs = Math.abs(diff);
  const hours = Math.round(abs / 36e5);
  const days = Math.round(abs / 864e5);
  const past = diff < 0;
  if (hours < 1) return past ? "agora" : "em breve";
  if (hours < 24)
    return past ? `há ${hours}h` : `em ${hours}h`;
  return past ? `há ${days}d` : `em ${days}d`;
}

export function hoursOverdue(iso: string | null | undefined): number {
  if (!iso) return 0;
  const diff = Date.now() - new Date(iso).getTime();
  return Math.max(0, Math.floor(diff / 36e5));
}

export const STATUS_LABEL: Record<string, string> = {
  new: "Novo",
  triaged: "Triado",
  assigned: "Atribuido",
  waiting_person: "Aguardando Pessoa",
  in_progress: "Em Progresso",
  waiting_external: "Aguardando Externo",
  blocked: "Bloqueado",
  ready_for_review: "Em Revisao",
  done: "Concluido",
  canceled: "Cancelado",
};

export const STATUS_COLOR: Record<string, string> = {
  new: "bg-slate-500",
  triaged: "bg-slate-400",
  assigned: "bg-blue-500",
  waiting_person: "bg-amber-500",
  in_progress: "bg-indigo-500",
  waiting_external: "bg-purple-500",
  blocked: "bg-red-500",
  ready_for_review: "bg-violet-500",
  done: "bg-emerald-500",
  canceled: "bg-gray-400",
};

export const PRIORITY_COLOR: Record<string, string> = {
  critical: "bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300",
  high: "bg-orange-100 text-orange-700 dark:bg-orange-900 dark:text-orange-300",
  medium: "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300",
  low: "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300",
};

export const HEALTH_COLOR: Record<string, string> = {
  on_track: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900 dark:text-emerald-300",
  attention: "bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300",
  delayed: "bg-orange-100 text-orange-700 dark:bg-orange-900 dark:text-orange-300",
  blocked: "bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300",
  at_risk: "bg-rose-100 text-rose-700 dark:bg-rose-900 dark:text-rose-300",
};

export const HEALTH_LABEL: Record<string, string> = {
  on_track: "Em dia",
  attention: "Atencao",
  delayed: "Atrasado",
  blocked: "Bloqueado",
  at_risk: "Risco",
};

export const AREA_LABEL: Record<string, string> = {
  acquisition: "Aquisicao",
  conversion: "Conversao",
  retention: "Retencao",
  crm: "CRM",
  creative: "Criativo",
  site: "Site",
  finance: "Financeiro",
  ops: "Operacao",
  reporting: "Reporte",
  analytics: "Analytics",
};
