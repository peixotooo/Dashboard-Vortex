import { NextRequest, NextResponse } from "next/server";
import { getWorkspaceContext, handleAuthError } from "@/lib/api-auth";
import { generateAiReviews } from "@/lib/reviews/ai-generate";

export const runtime = "nodejs";
export const maxDuration = 300;

// Gera avaliações com IA (OpenRouter) para um produto, no tom das avaliações
// reais. Entram como 'pending' (moderação) ou 'published' se auto_publish.
export async function POST(request: NextRequest) {
  try {
    const { workspaceId } = await getWorkspaceContext(request);
    const body = await request.json();
    const productId = String(body.product_id || "");
    const count = Number(body.count) || 5;
    const autoPublish = body.auto_publish === true;
    if (!productId) return NextResponse.json({ error: "Selecione um produto." }, { status: 400 });

    const result = await generateAiReviews(workspaceId, productId, count, autoPublish);
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    return handleAuthError(e);
  }
}
