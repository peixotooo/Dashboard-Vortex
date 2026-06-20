const PAGE_TARGETS = new Set(["all", "home", "product", "category", "cart"]);
const MODAL_TITLE_PREFIX = "__modal_title:";
const MODAL_BODY_PREFIX = "__modal_body:";

function decodeModalValue(value: string): string {
  try {
    return decodeURIComponent(value).trim();
  } catch {
    return value.trim();
  }
}

function cleanText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

export function normalizePromoTagPages(value: unknown): string[] {
  const raw = Array.isArray(value) ? value.map(String) : [];
  const pages = raw.filter((entry) => PAGE_TARGETS.has(entry));
  return pages.length > 0 ? pages : ["all"];
}

export function extractPromoTagModalMetadata(rule: {
  show_on_pages?: unknown;
  modal_title?: unknown;
  modal_body?: unknown;
}): { modal_title: string | null; modal_body: string | null } {
  let modalTitle = cleanText(rule.modal_title);
  let modalBody = cleanText(rule.modal_body);

  const entries = Array.isArray(rule.show_on_pages) ? rule.show_on_pages.map(String) : [];
  for (const entry of entries) {
    if (!modalTitle && entry.startsWith(MODAL_TITLE_PREFIX)) {
      modalTitle = decodeModalValue(entry.slice(MODAL_TITLE_PREFIX.length));
    }
    if (!modalBody && entry.startsWith(MODAL_BODY_PREFIX)) {
      modalBody = decodeModalValue(entry.slice(MODAL_BODY_PREFIX.length));
    }
  }

  return {
    modal_title: modalTitle,
    modal_body: modalBody,
  };
}

export function withPromoTagModalMetadata(
  showOnPages: unknown,
  modalTitle: unknown,
  modalBody: unknown
): string[] {
  const pages = normalizePromoTagPages(showOnPages);
  const title = cleanText(modalTitle);
  const body = cleanText(modalBody);

  if (title) pages.push(`${MODAL_TITLE_PREFIX}${encodeURIComponent(title)}`);
  if (body) pages.push(`${MODAL_BODY_PREFIX}${encodeURIComponent(body)}`);
  return pages;
}

export function hydratePromoTagRuleModal<T extends Record<string, unknown>>(
  rule: T
): T & {
  show_on_pages: string[];
  modal_title: string | null;
  modal_body: string | null;
} {
  const modal = extractPromoTagModalMetadata(rule);
  return {
    ...rule,
    show_on_pages: normalizePromoTagPages(rule.show_on_pages),
    modal_title: modal.modal_title,
    modal_body: modal.modal_body,
  };
}
