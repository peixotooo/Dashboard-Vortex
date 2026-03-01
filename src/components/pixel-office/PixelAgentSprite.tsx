"use client";

import { memo } from "react";
import {
  SPRITE_NORMAL,
  SPRITE_CMO_CROWN,
  HAIR_COLORS,
  SKIN_COLORS,
  CROWN_COLOR,
  EYE_COLOR,
  MOUTH_COLOR,
  PANTS_COLOR,
  darkenColor,
  hashSlug,
} from "./constants";

interface PixelAgentSpriteProps {
  color: string;
  state: "idle" | "working";
  slug: string;
  scale?: number;
  isCmo?: boolean;
}

function resolveTokenColor(
  token: string,
  bodyColor: string,
  hairColor: string,
  skinColor: string,
  suitColor: string
): string | null {
  switch (token) {
    case "_":
      return null;
    case "H":
      return hairColor;
    case "S":
      return skinColor;
    case "E":
      return EYE_COLOR;
    case "M":
      return MOUTH_COLOR;
    case "B":
      return bodyColor;
    case "A":
      return bodyColor;
    case "P":
      return PANTS_COLOR;
    case "C":
      return CROWN_COLOR;
    case "J":
      return suitColor;
    default:
      return null;
  }
}

function PixelAgentSpriteInner({
  color,
  state,
  slug,
  scale = 3,
  isCmo = false,
}: PixelAgentSpriteProps) {
  const seed = hashSlug(slug);
  const hairColor = HAIR_COLORS[seed % HAIR_COLORS.length];
  const skinColor = SKIN_COLORS[seed % SKIN_COLORS.length];
  const suitColor = darkenColor(color, 40);

  const spriteW = 16;
  const crownRows = isCmo ? SPRITE_CMO_CROWN : [];
  const bodyRows = SPRITE_NORMAL;

  // For CMO, add suit jacket collar (replace row 10-11 body center with suit color)
  const allRows = [...crownRows, ...bodyRows];
  const spriteH = allRows.length;

  const svgW = spriteW * scale;
  const svgH = spriteH * scale;

  const rects: React.ReactNode[] = [];

  for (let y = 0; y < allRows.length; y++) {
    const row = allRows[y];
    for (let x = 0; x < row.length; x++) {
      let token = row[x];

      // CMO suit jacket: rows after crown (10-13 in body = offset by crownRows.length)
      if (isCmo && token === "B") {
        const bodyRowIdx = y - crownRows.length;
        if (bodyRowIdx >= 11 && bodyRowIdx <= 13) {
          // Jacket edges
          if (x <= 3 || x >= 12) {
            token = "J";
          }
        }
      }

      const fillColor = resolveTokenColor(
        token,
        color,
        hairColor,
        skinColor,
        suitColor
      );
      if (!fillColor) continue;

      rects.push(
        <rect
          key={`${x}-${y}`}
          x={x * scale}
          y={y * scale}
          width={scale}
          height={scale}
          fill={fillColor}
        />
      );
    }
  }

  const animClass =
    state === "working" ? "pixel-agent-working" : "pixel-agent-idle";

  return (
    <svg
      width={svgW}
      height={svgH}
      viewBox={`0 0 ${svgW} ${svgH}`}
      shapeRendering="crispEdges"
      className={animClass}
      style={{ imageRendering: "pixelated" }}
    >
      {rects}
    </svg>
  );
}

export const PixelAgentSprite = memo(PixelAgentSpriteInner);
