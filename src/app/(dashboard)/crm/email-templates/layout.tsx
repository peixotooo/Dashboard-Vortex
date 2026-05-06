// src/app/(dashboard)/crm/email-templates/layout.tsx
//
// Shared shell for every email-templates subroute (Sugestões, Galeria,
// Meus templates, Relatórios). Renders the Locaweb credits banner above
// every page so the user always sees how many envios they have left
// without opening a dispatch dialog.

import { BalanceBanner } from "./_components/balance-banner";

export default function EmailTemplatesLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="px-6 pt-6">
        <BalanceBanner />
      </div>
      {children}
    </div>
  );
}
