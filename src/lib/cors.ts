import { NextRequest } from "next/server";
import {
  isKnownStorefrontOrigin,
  isWorkspaceStorefrontOrigin,
  storefrontCorsHeaders,
} from "@/lib/security/storefront-origin";

export interface StorefrontCorsResult {
  allowed: boolean;
  headers: Record<string, string>;
}

/**
 * CORS for public storefront mutations. Browser origins must be known and,
 * once the API key resolves, belong to that workspace. Origin-less callers
 * remain supported for trusted server-side jobs, but receive no ACAO header.
 */
export async function getStorefrontCors(
  request: NextRequest,
  workspaceId?: string
): Promise<StorefrontCorsResult> {
  const origin = request.headers.get("origin");
  const originAllowed = workspaceId
    ? await isWorkspaceStorefrontOrigin(workspaceId, origin)
    : await isKnownStorefrontOrigin(origin);

  return {
    allowed: !origin || originAllowed,
    headers: storefrontCorsHeaders(origin, originAllowed),
  };
}
