"use client";

import { memo } from "react";

interface PixelDeskProps {
  working: boolean;
  scale?: number;
}

function PixelDeskInner({ working, scale = 3 }: PixelDeskProps) {
  // Desk: 16 wide x 8 tall pixels
  const w = 16 * scale;
  const h = 8 * scale;

  return (
    <svg
      width={w}
      height={h}
      viewBox={`0 0 ${w} ${h}`}
      shapeRendering="crispEdges"
      style={{ imageRendering: "pixelated" }}
    >
      {/* Monitor stand */}
      <rect x={7 * scale} y={0} width={2 * scale} height={scale} fill="#3a3a4e" />

      {/* Monitor */}
      <rect x={4 * scale} y={-4 * scale} width={8 * scale} height={4 * scale} fill="#1a1a28" rx={0} />
      <rect x={4 * scale} y={-4 * scale} width={8 * scale} height={scale * 0.5} fill="#3a3a4e" />
      <rect x={4 * scale} y={-1 * scale} width={8 * scale} height={scale * 0.5} fill="#3a3a4e" />
      <rect x={4 * scale} y={-4 * scale} width={scale * 0.5} height={4 * scale} fill="#3a3a4e" />
      <rect x={11.5 * scale} y={-4 * scale} width={scale * 0.5} height={4 * scale} fill="#3a3a4e" />

      {/* Monitor screen glow when working */}
      {working && (
        <rect
          x={4.5 * scale}
          y={-3.5 * scale}
          width={7 * scale}
          height={3 * scale}
          fill="#1877f2"
          opacity={0.15}
          className="pixel-monitor-glow"
        />
      )}

      {/* Desk surface */}
      <rect x={0} y={1 * scale} width={16 * scale} height={2 * scale} fill="#2a2a3e" />
      <rect x={0} y={1 * scale} width={16 * scale} height={scale * 0.5} fill="#353548" />

      {/* Desk legs */}
      <rect x={1 * scale} y={3 * scale} width={2 * scale} height={5 * scale} fill="#222233" />
      <rect x={13 * scale} y={3 * scale} width={2 * scale} height={5 * scale} fill="#222233" />

      {/* Keyboard on desk */}
      <rect x={5 * scale} y={1.5 * scale} width={6 * scale} height={scale} fill="#1a1a28" />
    </svg>
  );
}

export const PixelDesk = memo(PixelDeskInner);
