"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Sparkles, LayoutGrid, FolderOpen } from "lucide-react";

const TABS = [
  { href: "/crm/email-templates", label: "Sugestões", icon: Sparkles },
  { href: "/crm/email-templates/library", label: "Galeria", icon: LayoutGrid },
  { href: "/crm/email-templates/drafts", label: "Meus templates", icon: FolderOpen },
];

/**
 * Three-pill nav anchoring the email-templates section. Sugestões are the
 * daily auto-generated drops (immutable per day); Galeria is the catalog of
 * layout originals (untouchable code); Meus templates is the workspace's
 * saved drafts. Saving in the editor never overwrites a Galeria layout —
 * it always lands here.
 */
export function SectionNav() {
  const pathname = usePathname() ?? "";
  return (
    <nav className="flex items-center gap-1 p-1 bg-muted/40 rounded-lg w-fit">
      {TABS.map((t) => {
        const active =
          t.href === "/crm/email-templates"
            ? pathname === "/crm/email-templates"
            : pathname.startsWith(t.href);
        const Icon = t.icon;
        return (
          <Link
            key={t.href}
            href={t.href}
            className={`inline-flex items-center gap-1.5 px-3 h-8 rounded-md text-xs font-medium transition-colors ${
              active
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <Icon className="w-3.5 h-3.5" />
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
