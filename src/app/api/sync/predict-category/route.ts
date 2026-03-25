import { NextRequest, NextResponse } from "next/server";
import { ml } from "@/lib/ml/client";

interface CategoryPrediction {
  id: string;
  name: string;
  prediction_probability: string;
  path_from_root: Array<{ id: string; name: string }>;
}

export async function GET(req: NextRequest) {
  const workspaceId = req.headers.get("x-workspace-id");
  if (!workspaceId) {
    return NextResponse.json({ error: "workspace_id required" }, { status: 401 });
  }

  const title = req.nextUrl.searchParams.get("title");
  if (!title) {
    return NextResponse.json(
      { error: "title query param required" },
      { status: 400 }
    );
  }

  try {
    const result = await ml.get<CategoryPrediction[]>(
      `/sites/MLB/category_predictor/predict?title=${encodeURIComponent(title)}`,
      workspaceId
    );

    if (!Array.isArray(result) || result.length === 0) {
      return NextResponse.json({ predictions: [] });
    }

    const predictions = result.map((cat) => ({
      category_id: cat.id,
      name: cat.name,
      probability: cat.prediction_probability,
      path: cat.path_from_root?.map((p) => p.name).join(" > ") || cat.name,
    }));

    return NextResponse.json({ predictions });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Erro desconhecido";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
