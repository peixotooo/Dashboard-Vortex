"use client";

// Tilemap clicável dos 27 UFs brasileiros pra usar como filtro
// composto no /crm. Posicionamento aproximado por geografia (norte
// em cima, sul embaixo). Cada tile = UF + contagem; clique alterna
// no Set de UFs selecionadas (multi-select).

export type UF =
  | "AC" | "AL" | "AP" | "AM" | "BA" | "CE" | "DF" | "ES" | "GO" | "MA"
  | "MT" | "MS" | "MG" | "PA" | "PB" | "PR" | "PE" | "PI" | "RJ" | "RN"
  | "RS" | "RO" | "RR" | "SC" | "SP" | "SE" | "TO";

const POSITIONS: Record<UF, [number, number]> = {
  RR: [1, 4], AP: [1, 6],
  AM: [2, 3], PA: [2, 5], MA: [2, 6], CE: [2, 7], RN: [2, 8],
  AC: [3, 2], TO: [3, 5], PI: [3, 6], PB: [3, 7], PE: [3, 8],
  RO: [4, 2], MT: [4, 4], BA: [4, 6], AL: [4, 8],
  GO: [5, 4], DF: [5, 5], MG: [5, 6], ES: [5, 7], SE: [5, 8],
  MS: [6, 4], SP: [6, 6], RJ: [6, 7],
  PR: [7, 5],
  SC: [8, 5],
  RS: [9, 5],
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

export const ALL_UFS = Object.keys(POSITIONS) as UF[];

function colorIntensity(count: number, maxCount: number, selected: boolean): string {
  if (selected) return "bg-amber-500/70 border-amber-300 text-amber-50";
  if (count === 0 || maxCount === 0) return "bg-muted/30 border-muted/50 text-muted-foreground";
  const ratio = Math.log(1 + count) / Math.log(1 + maxCount);
  if (ratio < 0.2) return "bg-sky-900/30 border-sky-800/60";
  if (ratio < 0.4) return "bg-sky-800/40 border-sky-700/60";
  if (ratio < 0.6) return "bg-sky-700/50 border-sky-600/60";
  if (ratio < 0.8) return "bg-sky-600/60 border-sky-500/60";
  return "bg-sky-500/70 border-sky-400/80";
}

export function StateTilemap({
  counts,
  selected,
  onToggle,
  maxWidth = 360,
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
      className="grid gap-1"
      style={{
        gridTemplateRows: "repeat(9, minmax(0, 1fr))",
        gridTemplateColumns: "repeat(8, minmax(0, 1fr))",
        aspectRatio: "8 / 9",
        maxWidth,
        margin: "0 auto",
      }}
    >
      {ALL_UFS.map((uf) => {
        const [row, col] = POSITIONS[uf];
        const count = counts[uf] ?? 0;
        const isSelected = selected.has(uf);
        return (
          <button
            key={uf}
            type="button"
            onClick={() => onToggle(uf)}
            style={{ gridRow: row, gridColumn: col }}
            className={`
              rounded border transition-all flex flex-col items-center justify-center p-0.5
              ${colorIntensity(count, max, isSelected)}
              ${isSelected ? "ring-2 ring-amber-300 scale-105" : "hover:scale-105 hover:ring-1 hover:ring-sky-300"}
            `}
            title={`${STATE_NAMES[uf]} — ${count.toLocaleString("pt-BR")} clientes`}
          >
            <span className="text-[10px] font-semibold leading-none">{uf}</span>
            {count > 0 && (
              <span className="text-[8px] leading-none mt-0.5 opacity-80">
                {count >= 1000 ? `${(count / 1000).toFixed(1)}k` : count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
