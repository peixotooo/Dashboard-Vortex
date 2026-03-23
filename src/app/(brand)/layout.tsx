import React from "react";

export const metadata = {
  title: "BULKING — Brandbook & Manual da Marca",
  description: "Identidade, estrategia e sistema de marca da Bulking. v1.0",
};

export default function BrandLayout({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="min-h-screen bg-black text-white antialiased"
      style={{ fontFamily: "'Inter', sans-serif" }}
    >
      {children}
    </div>
  );
}
