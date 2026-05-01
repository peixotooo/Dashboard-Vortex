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
    ];
  },
};

export default nextConfig;
