// src/app/api/email-countdown.png/route.tsx
import { ImageResponse } from "next/og";
import { NextRequest } from "next/server";
import { verify } from "@/lib/email-templates/countdown";

export const runtime = "edge";
export const dynamic = "force-dynamic";

const ACCENT = "#49E472";
const BG = "#000000";
const MUTED = "#707070";

function fmt(ms: number): string {
  if (ms <= 0) return "ENCERRADO";
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const expires = searchParams.get("expires") ?? "";
  const sig = searchParams.get("sig") ?? "";

  if (!expires || !sig || !verify(expires, sig)) {
    return new Response("invalid signature", { status: 400 });
  }

  const expDate = new Date(expires);
  if (Number.isNaN(expDate.getTime())) {
    return new Response("invalid expires", { status: 400 });
  }
  const remaining = expDate.getTime() - Date.now();
  const text = fmt(remaining);
  const isExpired = remaining <= 0;

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          background: BG,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontFamily: "Arial, Helvetica, sans-serif",
        }}
      >
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 8,
          }}
        >
          <div
            style={{
              fontSize: 12,
              letterSpacing: 4,
              color: MUTED,
              textTransform: "uppercase",
            }}
          >
            {isExpired ? "Status" : "Termina em"}
          </div>
          <div
            style={{
              fontSize: 64,
              fontWeight: 800,
              color: isExpired ? MUTED : ACCENT,
              letterSpacing: 4,
              fontVariantNumeric: "tabular-nums",
            }}
          >
            {text}
          </div>
        </div>
      </div>
    ),
    {
      width: 600,
      height: 120,
      headers: {
        "Cache-Control": "no-store, no-cache, must-revalidate",
        "Content-Type": "image/png",
      },
    }
  );
}
