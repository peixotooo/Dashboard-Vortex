// src/app/api/cron/iporto-dispatcher/route.ts
//
// Lane 1 do cron consumidor da fila iPORTO. Múltiplas paths
// (iporto-dispatcher, -2, -3) caem no mesmo handler em
// lib/email-templates/iporto-dispatcher-handler.ts. SELECT FOR UPDATE
// SKIP LOCKED garante zero duplicação entre lanes.
//
// Throughput estimado (por lane):
//   - BATCH = 1000 envios/run
//   - CONCURRENCY = 20 paralelos
//   - latência iPORTO ~500ms/req → 20 req/s
//   - cap por maxDuration (50s úteis) ≈ 1000 envios/run
// Com 3 lanes paralelas = ~3000 envios/min, 40k em ~13min.
//
// Pra escalar: adicionar mais entries em vercel.json e route files
// equivalentes (iporto-dispatcher-4/, -5/).

import { NextRequest } from "next/server";
import { runIportoDispatcher } from "@/lib/email-templates/iporto-dispatcher-handler";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  return runIportoDispatcher(req);
}
export async function GET(req: NextRequest) {
  return runIportoDispatcher(req);
}
