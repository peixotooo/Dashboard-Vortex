export interface ParsedInstagramProfile {
  username: string;
  fullName: string;
  biography: string;
  followersCount: number;
  followingCount: number;
  postsCount: number;
  profilePicUrl: string;
  externalUrl?: string;
  businessCategory?: string;
}

export interface InstagramProfileCounters {
  followersCount: number;
  postsCount: number;
}

function optionalText(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function requiredCounter(
  payload: Record<string, unknown>,
  keys: string[],
  label: string
): number {
  for (const key of keys) {
    const value = payload[key];
    const parsed =
      typeof value === "number"
        ? value
        : typeof value === "string" && value.trim()
          ? Number(value)
          : Number.NaN;
    if (Number.isFinite(parsed) && parsed >= 0) return Math.round(parsed);
  }
  throw new Error(`Resposta do Instagram sem ${label} válido`);
}

export function parseInstagramProfilePayload(
  raw: unknown,
  fallbackUsername: string
): ParsedInstagramProfile {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("Resposta inválida do scraper de perfil do Instagram");
  }

  const payload = raw as Record<string, unknown>;
  const actorError =
    optionalText(payload.errorDescription) || optionalText(payload.error);
  if (actorError) {
    throw new Error(`Scraper de perfil do Instagram: ${actorError}`);
  }

  return {
    username: optionalText(payload.username) || fallbackUsername,
    fullName: optionalText(payload.fullName) || optionalText(payload.full_name) || "",
    biography: optionalText(payload.biography) || optionalText(payload.bio) || "",
    followersCount: requiredCounter(
      payload,
      ["followersCount", "followers"],
      "quantidade de seguidores"
    ),
    followingCount: requiredCounter(
      payload,
      ["followsCount", "followingCount", "following"],
      "quantidade de perfis seguidos"
    ),
    postsCount: requiredCounter(payload, ["postsCount", "posts"], "quantidade de posts"),
    profilePicUrl:
      optionalText(payload.profilePicUrl) ||
      optionalText(payload.profilePicUrlHD) ||
      optionalText(payload.profile_pic_url) ||
      "",
    externalUrl: optionalText(payload.externalUrl) || optionalText(payload.external_url),
    businessCategory:
      optionalText(payload.businessCategoryName) ||
      optionalText(payload.businessCategory) ||
      optionalText(payload.category),
  };
}

export function assertInstagramProfileContinuity(
  current: InstagramProfileCounters,
  previous?: InstagramProfileCounters | null
): void {
  for (const [label, value] of [
    ["seguidores", current.followersCount],
    ["posts", current.postsCount],
  ] as const) {
    if (!Number.isFinite(value) || value < 0) {
      throw new Error(`Snapshot do Instagram com ${label} inválido`);
    }
  }

  if (!previous) return;
  if (previous.followersCount > 0 && current.followersCount === 0) {
    throw new Error("Snapshot do Instagram descartado: seguidores caíram para zero");
  }
  if (
    previous.followersCount >= 1_000 &&
    current.followersCount < previous.followersCount * 0.5
  ) {
    throw new Error("Snapshot do Instagram descartado: queda anômala de seguidores");
  }
  if (previous.postsCount > 0 && current.postsCount === 0) {
    throw new Error("Snapshot do Instagram descartado: posts caíram para zero");
  }
}
