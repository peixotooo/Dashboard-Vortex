import { NextRequest, NextResponse } from "next/server";
import { getWorkspaceContext, handleAuthError } from "@/lib/api-auth";
import { createAdminClient } from "@/lib/supabase-admin";

export const runtime = "nodejs";
export const maxDuration = 120;

// Download de uma mídia de avaliação. A URL NÃO vem do cliente — é resolvida no
// banco (review_id + índice), então não há SSRF: só baixamos mídias que são
// realmente das avaliações deste workspace. Stream com Content-Disposition.
export async function GET(request: NextRequest) {
  try {
    const { workspaceId } = await getWorkspaceContext(request);
    const url = new URL(request.url);
    const reviewId = url.searchParams.get("review_id") || "";
    const i = Number(url.searchParams.get("i")) || 0;
    if (!reviewId) return NextResponse.json({ error: "review_id obrigatório" }, { status: 400 });

    const admin = createAdminClient();
    const { data: review } = await admin
      .from("reviews")
      .select("media, product_name, author_name")
      .eq("id", reviewId)
      .eq("workspace_id", workspaceId)
      .maybeSingle();
    const media = Array.isArray(review?.media) ? (review!.media as { url?: string; type?: string }[]) : [];
    const item = media[i];
    if (!item?.url) return NextResponse.json({ error: "mídia não encontrada" }, { status: 404 });

    const upstream = await fetch(item.url);
    if (!upstream.ok || !upstream.body) {
      return NextResponse.json({ error: "falha ao baixar a mídia" }, { status: 502 });
    }

    const contentType = upstream.headers.get("content-type") || (item.type === "video" ? "video/mp4" : "image/jpeg");
    const ext = (item.url.split("?")[0].match(/\.([a-z0-9]{2,5})$/i)?.[1] || (item.type === "video" ? "mp4" : "jpg")).toLowerCase();
    const slug = `${review?.product_name || "avaliacao"}-${review?.author_name || "cliente"}`
      .toLowerCase()
      .normalize("NFD")
      .replace(/\p{Diacritic}/gu, "") // remove acentos
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60);
    const filename = `${slug || "midia"}-${i + 1}.${ext}`;

    const headers = new Headers();
    headers.set("Content-Type", contentType);
    headers.set("Content-Disposition", `attachment; filename="${filename}"`);
    const len = upstream.headers.get("content-length");
    if (len) headers.set("Content-Length", len);
    headers.set("Cache-Control", "private, max-age=0");

    return new NextResponse(upstream.body, { status: 200, headers });
  } catch (e) {
    return handleAuthError(e);
  }
}
