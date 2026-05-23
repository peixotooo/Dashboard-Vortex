// Countdown image público — usado no email do step 3 da régua de
// recuperação de carrinho. O cliente de email faz GET nessa URL toda vez
// que abre o email, e a imagem é recalculada em runtime mostrando o
// tempo restante até o cupom expirar.
//
// Endpoint público (sem auth) porque clientes de email não enviam cookies
// nem headers de auth. Recebe expires=<ISO> via query string.
//
// Retorna 1080x300 PNG via next/og. Cache desabilitado pra cada
// abertura recalcular.

import { ImageResponse } from "next/og";

export const runtime = "edge";

const PURPLE = "#1F1F1F";
const ACCENT = "#FFFFFF";
const MUTED = "#A0A0A0";

function formatRemaining(remainingMs: number): {
  big: string;
  label: string;
  expired: boolean;
} {
  if (remainingMs <= 0) {
    return { big: "EXPIRADO", label: "seu cupom não está mais válido", expired: true };
  }
  const totalSec = Math.floor(remainingMs / 1000);
  const hours = Math.floor(totalSec / 3600);
  const minutes = Math.floor((totalSec % 3600) / 60);
  if (hours >= 24) {
    const days = Math.floor(hours / 24);
    const restHours = hours % 24;
    return {
      big: `${days}d ${restHours}h`,
      label: "até seu cupom expirar",
      expired: false,
    };
  }
  if (hours > 0) {
    return {
      big: `${hours}h ${String(minutes).padStart(2, "0")}m`,
      label: "até seu cupom expirar",
      expired: false,
    };
  }
  return {
    big: `${minutes}m`,
    label: "últimos minutos do seu cupom",
    expired: false,
  };
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const expiresParam = url.searchParams.get("expires");
  if (!expiresParam) {
    return new Response("Missing expires param", { status: 400 });
  }
  const expiresAt = new Date(expiresParam);
  if (isNaN(expiresAt.getTime())) {
    return new Response("Invalid expires param", { status: 400 });
  }

  const remaining = expiresAt.getTime() - Date.now();
  const { big, label, expired } = formatRemaining(remaining);

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          background: expired ? "#7F1D1D" : PURPLE,
          color: ACCENT,
          padding: "40px 60px",
        }}
      >
        <div
          style={{
            fontSize: 24,
            letterSpacing: 6,
            textTransform: "uppercase",
            color: MUTED,
            marginBottom: 16,
          }}
        >
          {expired ? "Cupom expirado" : "Seu cupom expira em"}
        </div>
        <div
          style={{
            fontSize: 144,
            fontWeight: 700,
            letterSpacing: -4,
            lineHeight: 1,
            color: ACCENT,
          }}
        >
          {big}
        </div>
        <div
          style={{
            fontSize: 22,
            color: MUTED,
            marginTop: 16,
            letterSpacing: 1,
          }}
        >
          {label}
        </div>
      </div>
    ),
    {
      width: 1080,
      height: 300,
      headers: {
        "Cache-Control": "no-store, must-revalidate",
        "Content-Type": "image/png",
      },
    }
  );
}
