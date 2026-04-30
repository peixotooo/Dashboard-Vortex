// src/app/api/email-countdown.png/route.tsx
import { ImageResponse } from "next/og";
import { NextRequest } from "next/server";
import { verify } from "@/lib/email-templates/countdown";

// Node runtime so this route shares the SAME `process.env` resolution
// as the orchestrator (which signs the URL). Edge isolates may surface env
// vars with subtle differences (encoding, trailing whitespace) that break
// HMAC verification.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Bulking brand palette — keep the timer recognizable on white email background.
const BG = "#FFFFFF";
const TEXT = "#000000";
const MUTED = "#707070";
const ACCENT = "#49E472";

interface Parts {
  d: string;
  h: string;
  m: string;
  s: string;
  expired: boolean;
}

function parts(ms: number): Parts {
  if (ms <= 0) return { d: "00", h: "00", m: "00", s: "00", expired: true };
  const totalSec = Math.floor(ms / 1000);
  const d = Math.floor(totalSec / 86400);
  const h = Math.floor((totalSec % 86400) / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  return {
    d: String(d).padStart(2, "0"),
    h: String(h).padStart(2, "0"),
    m: String(m).padStart(2, "0"),
    s: String(s).padStart(2, "0"),
    expired: false,
  };
}

function box(label: string, digits: string, expired: boolean) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        width: 110,
      }}
    >
      <div
        style={{
          width: 96,
          height: 96,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: expired ? "#F5F5F5" : TEXT,
          color: expired ? MUTED : BG,
          fontSize: 48,
          fontWeight: 800,
          fontVariantNumeric: "tabular-nums",
          letterSpacing: 1,
          fontFamily: "Arial, Helvetica, sans-serif",
        }}
      >
        {digits}
      </div>
      <div
        style={{
          marginTop: 8,
          fontSize: 11,
          letterSpacing: 4,
          color: MUTED,
          textTransform: "uppercase",
          fontFamily: "Arial, Helvetica, sans-serif",
          fontWeight: 600,
        }}
      >
        {label}
      </div>
    </div>
  );
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
  const p = parts(remaining);

  if (p.expired) {
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
              fontSize: 38,
              fontWeight: 800,
              color: MUTED,
              letterSpacing: 8,
              textTransform: "uppercase",
            }}
          >
            Encerrado
          </div>
        </div>
      ),
      { width: 600, height: 160, headers: imgHeaders() }
    );
  }

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
        <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
          {box("Dias", p.d, false)}
          <div style={{ fontSize: 40, fontWeight: 800, color: TEXT, marginBottom: 28 }}>:</div>
          {box("Horas", p.h, false)}
          <div style={{ fontSize: 40, fontWeight: 800, color: TEXT, marginBottom: 28 }}>:</div>
          {box("Min", p.m, false)}
          <div style={{ fontSize: 40, fontWeight: 800, color: ACCENT, marginBottom: 28 }}>:</div>
          {box("Seg", p.s, false)}
        </div>
      </div>
    ),
    { width: 600, height: 160, headers: imgHeaders() }
  );
}

function imgHeaders() {
  return {
    "Cache-Control": "no-store, no-cache, must-revalidate",
    "Content-Type": "image/png",
  };
}
