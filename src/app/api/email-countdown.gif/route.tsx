// src/app/api/email-countdown.gif/route.tsx
//
// Animated GIF countdown timer rendered server-side per request.
//
// Each open of the email triggers a fresh GET; we render 60 frames (1 fps) of
// the seconds counting down from whatever time is remaining when the request
// hits, encode them as a GIF89a animated image, and stream the bytes back
// with strict no-cache headers so Gmail's image proxy and similar caches
// re-fetch on every open. This is the same trick Adidas/Nike/Booking/etc use
// for "live" countdowns in inboxes — JS isn't an option in email clients.

import path from "path";
import { NextRequest } from "next/server";
import { createCanvas, GlobalFonts } from "@napi-rs/canvas";
import { GIFEncoder, quantize, applyPalette } from "gifenc";
import { verify } from "@/lib/email-templates/countdown";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

// Vercel's serverless Linux containers ship with NO system fonts. @napi-rs/canvas
// silently renders nothing when fillText() can't find the requested family. We
// bundle Kanit (the Bulking brand head font) and register it at module init so
// fillText("Kanit", ...) resolves to a real glyph.
const FONTS_DIR = path.join(process.cwd(), "src/app/api/email-countdown.gif/_fonts");
let _fontsRegistered = false;
function ensureFonts() {
  if (_fontsRegistered) return;
  try {
    GlobalFonts.registerFromPath(path.join(FONTS_DIR, "Kanit-Bold.ttf"), "Kanit");
    GlobalFonts.registerFromPath(path.join(FONTS_DIR, "Kanit-ExtraBold.ttf"), "Kanit");
  } catch (err) {
    console.error("[email-countdown.gif] font registration failed:", err);
  }
  _fontsRegistered = true;
}

// Render at 2x logical so text stays sharp when the email client (Gmail, etc.)
// displays the GIF at the declared 600×220 size on high-DPI screens. Without
// the 2x bake, the bitmap is rasterized at exactly 600×220 and the browser
// has nothing to upsample from on retina, so digits and labels go soft/blurry.
const SCALE = 2;
const W = 600 * SCALE;
const H = 220 * SCALE;
const FRAMES = 60;
const FRAME_DELAY_MS = 1000;
// Monochrome only. No saturated accent on typography per brand system.
const BG = "#000000";
const FG = "#FFFFFF";
const MUTED = "#A8A8A8";

interface Parts {
  d: string;
  h: string;
  m: string;
  s: string;
}

function parts(remainingSec: number): Parts {
  const r = Math.max(0, remainingSec);
  const d = Math.floor(r / 86400);
  const h = Math.floor((r % 86400) / 3600);
  const m = Math.floor((r % 3600) / 60);
  const s = r % 60;
  return {
    d: String(d).padStart(2, "0"),
    h: String(h).padStart(2, "0"),
    m: String(m).padStart(2, "0"),
    s: String(s).padStart(2, "0"),
  };
}

function drawFrame(
  ctx: ReturnType<ReturnType<typeof createCanvas>["getContext"]>,
  remainingSec: number,
  expired: boolean
) {
  // Background
  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, W, H);

  if (expired) {
    ctx.fillStyle = MUTED;
    ctx.font = `500 ${40 * SCALE}px Kanit, Arial, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("ENCERRADO", W / 2, H / 2);
    return;
  }

  // Top eyebrow label. No em dash. Letter spacing handled implicitly by Kanit.
  ctx.fillStyle = MUTED;
  ctx.font = `500 ${13 * SCALE}px Kanit, Arial, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("ÚLTIMA CHANCE   ·   TERMINA EM", W / 2, 36 * SCALE);

  const p = parts(remainingSec);
  const labels = ["DIAS", "HORAS", "MINUTOS", "SEGUNDOS"];
  const digits = [p.d, p.h, p.m, p.s];

  const boxCount = 4;
  const totalContentWidth = 480 * SCALE;
  const slotWidth = totalContentWidth / boxCount;
  const startX = (W - totalContentWidth) / 2 + slotWidth / 2;
  const digitsY = 120 * SCALE;
  const labelY = 184 * SCALE;

  // Digits at weight 500. Editorial references use medium not bold.
  ctx.font = `500 ${64 * SCALE}px Kanit, Arial, sans-serif`;
  ctx.fillStyle = FG;
  for (let i = 0; i < boxCount; i++) {
    const cx = startX + slotWidth * i;
    ctx.fillText(digits[i], cx, digitsY);
  }

  // Colon separators between boxes. Same monochrome white, no accent.
  ctx.font = `500 ${36 * SCALE}px Kanit, Arial, sans-serif`;

  ctx.fillStyle = FG;
  for (let i = 0; i < boxCount - 1; i++) {
    const cx = startX + slotWidth * i + slotWidth / 2;
    ctx.fillText(":", cx, digitsY);
  }

  // Labels below the digits. Subtle, weight 500.
  ctx.font = `500 ${11 * SCALE}px Kanit, Arial, sans-serif`;
  ctx.fillStyle = MUTED;
  for (let i = 0; i < boxCount; i++) {
    const cx = startX + slotWidth * i;
    ctx.fillText(labels[i], cx, labelY);
  }
}

export async function GET(req: NextRequest) {
  ensureFonts();
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

  const totalSec = Math.floor((expDate.getTime() - Date.now()) / 1000);
  const expired = totalSec <= 0;

  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext("2d");
  const gif = GIFEncoder();

  if (expired) {
    drawFrame(ctx, 0, true);
    const { data } = ctx.getImageData(0, 0, W, H);
    const palette = quantize(data, 256);
    const indexed = applyPalette(data, palette);
    gif.writeFrame(indexed, W, H, { palette, delay: FRAME_DELAY_MS });
  } else {
    for (let i = 0; i < FRAMES; i++) {
      const r = Math.max(0, totalSec - i);
      drawFrame(ctx, r, r === 0);
      const { data } = ctx.getImageData(0, 0, W, H);
      const palette = quantize(data, 256);
      const indexed = applyPalette(data, palette);
      gif.writeFrame(indexed, W, H, { palette, delay: FRAME_DELAY_MS });
    }
  }

  gif.finish();
  const bytes = gif.bytes();

  return new Response(Buffer.from(bytes), {
    headers: {
      "Content-Type": "image/gif",
      "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0, private",
      Pragma: "no-cache",
      Expires: "0",
      "Content-Length": String(bytes.length),
    },
  });
}

// `GlobalFonts` import is reserved for future custom-font registration.
void GlobalFonts;
