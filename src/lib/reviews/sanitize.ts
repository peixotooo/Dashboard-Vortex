import { normalizePublicBrowserUrl } from "@/lib/security/external-url";

export interface SanitizedReviewMedia {
  url: string;
  type: "image" | "video";
}

export function sanitizeReviewMedia(
  value: unknown,
  maxItems = 8
): SanitizedReviewMedia[] {
  if (!Array.isArray(value)) return [];

  const media: SanitizedReviewMedia[] = [];
  for (const item of value) {
    if (media.length >= maxItems) break;
    const candidate = item as { url?: unknown; type?: unknown };
    const url = normalizePublicBrowserUrl(candidate?.url);
    if (!url) continue;
    media.push({
      url,
      type: candidate?.type === "video" ? "video" : "image",
    });
  }
  return media;
}
