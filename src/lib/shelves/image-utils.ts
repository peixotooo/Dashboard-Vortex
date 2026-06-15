export interface VndaCatalogImage {
  id?: number | null;
  url?: string | null;
  position?: number | null;
  updated_at?: string | null;
}

export function normalizeShelfImageUrl(url: string | null | undefined): string | null {
  const trimmed = String(url ?? "").trim();
  if (!trimmed) return null;
  return trimmed.startsWith("//") ? `https:${trimmed}` : trimmed;
}

export function shelfImageKey(url: string | null | undefined): string {
  const normalized = normalizeShelfImageUrl(url);
  if (!normalized) return "";

  try {
    const parsed = new URL(normalized);
    const path = parsed.pathname.replace(/^\/(?:\d+x(?:\d+)?|x\d+)\//i, "/");
    return `${parsed.hostname.toLowerCase()}${path.toLowerCase()}`;
  } catch {
    return normalized
      .replace(/^https?:\/\//i, "//")
      .replace(/(\/\/cdn\.vnda\.com\.br\/)(?:(?:\d+x(?:\d+)?|x\d+)\/)/i, "$1")
      .split("?")[0]
      .split("#")[0]
      .toLowerCase();
  }
}

function imageSortValue(image: VndaCatalogImage, index: number): number {
  if (typeof image.position === "number" && Number.isFinite(image.position)) {
    return image.position;
  }
  return index;
}

export function sortShelfImages(images: VndaCatalogImage[] | null | undefined): VndaCatalogImage[] {
  return (Array.isArray(images) ? images : [])
    .filter((image) => !!normalizeShelfImageUrl(image?.url))
    .map((image, index) => ({ image, index }))
    .sort((a, b) => imageSortValue(a.image, a.index) - imageSortValue(b.image, b.index))
    .map(({ image }) => image);
}

export function pickShelfImages(args: {
  primaryImage?: string | null;
  images?: VndaCatalogImage[] | null;
}): { imageUrl: string | null; imageUrl2: string | null } {
  const images = sortShelfImages(args.images);
  const imageUrl = normalizeShelfImageUrl(images[0]?.url) || normalizeShelfImageUrl(args.primaryImage);
  const primaryKey = shelfImageKey(imageUrl);
  const imageUrl2 =
    images
      .map((image) => normalizeShelfImageUrl(image.url))
      .find((url) => !!url && shelfImageKey(url) !== primaryKey) || null;

  return { imageUrl, imageUrl2 };
}
