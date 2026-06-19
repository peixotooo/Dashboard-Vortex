export interface TopbarSlide {
  title?: string | null;
  message: string;
  link_url?: string | null;
  link_label?: string | null;
}

const SLIDES_PREFIX = "__vtx_topbar_slides_v1__:";
const MAX_SLIDES = 8;
const MAX_TITLE_LENGTH = 80;
const MAX_MESSAGE_LENGTH = 180;
const MAX_LINK_URL_LENGTH = 500;
const MAX_LINK_LABEL_LENGTH = 50;

function cleanText(value: unknown, maxLength: number): string {
  if (typeof value !== "string") return "";
  return value.replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function cleanUrl(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.trim().slice(0, MAX_LINK_URL_LENGTH);
}

function decodeMessageSlides(message: unknown): TopbarSlide[] {
  if (typeof message !== "string" || !message.startsWith(SLIDES_PREFIX)) return [];

  try {
    const parsed = JSON.parse(message.slice(SLIDES_PREFIX.length));
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((slide) => ({
        title: cleanText((slide as TopbarSlide)?.title, MAX_TITLE_LENGTH) || null,
        message: cleanText((slide as TopbarSlide)?.message, MAX_MESSAGE_LENGTH),
        link_url: cleanUrl((slide as TopbarSlide)?.link_url) || null,
        link_label:
          cleanText((slide as TopbarSlide)?.link_label, MAX_LINK_LABEL_LENGTH) || null,
      }))
      .filter((slide) => slide.message.length > 0)
      .slice(0, MAX_SLIDES);
  } catch {
    return [];
  }
}

export function normalizeTopbarSlides(
  input: unknown,
  fallbackTitle?: string | null,
  fallbackMessage?: string | null,
  options?: {
    keepEmpty?: boolean;
    fallbackLinkUrl?: string | null;
    fallbackLinkLabel?: string | null;
  }
): TopbarSlide[] {
  const keepEmpty = options?.keepEmpty === true;
  const source = Array.isArray(input) ? input : decodeMessageSlides(fallbackMessage);

  const slides = source
    .map((slide, index) => {
      const fallbackLinkUrl = index === 0 ? cleanUrl(options?.fallbackLinkUrl) : "";
      const fallbackLinkLabel =
        index === 0
          ? cleanText(options?.fallbackLinkLabel, MAX_LINK_LABEL_LENGTH)
          : "";
      return {
        title: cleanText((slide as TopbarSlide)?.title, MAX_TITLE_LENGTH) || null,
        message: cleanText((slide as TopbarSlide)?.message, MAX_MESSAGE_LENGTH),
        link_url: cleanUrl((slide as TopbarSlide)?.link_url) || fallbackLinkUrl || null,
        link_label:
          cleanText((slide as TopbarSlide)?.link_label, MAX_LINK_LABEL_LENGTH) ||
          fallbackLinkLabel ||
          null,
      };
    })
    .filter((slide) => keepEmpty || slide.message.length > 0)
    .slice(0, MAX_SLIDES);

  if (slides.length > 0) return slides;

  const fallbackIsEncoded =
    typeof fallbackMessage === "string" && fallbackMessage.startsWith(SLIDES_PREFIX);
  const legacyMessage = fallbackIsEncoded
    ? ""
    : cleanText(fallbackMessage, MAX_MESSAGE_LENGTH);
  const legacyTitle = cleanText(fallbackTitle, MAX_TITLE_LENGTH) || null;
  const legacyLinkUrl = cleanUrl(options?.fallbackLinkUrl) || null;
  const legacyLinkLabel =
    cleanText(options?.fallbackLinkLabel, MAX_LINK_LABEL_LENGTH) || null;

  if (legacyMessage || keepEmpty) {
    return [
      {
        title: legacyTitle,
        message: legacyMessage,
        link_url: legacyLinkUrl,
        link_label: legacyLinkLabel,
      },
    ];
  }

  return [];
}

export function serializeTopbarSlides(
  input: unknown,
  fallbackTitle?: string | null,
  fallbackMessage?: string | null,
  fallbackLinkUrl?: string | null,
  fallbackLinkLabel?: string | null
): {
  title: string | null;
  message: string;
  link_url: string | null;
  link_label: string | null;
  slides: TopbarSlide[];
} {
  const slides = normalizeTopbarSlides(input, fallbackTitle, fallbackMessage, {
    fallbackLinkUrl,
    fallbackLinkLabel,
  });
  const primary = slides[0] || { title: null, message: "" };

  return {
    title: primary.title || null,
    link_url: primary.link_url || null,
    link_label: primary.link_label || null,
    message:
      slides.length > 1
        ? `${SLIDES_PREFIX}${JSON.stringify(slides)}`
        : primary.message,
    slides,
  };
}

export function primaryTopbarSlide(
  input: unknown,
  fallbackTitle?: string | null,
  fallbackMessage?: string | null,
  fallbackLinkUrl?: string | null,
  fallbackLinkLabel?: string | null
): TopbarSlide {
  return (
    normalizeTopbarSlides(input, fallbackTitle, fallbackMessage, {
      fallbackLinkUrl,
      fallbackLinkLabel,
    })[0] || {
      title: fallbackTitle || null,
      message: fallbackMessage || "",
      link_url: fallbackLinkUrl || null,
      link_label: fallbackLinkLabel || null,
    }
  );
}
