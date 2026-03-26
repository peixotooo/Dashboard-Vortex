import React from "react";

export const metadata = {
  title: "BULKING — Manual da Marca v2.0",
  description: "Manual completo da marca Bulking. Identidade, posicionamento, estetica e direcao criativa.",
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
