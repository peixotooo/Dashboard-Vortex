import { NextRequest, NextResponse } from "next/server";
import { getWorkspaceContext, handleAuthError } from "@/lib/api-auth";
import { getYourViewsConfig } from "@/lib/reviews/yourviews-api";
import { syncYourViewsReviews } from "@/lib/reviews/sync";

export const runtime = "nodejs";
export const maxDuration = 300;

// Dispara a extração da Yourviews para dentro de `reviews`.
//
// Pra ficar dentro do limite de tempo serverless, o botão do admin roda com
// um teto de páginas (default 60 = ~3000 avaliações). A carga inicial completa
// de uma loja com muito histórico deve usar o script:
//   npx tsx scripts/sync-yourviews-reviews.ts --workspace=<uuid> --apply
export async function POST(request: NextRequest) {
  try {
    const { workspaceId } = await getWorkspaceContext(request);
    const body = await request.json().catch(() => ({}));

    const config = await getYourViewsConfig(workspaceId);
    if (!config) {
      return NextResponse.json(
        { error: "Configure as credenciais da Yourviews antes de sincronizar." },
        { status: 400 }
      );
    }

    const result = await syncYourViewsReviews(workspaceId, {
      config,
      dateFrom: typeof body.date_from === "string" ? body.date_from : undefined,
      maxPages: Number(body.max_pages) || 60,
      count: Number(body.count) || 50,
    });

    return NextResponse.json({
      ok: true,
      result,
      capped: result.pages >= (Number(body.max_pages) || 60),
    });
  } catch (e) {
    return handleAuthError(e);
  }
}
