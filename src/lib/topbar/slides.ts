export interface TopbarSlide {
  title?: string | null;
  message: string;
}

const SLIDES_PREFIX = "__vtx_topbar_slides_v1__:";
const MAX_SLIDES = 8;
const MAX_TITLE_LENGTH = 80;
const MAX_MESSAGE_LENGTH = 180;

function cleanText(value: unknown, maxLength: number): string {
  if (typeof value !== "string") return "";
  return value.replace(/\s+/g, " ").trim().slice(0, maxLength);
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
  options?: { keepEmpty?: boolean }
): TopbarSlide[] {
  const keepEmpty = options?.keepEmpty === true;
  const source = Array.isArray(input) ? input : decodeMessageSlides(fallbackMessage);

  const slides = source
    .map((slide) => ({
      title: cleanText((slide as TopbarSlide)?.title, MAX_TITLE_LENGTH) || null,
      message: cleanText((slide as TopbarSlide)?.message, MAX_MESSAGE_LENGTH),
    }))
    .filter((slide) => keepEmpty || slide.message.length > 0)
    .slice(0, MAX_SLIDES);

  if (slides.length > 0) return slides;

  const fallbackIsEncoded =
    typeof fallbackMessage === "string" && fallbackMessage.startsWith(SLIDES_PREFIX);
  const legacyMessage = fallbackIsEncoded
    ? ""
    : cleanText(fallbackMessage, MAX_MESSAGE_LENGTH);
  const legacyTitle = cleanText(fallbackTitle, MAX_TITLE_LENGTH) || null;

  if (legacyMessage || keepEmpty) {
    return [{ title: legacyTitle, message: legacyMessage }];
  }

  return [];
}

export function serializeTopbarSlides(
  input: unknown,
  fallbackTitle?: string | null,
  fallbackMessage?: string | null
): { title: string | null; message: string; slides: TopbarSlide[] } {
  const slides = normalizeTopbarSlides(input, fallbackTitle, fallbackMessage);
  const primary = slides[0] || { title: null, message: "" };

  return {
    title: primary.title || null,
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
  fallbackMessage?: string | null
): TopbarSlide {
  return (
    normalizeTopbarSlides(input, fallbackTitle, fallbackMessage)[0] || {
      title: fallbackTitle || null,
      message: fallbackMessage || "",
    }
  );
}
