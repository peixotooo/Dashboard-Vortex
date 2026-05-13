// src/app/api/cron/iporto-dispatcher-3/route.ts
//
// Lane 3 do iporto-dispatcher. Veja iporto-dispatcher/route.ts pra contexto.

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
