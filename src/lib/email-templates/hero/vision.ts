// src/lib/email-templates/hero/vision.ts
//
// Lightweight vision pre-pass that classifies a product photo by orientation
// (front / back / side / flat-lay) and flags whether the dominant graphic
// element lives on the back. The orientation is fed into the kie.ai prompt
// so the generated hero matches the source — Bulking pieces frequently carry
// the print on the back, and we don't want a "front" hero of a product whose
// signature graphic is on the back.

import { callLLM } from "@/lib/agent/llm-provider";

export type Orientation = "front" | "back" | "side" | "flat-lay" | "unknown";

export interface ProductOrientation {
  orientation: Orientation;
  has_back_print: boolean;
  raw: string;
}

const SYSTEM = `You are a fashion product photo analyzer.
Classify the product photo by its orientation and whether the back of the garment carries the dominant graphic / print.

Output STRICT JSON only, no prose, no markdown fences. Schema:
{ "orientation": "front" | "back" | "side" | "flat-lay" | "unknown",
  "has_back_print": true | false }

Rules:
- "back" if the photo shows the back of the garment (rear of model, garment turned around).
- "front" if it shows the front (chest area visible, model facing camera).
- "side" if it's a profile shot.
- "flat-lay" if there is no body — the garment is laid flat on a surface or photographed isolated.
- "unknown" if ambiguous.
- has_back_print = true if the photo is of the back AND the back carries a print/graphic. Otherwise false.`;

export async function analyzeProductOrientation(imageUrl: string): Promise<ProductOrientation> {
  const fallback: ProductOrientation = {
    orientation: "unknown",
    has_back_print: false,
    raw: "",
  };

  if (!imageUrl) return fallback;

  try {
    const resp = await callLLM({
      provider: "anthropic",
      model: "claude-haiku-4-5-20251001",
      maxTokens: 150,
      system: SYSTEM,
      tools: [],
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: { type: "url", url: imageUrl },
            },
            {
              type: "text",
              text: "Classify this product photo. Reply with the JSON only.",
            },
          ],
        },
      ],
    });

    const text = resp.content
      .filter((b: { type: string }) => b.type === "text")
      .map((b: unknown) => (b as { text: string }).text)
      .join("")
      .trim();

    const cleaned = text.replace(/^```json\s*|\s*```$/g, "").trim();
    const parsed = JSON.parse(cleaned) as Partial<ProductOrientation>;

    const orientation: Orientation =
      parsed.orientation && ["front", "back", "side", "flat-lay", "unknown"].includes(parsed.orientation)
        ? parsed.orientation
        : "unknown";
    return {
      orientation,
      has_back_print: orientation === "back" ? Boolean(parsed.has_back_print) : false,
      raw: text,
    };
  } catch (err) {
    console.error("[hero/vision] orientation analysis failed:", (err as Error).message);
    return fallback;
  }
}
