import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["@modelcontextprotocol/sdk", "@napi-rs/canvas"],
  // Bundle the bundled Kanit TTF files alongside the email-countdown.gif route
  // so the serverless function can read them at runtime.
  outputFileTracingIncludes: {
    "/api/email-countdown.gif": ["./src/app/api/email-countdown.gif/_fonts/**"],
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Permitted-Cross-Domain-Policies", value: "none" },
          { key: "X-DNS-Prefetch-Control", value: "off" },
          {
            key: "Strict-Transport-Security",
            value: "max-age=63072000",
          },
        ],
      },
      {
        source: "/shelves.js",
        headers: [
          {
            key: "Access-Control-Allow-Origin",
            value: "*",
          },
          {
            key: "Access-Control-Allow-Methods",
            value: "GET, OPTIONS",
          },
          {
            key: "Access-Control-Allow-Headers",
            value: "Content-Type",
          },
        ],
      },
      {
        // Anti-clickjacking no app autenticado. Exclui os widgets/páginas
        // embeddáveis nas lojas (shelves.js, assistant.js, /bio, /chat,
        // /avaliar, /g) — precisam continuar carregáveis em iframe de
        // terceiros. `bio|chat|avaliar` são ancorados em `/` ou fim de path
        // pra NÃO exemptar rotas do dashboard como /bio-inteligente; `g/`
        // (com barra) não pega /ga4, /gift-bar, /google-ads. api/_next não
        // são documentos framáveis.
        source:
          "/((?!api/|_next/|shelves\\.js|assistant\\.js|bio(?:/|$)|chat(?:/|$)|avaliar(?:/|$)|g/).*)",
        headers: [
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          {
            key: "Content-Security-Policy",
            value: "base-uri 'self'; object-src 'none'; frame-ancestors 'self'",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
