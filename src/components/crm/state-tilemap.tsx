"use client";

// Mapa do Brasil clicável. Imagem PNG (/brazil-map.png) renderiza
// como background semi-transparente; tiles dos 27 UFs ficam por
// cima nos centroides geográficos aproximados. Multi-select.

export type UF =
  | "AC" | "AL" | "AP" | "AM" | "BA" | "CE" | "DF" | "ES" | "GO" | "MA"
  | "MT" | "MS" | "MG" | "PA" | "PB" | "PR" | "PE" | "PI" | "RJ" | "RN"
  | "RS" | "RO" | "RR" | "SC" | "SP" | "SE" | "TO";

// Centroides aproximados em coordenadas relativas (0..1) sobre o PNG
// quadrado de /public/brazil-map.png. Calibração visual — pode
// precisar de ajuste fino se algum tile parecer fora do contorno.
const CENTROIDS: Record<UF, [number, number]> = {
  // Norte
  RR: [0.40, 0.10],
  AP: [0.56, 0.13],
  AM: [0.25, 0.26],
  PA: [0.50, 0.25],
  AC: [0.13, 0.36],
  RO: [0.27, 0.40],
  TO: [0.55, 0.35],
  // Nordeste
  MA: [0.62, 0.25],
  PI: [0.65, 0.32],
  CE: [0.72, 0.25],
  RN: [0.82, 0.27],
  PB: [0.84, 0.30],
  PE: [0.80, 0.33],
  AL: [0.82, 0.36],
  SE: [0.78, 0.39],
  BA: [0.68, 0.42],
  // Centro-Oeste
  MT: [0.40, 0.42],
  MS: [0.43, 0.58],
  GO: [0.54, 0.50],
  DF: [0.58, 0.47],
  // Sudeste
  MG: [0.62, 0.54],
  ES: [0.74, 0.55],
  RJ: [0.68, 0.62],
  SP: [0.56, 0.62],
  // Sul
  PR: [0.50, 0.69],
  SC: [0.52, 0.75],
  RS: [0.44, 0.82],
};

export const STATE_NAMES: Record<UF, string> = {
  AC: "Acre", AL: "Alagoas", AP: "Amapá", AM: "Amazonas", BA: "Bahia",
  CE: "Ceará", DF: "Distrito Federal", ES: "Espírito Santo", GO: "Goiás",
  MA: "Maranhão", MT: "Mato Grosso", MS: "Mato Grosso do Sul", MG: "Minas Gerais",
  PA: "Pará", PB: "Paraíba", PR: "Paraná", PE: "Pernambuco", PI: "Piauí",
  RJ: "Rio de Janeiro", RN: "Rio Grande do Norte", RS: "Rio Grande do Sul",
  RO: "Rondônia", RR: "Roraima", SC: "Santa Catarina", SP: "São Paulo",
  SE: "Sergipe", TO: "Tocantins",
};

export const ALL_UFS = Object.keys(CENTROIDS) as UF[];

function colorIntensity(count: number, maxCount: number, selected: boolean): string {
  if (selected) return "bg-amber-500 border-amber-300 text-amber-950 shadow-lg shadow-amber-500/40";
  if (count === 0 || maxCount === 0) return "bg-slate-700/80 border-slate-600 text-slate-300";
  const ratio = Math.log(1 + count) / Math.log(1 + maxCount);
  if (ratio < 0.2) return "bg-slate-800 border-slate-500 text-slate-100";
  if (ratio < 0.4) return "bg-cyan-800 border-cyan-500 text-cyan-50";
  if (ratio < 0.6) return "bg-emerald-700 border-emerald-400 text-white";
  if (ratio < 0.78) return "bg-lime-500 border-lime-200 text-slate-950 shadow-md shadow-lime-500/25";
  if (ratio < 0.92) return "bg-amber-500 border-amber-200 text-slate-950 shadow-lg shadow-amber-500/40";
  return "bg-orange-500 border-orange-200 text-orange-950 shadow-xl shadow-orange-500/50";
}

export function StateTilemap({
  counts,
  selected,
  onToggle,
  maxWidth = 520,
}: {
  /** Mapa UF → quantidade (clientes na visão atual). */
  counts: Record<string, number>;
  /** Conjunto de UFs selecionadas no filtro. */
  selected: Set<UF>;
  /** Callback ao clicar — recebe UF, deve adicionar/remover do filtro. */
  onToggle: (uf: UF) => void;
  maxWidth?: number;
}) {
  let max = 0;
  for (const uf of ALL_UFS) {
    const c = counts[uf] ?? 0;
    if (c > max) max = c;
  }
  return (
    <div
      className="relative mx-auto"
      style={{
        width: "100%",
        maxWidth,
        aspectRatio: "1 / 1",
      }}
    >
      {/* Background: silhueta do Brasil semi-transparente. Em tema
          dark a imagem PNG é preta — invert pra clarear. Em light fica
          como está (silhueta escura sobre fundo claro). */}
      <div
        className="absolute inset-0 pointer-events-none dark:invert"
        style={{
          backgroundImage: "url(/brazil-map.png)",
          backgroundSize: "contain",
          backgroundRepeat: "no-repeat",
          backgroundPosition: "center",
          opacity: 0.18,
        }}
      />

      {/* Tiles dos UFs posicionados nos centroides */}
      {ALL_UFS.map((uf) => {
        const [x, y] = CENTROIDS[uf];
        const count = counts[uf] ?? 0;
        const isSelected = selected.has(uf);
        const ratio = max > 0 ? Math.log(1 + count) / Math.log(1 + max) : 0;
        // Tamanho escala suavemente: 30 → 46px conforme contagem.
        const size = isSelected ? 46 : 30 + Math.round(ratio * 14);
        return (
          <button
            key={uf}
            type="button"
            onClick={() => onToggle(uf)}
            style={{
              position: "absolute",
              left: `${x * 100}%`,
              top: `${y * 100}%`,
              width: size,
              height: size,
              transform: "translate(-50%, -50%)",
            }}
            className={`
              rounded-full border-2 transition-all flex flex-col items-center justify-center leading-none
              ${colorIntensity(count, max, isSelected)}
              ${isSelected ? "ring-2 ring-amber-300 scale-110 z-20" : "hover:scale-125 hover:z-10 z-0"}
            `}
            title={`${STATE_NAMES[uf]} — ${count.toLocaleString("pt-BR")} clientes`}
          >
            <span className="text-[10px] font-bold leading-none">{uf}</span>
            {count > 0 && (
              <span className="text-[8px] opacity-90 leading-none mt-0.5">
                {count >= 1000 ? `${(count / 1000).toFixed(1)}k` : count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
