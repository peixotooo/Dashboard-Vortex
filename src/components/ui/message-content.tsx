"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Components } from "react-markdown";

interface MessageContentProps {
  content: string;
  className?: string;
  isUser?: boolean;
}

const components: Components = {
  h1: ({ children }) => (
    <h3 className="text-base font-semibold mt-4 mb-2 first:mt-0">{children}</h3>
  ),
  h2: ({ children }) => (
    <h4 className="text-sm font-semibold mt-3 mb-1.5 first:mt-0">{children}</h4>
  ),
  h3: ({ children }) => (
    <h5 className="text-sm font-medium mt-3 mb-1 first:mt-0">{children}</h5>
  ),
  p: ({ children }) => (
    <p className="mb-2 last:mb-0 leading-relaxed">{children}</p>
  ),
  ul: ({ children }) => (
    <ul className="mb-2 last:mb-0 space-y-1 pl-4 list-disc marker:text-muted-foreground/50">{children}</ul>
  ),
  ol: ({ children }) => (
    <ol className="mb-2 last:mb-0 space-y-1 pl-4 list-decimal marker:text-muted-foreground/50">{children}</ol>
  ),
  li: ({ children }) => (
    <li className="leading-relaxed">{children}</li>
  ),
  strong: ({ children }) => (
    <strong className="font-semibold">{children}</strong>
  ),
  em: ({ children }) => (
    <em className="italic opacity-90">{children}</em>
  ),
  blockquote: ({ children }) => (
    <blockquote className="border-l-2 border-primary/40 pl-3 my-2 opacity-80 italic">{children}</blockquote>
  ),
  code: ({ className, children }) => {
    const isBlock = className?.includes("language-");
    if (isBlock) {
      return (
        <code className="block bg-background/60 rounded-lg px-3 py-2 my-2 text-xs font-mono overflow-x-auto whitespace-pre">
          {children}
        </code>
      );
    }
    return (
      <code className="bg-background/60 rounded px-1.5 py-0.5 text-xs font-mono">{children}</code>
    );
  },
  pre: ({ children }) => (
    <pre className="my-2 last:mb-0">{children}</pre>
  ),
  hr: () => (
    <hr className="my-3 border-border/50" />
  ),
  a: ({ href, children }) => (
    <a href={href} target="_blank" rel="noopener noreferrer" className="text-primary underline underline-offset-2 hover:opacity-80">
      {children}
    </a>
  ),
  table: ({ children }) => (
    <div className="overflow-x-auto my-2">
      <table className="w-full text-xs border-collapse">{children}</table>
    </div>
  ),
  thead: ({ children }) => (
    <thead className="border-b border-border/50">{children}</thead>
  ),
  th: ({ children }) => (
    <th className="text-left px-2 py-1.5 font-semibold text-muted-foreground">{children}</th>
  ),
  td: ({ children }) => (
    <td className="px-2 py-1.5 border-b border-border/30">{children}</td>
  ),
};

const userComponents: Components = {
  ...components,
  code: ({ className, children }) => {
    const isBlock = className?.includes("language-");
    if (isBlock) {
      return (
        <code className="block bg-white/10 rounded-lg px-3 py-2 my-2 text-xs font-mono overflow-x-auto whitespace-pre">
          {children}
        </code>
      );
    }
    return (
      <code className="bg-white/10 rounded px-1.5 py-0.5 text-xs font-mono">{children}</code>
    );
  },
  blockquote: ({ children }) => (
    <blockquote className="border-l-2 border-white/30 pl-3 my-2 opacity-80 italic">{children}</blockquote>
  ),
  a: ({ href, children }) => (
    <a href={href} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2 hover:opacity-80">
      {children}
    </a>
  ),
  ul: ({ children }) => (
    <ul className="mb-2 last:mb-0 space-y-1 pl-4 list-disc marker:text-white/40">{children}</ul>
  ),
  ol: ({ children }) => (
    <ol className="mb-2 last:mb-0 space-y-1 pl-4 list-decimal marker:text-white/40">{children}</ol>
  ),
  thead: ({ children }) => (
    <thead className="border-b border-white/20">{children}</thead>
  ),
  th: ({ children }) => (
    <th className="text-left px-2 py-1.5 font-semibold opacity-80">{children}</th>
  ),
  td: ({ children }) => (
    <td className="px-2 py-1.5 border-b border-white/10">{children}</td>
  ),
};

export function MessageContent({ content, className = "", isUser = false }: MessageContentProps) {
  return (
    <div className={`text-sm leading-relaxed ${className}`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={isUser ? userComponents : components}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
