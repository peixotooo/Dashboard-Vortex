// GET /api/assistant/config — config pública do widget (chamada pelo assistant.js).
//
// Retorna apenas o necessário pro widget decidir se aparece e como se apresenta.
// Não expõe modelo, caps, store_info nem a lista completa de produtos — o
// widget manda o product_id da página e recebe um boolean.

import { NextRequest, NextResponse } from "next/server";
import { validateApiKey } from "@/lib/shelves/api-key";
import { getAssistantSettings, isProductAllowed } from "@/lib/assistant/settings";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: { ...CORS_HEADERS, "Access-Control-Max-Age": "86400" },
  });
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const key = searchParams.get("key");
  const productId = searchParams.get("product_id");

  const auth = await validateApiKey(key);
  if (!auth) {
    return NextResponse.json(
      { error: "invalid key" },
      { status: 401, headers: CORS_HEADERS }
    );
  }

  const settings = await getAssistantSettings(auth.workspaceId);
  const enabled = isProductAllowed(settings, productId);

  return NextResponse.json(
    {
      enabled,
      title: settings.title,
      welcome_message: settings.welcomeMessage,
      suggestions: settings.suggestions,
    },
    {
      status: 200,
      headers: {
        ...CORS_HEADERS,
        // Cache curto: ligar/desligar o assistente propaga em ~2min
        "Cache-Control": "public, s-maxage=120, stale-while-revalidate=240",
      },
    }
  );
}
