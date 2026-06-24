"use client";

import { useEffect, useMemo, useState } from "react";
import { Clock } from "lucide-react";

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/** Contador regressivo AO VIVO (tique-taque) — urgência real. */
export function BioCountdown({ target, label = "Acaba em" }: { target: string; label?: string }) {
  const targetMs = useMemo(() => new Date(target).getTime(), [target]);
  // null até montar no cliente (evita mismatch de hidratação)
  const [now, setNow] = useState<number | null>(null);

  useEffect(() => {
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  if (now === null || Number.isNaN(targetMs)) return null;
  const ms = targetMs - now;
  if (ms <= 0) return null;

  const totalSec = Math.floor(ms / 1000);
  const d = Math.floor(totalSec / 86400);
  const h = Math.floor((totalSec % 86400) / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  const clock = d > 0 ? `${d}d ${pad(h)}:${pad(m)}:${pad(s)}` : `${pad(h)}:${pad(m)}:${pad(s)}`;

  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-white/12 px-3 py-1.5 text-[13px] font-bold tabular-nums text-white/90">
      <Clock className="h-3.5 w-3.5" />
      {label} {clock}
    </span>
  );
}
