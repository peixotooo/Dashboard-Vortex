import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["@modelcontextprotocol/sdk", "@napi-rs/canvas"],
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
