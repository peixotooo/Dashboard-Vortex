"use client";

import React, { useEffect, useState, useCallback, useRef } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Components } from "react-markdown";
import { BookOpen, Printer, ChevronUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface TocItem {
  id: string;
  text: string;
  level: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, "")
    .replace(/\s+/g, "-")
    .trim();
}

/** Detect hex color codes like `#49E472` and render a swatch next to them */
function renderWithColorSwatches(text: string): React.ReactNode {
  const hexRegex = /(#[0-9A-Fa-f]{6})\b/g;
  const parts = text.split(hexRegex);
  if (parts.length <= 1) return text;

  return parts.map((part, i) => {
    if (/^#[0-9A-Fa-f]{6}$/.test(part)) {
      return (
        <span key={i} className="inline-flex items-center gap-1.5">
          <span
            className="inline-block h-3.5 w-3.5 rounded-sm border border-border/50 shrink-0"
            style={{ backgroundColor: part }}
          />
          <code className="bg-muted/50 rounded px-1.5 py-0.5 text-xs font-mono">
            {part}
          </code>
        </span>
      );
    }
    return <React.Fragment key={i}>{part}</React.Fragment>;
  });
}

// ---------------------------------------------------------------------------
// Markdown custom components
// ---------------------------------------------------------------------------

function createBrandbookComponents(
  onHeading: (id: string, text: string, level: number) => void
): Components {
  return {
    h1: ({ children }) => {
      const text = String(children);
      const id = slugify(text);
      onHeading(id, text, 1);
      return (
        <h1
          id={id}
          className="text-3xl font-bold mt-16 mb-6 first:mt-0 pb-3 border-b border-border/50 scroll-mt-20"
        >
          {children}
        </h1>
      );
    },
    h2: ({ children }) => {
      const text = String(children);
      const id = slugify(text);
      onHeading(id, text, 2);
      return (
        <h2
          id={id}
          className="text-2xl font-semibold mt-12 mb-4 first:mt-0 scroll-mt-20"
        >
          {children}
        </h2>
      );
    },
    h3: ({ children }) => {
      const text = String(children);
      const id = slugify(text);
      onHeading(id, text, 3);
      return (
        <h3
          id={id}
          className="text-xl font-semibold mt-8 mb-3 first:mt-0 scroll-mt-20"
        >
          {children}
        </h3>
      );
    },
    h4: ({ children }) => {
      const text = String(children);
      const id = slugify(text);
      return (
        <h4
          id={id}
          className="text-lg font-medium mt-6 mb-2 scroll-mt-20"
        >
          {children}
        </h4>
      );
    },
    p: ({ children }) => {
      if (typeof children === "string") {
        return (
          <p className="mb-4 last:mb-0 leading-relaxed text-muted-foreground">
            {renderWithColorSwatches(children)}
          </p>
        );
      }
      return (
        <p className="mb-4 last:mb-0 leading-relaxed text-muted-foreground">
          {children}
        </p>
      );
    },
    ul: ({ children }) => (
      <ul className="mb-4 last:mb-0 space-y-1.5 pl-6 list-disc marker:text-primary/60">
        {children}
      </ul>
    ),
    ol: ({ children }) => (
      <ol className="mb-4 last:mb-0 space-y-1.5 pl-6 list-decimal marker:text-primary/60">
        {children}
      </ol>
    ),
    li: ({ children }) => (
      <li className="leading-relaxed text-muted-foreground">{children}</li>
    ),
    strong: ({ children }) => (
      <strong className="font-semibold text-foreground">{children}</strong>
    ),
    em: ({ children }) => <em className="italic opacity-90">{children}</em>,
    blockquote: ({ children }) => (
      <blockquote className="border-l-4 border-primary/60 bg-primary/5 rounded-r-lg pl-4 pr-4 py-3 my-6 text-foreground font-medium">
        {children}
      </blockquote>
    ),
    code: ({ className, children }) => {
      const isBlock = className?.includes("language-");
      if (isBlock) {
        return (
          <code className="block bg-zinc-900 text-zinc-100 rounded-lg px-4 py-3 my-4 text-sm font-mono overflow-x-auto whitespace-pre leading-relaxed">
            {children}
          </code>
        );
      }
      return (
        <code className="bg-muted/60 rounded px-1.5 py-0.5 text-sm font-mono text-foreground">
          {children}
        </code>
      );
    },
    pre: ({ children }) => <pre className="my-4 last:mb-0">{children}</pre>,
    hr: () => <hr className="my-10 border-border/40" />,
    a: ({ href, children }) => (
      <a
        href={href}
        className="text-primary underline underline-offset-2 hover:opacity-80 transition-opacity"
      >
        {children}
      </a>
    ),
    table: ({ children }) => (
      <div className="overflow-x-auto my-6 rounded-lg border border-border/50">
        <table className="w-full text-sm">{children}</table>
      </div>
    ),
    thead: ({ children }) => (
      <thead className="bg-muted/30 border-b border-border/50">
        {children}
      </thead>
    ),
    th: ({ children }) => (
      <th className="text-left px-4 py-2.5 font-semibold text-foreground text-xs uppercase tracking-wider">
        {children}
      </th>
    ),
    tbody: ({ children }) => <tbody className="divide-y divide-border/30">{children}</tbody>,
    tr: ({ children }) => (
      <tr className="hover:bg-muted/20 transition-colors">{children}</tr>
    ),
    td: ({ children }) => {
      if (typeof children === "string") {
        return (
          <td className="px-4 py-2.5 text-muted-foreground">
            {renderWithColorSwatches(children)}
          </td>
        );
      }
      return <td className="px-4 py-2.5 text-muted-foreground">{children}</td>;
    },
    img: ({ src, alt }) => (
      <img
        src={src}
        alt={alt || ""}
        className="rounded-lg my-4 max-w-full"
      />
    ),
  };
}

// ---------------------------------------------------------------------------
// TOC Component
// ---------------------------------------------------------------------------

function TableOfContents({
  items,
  activeId,
  onNavigate,
}: {
  items: TocItem[];
  activeId: string;
  onNavigate: (id: string) => void;
}) {
  // Only show h1 and h2 in the TOC
  const filtered = items.filter((item) => item.level <= 2);

  return (
    <nav className="space-y-0.5">
      <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">
        Sumario
      </p>
      {filtered.map((item) => (
        <button
          key={item.id}
          onClick={() => onNavigate(item.id)}
          className={cn(
            "block w-full text-left text-sm py-1 transition-colors truncate",
            item.level === 1 ? "font-medium" : "pl-4 text-xs",
            activeId === item.id
              ? "text-primary"
              : "text-muted-foreground hover:text-foreground"
          )}
          title={item.text}
        >
          {item.text}
        </button>
      ))}
    </nav>
  );
}

// ---------------------------------------------------------------------------
// Main Page
// ---------------------------------------------------------------------------

export default function BrandbookPage() {
  const [content, setContent] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [tocItems, setTocItems] = useState<TocItem[]>([]);
  const [activeId, setActiveId] = useState("");
  const [showScrollTop, setShowScrollTop] = useState(false);
  const headingsRef = useRef<Map<string, TocItem>>(new Map());
  const contentRef = useRef<HTMLDivElement>(null);

  // Fetch markdown content
  useEffect(() => {
    fetch("/brandbook-bulking.md")
      .then((res) => res.text())
      .then((text) => {
        setContent(text);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  // Collect headings after render
  const handleHeading = useCallback(
    (id: string, text: string, level: number) => {
      headingsRef.current.set(id, { id, text, level });
    },
    []
  );

  // Build TOC after content is rendered
  useEffect(() => {
    if (!content) return;
    // Wait for render
    const timer = setTimeout(() => {
      setTocItems(Array.from(headingsRef.current.values()));
    }, 100);
    return () => clearTimeout(timer);
  }, [content]);

  // Intersection observer for active heading
  useEffect(() => {
    if (tocItems.length === 0) return;

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setActiveId(entry.target.id);
            break;
          }
        }
      },
      { rootMargin: "-80px 0px -60% 0px", threshold: 0.1 }
    );

    const headingElements = document.querySelectorAll(
      "#brandbook-content h1[id], #brandbook-content h2[id], #brandbook-content h3[id]"
    );
    headingElements.forEach((el) => observer.observe(el));

    return () => observer.disconnect();
  }, [tocItems]);

  // Scroll to top visibility
  useEffect(() => {
    const handleScroll = () => {
      setShowScrollTop(window.scrollY > 600);
    };
    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  const navigateToHeading = (id: string) => {
    const el = document.getElementById(id);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  };

  const scrollToTop = () => {
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const components = React.useMemo(
    () => createBrandbookComponents(handleHeading),
    [handleHeading]
  );

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-3">
          <BookOpen className="h-6 w-6 text-muted-foreground" />
          <div>
            <div className="h-7 w-48 bg-muted/50 rounded animate-pulse" />
            <div className="h-4 w-72 bg-muted/30 rounded animate-pulse mt-2" />
          </div>
        </div>
        <div className="space-y-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <div
              key={i}
              className="h-4 bg-muted/30 rounded animate-pulse"
              style={{ width: `${60 + Math.random() * 40}%` }}
            />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <BookOpen className="h-6 w-6 text-muted-foreground" />
          <div>
            <h1 className="text-2xl font-bold">Brandbook Bulking</h1>
            <p className="text-sm text-muted-foreground">
              Identidade, estrategia e sistema de marca — v1.0
            </p>
          </div>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="gap-2"
          onClick={() => window.print()}
        >
          <Printer className="h-4 w-4" />
          Imprimir
        </Button>
      </div>

      {/* Content with TOC */}
      <div className="flex gap-8">
        {/* Sticky TOC - hidden on small screens */}
        <aside className="hidden xl:block w-56 shrink-0">
          <div className="sticky top-20 max-h-[calc(100vh-6rem)] overflow-y-auto pr-2 pb-8">
            <TableOfContents
              items={tocItems}
              activeId={activeId}
              onNavigate={navigateToHeading}
            />
          </div>
        </aside>

        {/* Main content */}
        <div
          id="brandbook-content"
          ref={contentRef}
          className="min-w-0 flex-1 max-w-4xl"
        >
          <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
            {content}
          </ReactMarkdown>
        </div>
      </div>

      {/* Scroll to top */}
      {showScrollTop && (
        <button
          onClick={scrollToTop}
          className="fixed bottom-6 right-6 z-50 flex h-10 w-10 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg transition-transform hover:scale-110 print:hidden"
          aria-label="Voltar ao topo"
        >
          <ChevronUp className="h-5 w-5" />
        </button>
      )}

      {/* Print styles */}
      <style jsx global>{`
        @media print {
          /* Hide dashboard chrome when printing */
          [data-sidebar],
          nav,
          header,
          .fixed {
            display: none !important;
          }
          main {
            margin: 0 !important;
            padding: 0 !important;
          }
          #brandbook-content {
            max-width: 100% !important;
          }
          aside {
            display: none !important;
          }
        }
      `}</style>
    </div>
  );
}
