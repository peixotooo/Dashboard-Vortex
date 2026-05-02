// src/lib/email-templates/tree/render.tsx
//
// Server-only renderer that turns a TreeDraft into final email HTML by
// composing react-email primitives. Multi-column rows are real <Row>+<Column>
// from react-email so 2-column reviews+hero, 3x3 product grids, asymmetric
// narrative, etc. all render with the structure intended — not flattened to
// a vertical column like the previous block model.

import * as React from "react";
import {
  Html,
  Head,
  Body,
  Container,
  Section,
  Row,
  Column,
  Heading,
  Text,
  Img,
  Button,
  Hr,
  Link,
} from "@react-email/components";
import { render } from "@react-email/render";
import type {
  TreeDraft,
  SectionNode,
  RowNode,
  ColumnNode,
  LeafNode,
  TextStyle,
  Mode,
} from "./schema";
import { buildCountdownUrl } from "../countdown";

const APP_BASE_URL =
  process.env.NEXT_PUBLIC_APP_URL ?? process.env.APP_URL ?? "https://dash.bulking.com.br";

const PALETTES = {
  light: {
    bg: "#FFFFFF",
    bgAlt: "#F7F7F7",
    text: "#000000",
    textMuted: "#3A3A3A",
    textSecondary: "#6E6E6E",
    textFaint: "#A8A8A8",
    border: "#E6E6E6",
    badgeBg: "#000000",
    badgeFg: "#FFFFFF",
    surfaceAlt: "#F7F7F7",
    canvas: "#F7F7F7",
  },
  dark: {
    bg: "#000000",
    bgAlt: "#0E0E0E",
    text: "#FFFFFF",
    textMuted: "#D8D8D8",
    textSecondary: "#B8B8B8",
    textFaint: "#8A8A8A",
    border: "#1F1F1F",
    badgeBg: "#FFFFFF",
    badgeFg: "#000000",
    surfaceAlt: "#0E0E0E",
    canvas: "#000000",
  },
};

const FONTS = {
  head: "'Kanit', 'Inter', Arial, sans-serif",
  body: "'Inter', 'Helvetica Neue', Arial, sans-serif",
  mono: "'JetBrains Mono', 'Courier New', monospace",
};

function ts(style: TextStyle | undefined, def: { size: number; weight: number; color: string }): React.CSSProperties {
  return {
    fontSize: `${style?.size ?? def.size}px`,
    fontWeight: style?.weight ?? def.weight,
    fontStyle: style?.italic ? "italic" : "normal",
    color: style?.color ?? def.color,
    letterSpacing: style?.letterSpacing != null ? `${style.letterSpacing}em` : undefined,
    lineHeight: style?.lineHeight,
    textTransform: style?.uppercase ? "uppercase" : undefined,
  };
}

function tagAttr(id: string, editorMode: boolean): Record<string, string> {
  return editorMode ? { "data-block-id": id } : {};
}

// ---------- Leaf renderers ----------

function LeafRenderer({
  node,
  mode,
  editorMode,
}: {
  node: LeafNode;
  mode: Mode;
  editorMode: boolean;
}): React.ReactNode {
  const c = PALETTES[mode];
  switch (node.type) {
    case "heading": {
      const align = node.align ?? "center";
      const styleObj = ts(node.style, { size: 38, weight: 500, color: c.text });
      const inner = node.html ? (
        <span dangerouslySetInnerHTML={{ __html: node.html }} />
      ) : (
        node.text
      );
      return (
        <Heading
          {...tagAttr(node.id, editorMode)}
          as={(node.level === 2 ? "h2" : node.level === 3 ? "h3" : "h1") as "h1" | "h2" | "h3"}
          style={{
            margin: "0 0 12px 0",
            fontFamily: FONTS.head,
            textAlign: align,
            lineHeight: 1.1,
            ...styleObj,
          }}
        >
          {inner}
        </Heading>
      );
    }
    case "eyebrow": {
      const align = node.align ?? "center";
      const styleObj = ts(node.style, { size: 11, weight: 500, color: c.textSecondary });
      const inner = node.html ? (
        <span dangerouslySetInnerHTML={{ __html: node.html }} />
      ) : (
        node.text
      );
      return (
        <Text
          {...tagAttr(node.id, editorMode)}
          style={{
            margin: "0 0 8px 0",
            fontFamily: FONTS.body,
            textTransform: "uppercase",
            letterSpacing: "0.32em",
            textAlign: align,
            ...styleObj,
          }}
        >
          {inner}
        </Text>
      );
    }
    case "text": {
      const align = node.align ?? "center";
      const styleObj = ts(node.style, { size: 16, weight: 400, color: c.textMuted });
      const inner = node.html ? (
        <span dangerouslySetInnerHTML={{ __html: node.html }} />
      ) : (
        node.text
      );
      return (
        <Text
          {...tagAttr(node.id, editorMode)}
          style={{
            margin: "0 0 14px 0",
            fontFamily: FONTS.body,
            textAlign: align,
            lineHeight: 1.7,
            ...styleObj,
          }}
        >
          {inner}
        </Text>
      );
    }
    case "button": {
      const isPrimary = node.variant !== "secondary";
      return (
        <Section {...tagAttr(node.id, editorMode)} style={{ textAlign: "center", padding: "8px 0 16px" }}>
          <Button
            href={node.href}
            style={{
              backgroundColor: isPrimary ? c.text : "transparent",
              color: isPrimary ? c.bg : c.text,
              fontFamily: FONTS.head,
              fontWeight: 600,
              fontSize: "13px",
              letterSpacing: "0.28em",
              textTransform: "uppercase",
              textDecoration: "none",
              padding: "20px 44px",
              border: isPrimary ? "none" : `1px solid ${c.text}`,
              display: "inline-block",
            }}
          >
            {node.text}
          </Button>
        </Section>
      );
    }
    case "image": {
      const ratio = node.ratio ?? "3:4";
      const ratios: Record<string, string> = { "3:4": "133.33%", "4:5": "125%", "1:1": "100%", "16:9": "56.25%", free: "0" };
      const padTop = ratios[ratio];
      if (ratio === "free") {
        return (
          <Img
            {...tagAttr(node.id, editorMode)}
            src={node.src}
            alt={node.alt}
            style={{ display: "block", width: "100%", maxWidth: "100%", height: "auto" }}
          />
        );
      }
      const inner = (
        <div
          style={{
            position: "relative",
            width: "100%",
            paddingTop: padTop,
            background: c.surfaceAlt,
            overflow: "hidden",
          }}
        >
          <Img
            src={node.src}
            alt={node.alt}
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              width: "100%",
              height: "100%",
              objectFit: "cover",
              objectPosition: "center",
              display: "block",
            }}
          />
        </div>
      );
      return (
        <div {...tagAttr(node.id, editorMode)}>
          {node.href ? (
            <Link href={node.href} style={{ textDecoration: "none" }}>
              {inner}
            </Link>
          ) : (
            inner
          )}
        </div>
      );
    }
    case "spacer":
      return (
        <div
          {...tagAttr(node.id, editorMode)}
          style={{ height: `${node.height}px`, lineHeight: `${node.height}px`, fontSize: 0 }}
        >
          &nbsp;
        </div>
      );
    case "divider":
      return <Hr {...tagAttr(node.id, editorMode)} style={{ borderColor: c.border, margin: "12px 0" }} />;
    case "rating": {
      const filled = Math.max(0, Math.min(5, Math.round(node.rating)));
      const stars = "★".repeat(filled) + "☆".repeat(5 - filled);
      return (
        <Text
          {...tagAttr(node.id, editorMode)}
          style={{
            margin: "0 0 8px 0",
            fontFamily: FONTS.body,
            fontWeight: 500,
            fontSize: "14px",
            color: c.text,
            letterSpacing: "0.14em",
            textAlign: "center",
          }}
        >
          {stars}
          {node.count != null && (
            <span style={{ color: c.textFaint, fontWeight: 400 }}> ({node.count})</span>
          )}
        </Text>
      );
    }
    case "discount-badge":
      return (
        <Section {...tagAttr(node.id, editorMode)} style={{ textAlign: "center", padding: "8px 0 16px" }}>
          <span
            style={{
              display: "inline-block",
              background: c.badgeBg,
              color: c.badgeFg,
              fontFamily: FONTS.head,
              fontWeight: 600,
              fontSize: "13px",
              letterSpacing: "0.28em",
              padding: "12px 22px",
              textTransform: "uppercase",
            }}
          >
            {node.discount_percent}% off exclusivo
          </span>
        </Section>
      );
    case "coupon":
      return (
        <Section
          {...tagAttr(node.id, editorMode)}
          style={{
            border: `1px solid ${c.text}`,
            background: c.bg,
            padding: "30px 24px",
            textAlign: "center",
            margin: "8px 0 16px",
          }}
        >
          <Text
            style={{
              margin: "0 0 14px 0",
              fontFamily: FONTS.body,
              fontWeight: 500,
              fontSize: "11px",
              color: c.textSecondary,
              letterSpacing: "0.32em",
              textTransform: "uppercase",
            }}
          >
            Cupom exclusivo
          </Text>
          <span
            style={{
              fontFamily: FONTS.mono,
              fontWeight: 500,
              fontSize: "22px",
              color: c.text,
              background: c.surfaceAlt,
              padding: "16px 26px",
              letterSpacing: "0.18em",
              display: "inline-block",
            }}
          >
            {node.code}
          </span>
          <Text
            style={{
              margin: "18px 0 0 0",
              fontFamily: FONTS.body,
              fontSize: "14px",
              color: c.textSecondary,
            }}
          >
            {node.discount_percent}% off em {node.product_name}
          </Text>
        </Section>
      );
    case "countdown": {
      let url = "";
      try {
        url = buildCountdownUrl({
          base_url: APP_BASE_URL,
          expires_at: new Date(node.expires_at),
        });
      } catch {
        url = "";
      }
      return (
        <div {...tagAttr(node.id, editorMode)} style={{ background: c.text }}>
          <Img
            src={url}
            alt="Última chance"
            width="600"
            height="220"
            style={{ width: "100%", maxWidth: "600px", height: "auto", display: "block", background: c.text }}
          />
        </div>
      );
    }
    case "product-meta":
      return (
        <Section {...tagAttr(node.id, editorMode)} style={{ textAlign: "center", padding: "0 0 14px" }}>
          <Text style={{ margin: "0 0 4px 0", fontFamily: FONTS.body, fontWeight: 500, fontSize: "15px", color: c.textMuted, letterSpacing: "0.04em" }}>
            {node.name}
          </Text>
          <Text style={{ margin: 0, fontFamily: FONTS.head, fontWeight: 600, fontSize: "22px", color: c.text }}>
            {node.old_price && (
              <span style={{ fontFamily: FONTS.body, fontWeight: 400, fontSize: "14px", color: c.textFaint, textDecoration: "line-through", marginRight: "12px" }}>
                R$ {node.old_price.toFixed(2)}
              </span>
            )}
            R$ {node.price.toFixed(2)}
          </Text>
        </Section>
      );
    case "product-card":
      return (
        <Section {...tagAttr(node.id, editorMode)} style={{ textAlign: node.align ?? "center", padding: "8px 0 16px" }}>
          <Img
            src={node.product.image_url}
            alt={node.product.name}
            width="180"
            height="225"
            style={{ width: "100%", maxWidth: "180px", height: "225px", objectFit: "cover", display: "block", margin: "0 auto 12px" }}
          />
          <Text style={{ margin: "0 0 4px 0", fontFamily: FONTS.body, fontWeight: 500, fontSize: "14px", color: c.text }}>
            {node.product.name}
          </Text>
          {node.show_price !== false && (
            <Text style={{ margin: "0 0 8px 0", fontFamily: FONTS.head, fontWeight: 500, fontSize: "16px", color: c.text }}>
              R$ {node.product.price.toFixed(2)}
            </Text>
          )}
          {node.show_button !== false && (
            <Link
              href={node.product.url}
              style={{
                display: "inline-block",
                fontFamily: FONTS.body,
                fontWeight: 500,
                fontSize: "11px",
                color: c.text,
                letterSpacing: "0.28em",
                textTransform: "uppercase",
                borderBottom: `1px solid ${c.text}`,
                paddingBottom: "3px",
                textDecoration: "none",
              }}
            >
              {node.button_text ?? "Ver produto"}
            </Link>
          )}
        </Section>
      );
    case "product-grid": {
      const cols = node.columns;
      const rows: typeof node.products[] = [];
      for (let i = 0; i < node.products.length; i += cols) {
        rows.push(node.products.slice(i, i + cols));
      }
      return (
        <Section {...tagAttr(node.id, editorMode)} style={{ padding: "0" }}>
          {rows.map((rowProducts, ri) => (
            <Row key={ri}>
              {rowProducts.map((p, idx) => {
                const number = ri * cols + idx + 1;
                return (
                  <Column
                    key={p.vnda_id + idx}
                    style={{ width: `${Math.floor(100 / cols)}%`, padding: "0 8px 24px", verticalAlign: "top" }}
                  >
                    {node.numbered && (
                      <Text style={{ margin: "0 0 4px 0", fontFamily: FONTS.head, fontStyle: "italic", fontSize: "20px", color: c.textFaint }}>
                        {String(number).padStart(2, "0")}
                      </Text>
                    )}
                    <Img
                      src={p.image_url}
                      alt={p.name}
                      width="180"
                      height="225"
                      style={{ width: "100%", height: "auto", objectFit: "cover", display: "block", marginBottom: "10px" }}
                    />
                    <Text style={{ margin: "0 0 4px 0", fontFamily: FONTS.body, fontWeight: 500, fontSize: "13px", color: c.text, lineHeight: 1.4 }}>
                      {p.name}
                    </Text>
                    <Text style={{ margin: 0, fontFamily: FONTS.head, fontWeight: 500, fontSize: "14px", color: c.text }}>
                      R$ {p.price.toFixed(2)}
                    </Text>
                  </Column>
                );
              })}
              {/* Pad with empty columns so last row stays aligned */}
              {rowProducts.length < cols &&
                Array.from({ length: cols - rowProducts.length }).map((_, i) => (
                  <Column key={"pad" + i} style={{ width: `${Math.floor(100 / cols)}%` }}>
                    &nbsp;
                  </Column>
                ))}
            </Row>
          ))}
        </Section>
      );
    }
    case "slash-labels":
      return (
        <Text
          {...tagAttr(node.id, editorMode)}
          style={{
            margin: "0 0 12px 0",
            fontFamily: FONTS.head,
            fontWeight: 500,
            fontSize: "12px",
            color: c.textSecondary,
            textAlign: node.align ?? "center",
            letterSpacing: "0.28em",
            textTransform: "uppercase",
          }}
        >
          {node.labels.join("  /  ")}
        </Text>
      );
    case "logo": {
      const w = Math.max(60, Math.min(300, node.width ?? 148));
      const isDefault = !node.image_url || node.image_url.includes("logobulkingsite");
      const showText = mode === "dark" && isDefault;
      return (
        <Section
          {...tagAttr(node.id, editorMode)}
          style={{
            textAlign: "center",
            padding: "32px 24px 24px",
            borderBottom: `1px solid ${c.border}`,
          }}
        >
          {showText ? (
            <span
              style={{
                fontFamily: FONTS.head,
                fontWeight: 500,
                fontSize: `${Math.round(w * 0.13)}px`,
                letterSpacing: "0.32em",
                color: c.text,
                textTransform: "uppercase",
              }}
            >
              BULKING
            </span>
          ) : (
            <Img
              src={node.image_url}
              alt={node.alt ?? "BULKING"}
              width={w}
              style={{ display: "inline-block", width: `${w}px`, height: "auto", maxWidth: `${w}px`, border: 0 }}
            />
          )}
        </Section>
      );
    }
  }
}

function ColumnRenderer({ node, mode, editorMode }: { node: ColumnNode; mode: Mode; editorMode: boolean }) {
  return (
    <Column
      {...tagAttr(node.id, editorMode)}
      style={{
        width: node.width_pct != null ? `${node.width_pct}%` : undefined,
        verticalAlign: node.v_align ?? "top",
        padding: node.padding ?? "0 12px",
      }}
    >
      {node.children.map((child) => (
        <LeafRenderer key={child.id} node={child} mode={mode} editorMode={editorMode} />
      ))}
    </Column>
  );
}

function RowRenderer({ node, mode, editorMode }: { node: RowNode; mode: Mode; editorMode: boolean }) {
  return (
    <Row {...tagAttr(node.id, editorMode)}>
      {node.columns.map((col) => (
        <ColumnRenderer key={col.id} node={col} mode={mode} editorMode={editorMode} />
      ))}
    </Row>
  );
}

function SectionRenderer({ node, mode, editorMode }: { node: SectionNode; mode: Mode; editorMode: boolean }) {
  return (
    <Section
      {...tagAttr(node.id, editorMode)}
      style={{
        background: node.bg,
        padding: node.padding ?? "32px 32px",
        textAlign: node.align,
      }}
    >
      {node.children.map((child) =>
        child.type === "row" ? (
          <RowRenderer key={child.id} node={child} mode={mode} editorMode={editorMode} />
        ) : (
          <LeafRenderer key={child.id} node={child} mode={mode} editorMode={editorMode} />
        )
      )}
    </Section>
  );
}

// ---------- Top-level email shell ----------

function EmailShell({
  draft,
  editorMode,
}: {
  draft: TreeDraft;
  editorMode: boolean;
}) {
  const c = PALETTES[draft.meta.mode];
  return (
    <Html lang="pt-BR">
      <Head>
        <link
          href="https://fonts.googleapis.com/css2?family=Kanit:wght@300;400;500;600&family=Inter:wght@300;400;500;600&display=swap"
          rel="stylesheet"
        />
      </Head>
      <Body style={{ margin: 0, padding: 0, background: c.canvas }}>
        <div style={{ display: "none", maxHeight: 0, overflow: "hidden", color: c.canvas }}>
          {draft.meta.preview}
        </div>
        <Container
          style={{
            width: "600px",
            maxWidth: "600px",
            background: c.bg,
            margin: "0 auto",
          }}
        >
          {draft.sections.map((s) => (
            <SectionRenderer key={s.id} node={s} mode={draft.meta.mode} editorMode={editorMode} />
          ))}
        </Container>
      </Body>
    </Html>
  );
}

// ---------- Editor click-handler script ----------

function buildEditorScript(mode: Mode): string {
  const hover = mode === "dark" ? "1px dashed rgba(255,255,255,.45)" : "1px dashed rgba(0,0,0,.35)";
  const selected = mode === "dark" ? "2px solid #60a5fa" : "2px solid #2563eb";
  return `(function(){var sel=null;function clear(){if(sel){sel.style.outline='';sel.style.outlineOffset='';sel=null;}}document.addEventListener('mouseover',function(e){var t=e.target&&e.target.closest&&e.target.closest('[data-block-id]');if(!t||t===sel)return;var prev=document.querySelector('.__hover');if(prev){prev.classList.remove('__hover');prev.style.outline='';}t.classList.add('__hover');t.style.outline='${hover}';t.style.outlineOffset='-1px';},true);document.addEventListener('mouseout',function(e){var t=e.target&&e.target.closest&&e.target.closest('[data-block-id]');if(!t||t===sel)return;t.classList.remove('__hover');t.style.outline='';},true);document.addEventListener('click',function(e){var t=e.target&&e.target.closest&&e.target.closest('[data-block-id]');if(!t)return;e.preventDefault();e.stopPropagation();clear();sel=t;t.style.outline='${selected}';t.style.outlineOffset='-2px';try{parent.postMessage({type:'block:select',id:t.getAttribute('data-block-id')},'*');}catch(err){}},true);window.addEventListener('message',function(e){if(!e.data||e.data.type!=='block:set-selected')return;clear();var id=e.data.id;if(!id)return;var nodes=document.querySelectorAll('[data-block-id="'+id+'"]');if(nodes.length===0)return;sel=nodes[0];nodes.forEach(function(n){n.style.outline='${selected}';n.style.outlineOffset='-2px';});});})();`;
}

// ---------- Public render ----------

export interface RenderOpts {
  editorMode?: boolean;
}

export async function renderTreeDraft(draft: TreeDraft, opts: RenderOpts = {}): Promise<string> {
  const editorMode = !!opts.editorMode;
  const html = await render(<EmailShell draft={draft} editorMode={editorMode} />);
  if (!editorMode) return html;
  const script = `<script>${buildEditorScript(draft.meta.mode)}</script>`;
  return html.replace("</body>", `${script}</body>`);
}
