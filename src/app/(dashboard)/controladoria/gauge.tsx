"use client";

import * as React from "react";

/**
 * Termômetro semicircular superior (estilo SenseBoard): arco de 180°
 * vermelho→laranja→amarelo→verde da esquerda p/ direita, com ponteiro.
 * `ratio` = apurado/meta (1 = na meta). Ponteiro clampa em [0, 1.25].
 *
 * Geometria: ângulo α em graus (0°=direita, 90°=topo, 180°=esquerda);
 * em coords SVG (y p/ baixo): x = cx + r·cos α, y = cy − r·sin α.
 */
export function Gauge({ ratio }: { ratio: number }) {
  const clamped = Math.max(0, Math.min(1.25, Number.isFinite(ratio) ? ratio : 0));
  const cx = 110, cy = 104, r = 82, w = 18;
  const polar = (alphaDeg: number, rr: number) => {
    const a = (alphaDeg * Math.PI) / 180;
    return `${(cx + rr * Math.cos(a)).toFixed(2)} ${(cy - rr * Math.sin(a)).toFixed(2)}`;
  };
  // arco de A(alpha maior) → B(alpha menor); left(180) → right(0) por cima = sweep 1
  const arc = (fromA: number, toA: number) =>
    `M ${polar(fromA, r)} A ${r} ${r} 0 0 1 ${polar(toA, r)}`;
  const segs = [
    { from: 180, to: 135, color: "#ef4444" },
    { from: 135, to: 90, color: "#f59e0b" },
    { from: 90, to: 45, color: "#eab308" },
    { from: 45, to: 0, color: "#22c55e" },
  ];
  const alpha = 180 - (clamped / 1.25) * 180; // ratio 0→180°(esq), 1.25→0°(dir)
  const a = (alpha * Math.PI) / 180;
  const tipX = cx + (r - 16) * Math.cos(a);
  const tipY = cy - (r - 16) * Math.sin(a);
  return (
    <svg viewBox="0 0 220 124" className="w-full max-w-[280px]">
      {segs.map((s, i) => (
        <path key={i} d={arc(s.from, s.to)} fill="none" stroke={s.color} strokeWidth={w} />
      ))}
      <line x1={cx} y1={cy} x2={tipX} y2={tipY} stroke="#1f2937" strokeWidth="4" strokeLinecap="round" />
      <circle cx={cx} cy={cy} r="7" fill="#1f2937" />
    </svg>
  );
}
