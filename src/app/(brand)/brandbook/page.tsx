"use client";

import React, { useState, useEffect } from "react";
import Link from "next/link";
import { ArrowLeft, ChevronUp, Printer, Copy, Check } from "lucide-react";

/* ========================================================================
   BULKING BRANDBOOK — Pagina standalone com estetica da marca
   Fundo preto, texto branco, cinzas para hierarquia, verde (#49E472) accent
   Tipografia: Kanit (headings), Inter (body)
   ======================================================================== */

// ---------------------------------------------------------------------------
// Tokens
// ---------------------------------------------------------------------------
const T = {
  bg: "#000000",
  surface: "#0A0A0A",
  surfaceAlt: "#141414",
  border: "#262626",
  borderSubtle: "#1A1A1A",
  textPrimary: "#FFFFFF",
  textSecondary: "#A1A1A1",
  textMuted: "#666666",
  accent: "#49E472",
  accentDark: "#3BC45E",
} as const;

const COLORS = {
  primary: [
    { name: "Bulking Black", hex: "#000000", rgb: "0, 0, 0", use: "Cor principal. Fundos, textos, base da identidade." },
    { name: "Hustle Green", hex: "#49E472", rgb: "73, 228, 114", use: "Accent. CTAs, destaques, energia." },
    { name: "Pure White", hex: "#FFFFFF", rgb: "255, 255, 255", use: "Textos sobre fundo escuro, respiro." },
  ],
  neutrals: [
    { name: "Light Gray", hex: "#F5F5F5", rgb: "245, 245, 245", use: "Fundos claros, cards." },
    { name: "Mid Gray", hex: "#D9D9D9", rgb: "217, 217, 217", use: "Bordas, separadores." },
    { name: "Text Gray", hex: "#707070", rgb: "112, 112, 112", use: "Texto secundario, labels." },
    { name: "Dark Gray", hex: "#383838", rgb: "56, 56, 56", use: "Texto em fundo claro." },
  ],
  feedback: [
    { name: "Success", hex: "#49E472", use: "Confirmacoes" },
    { name: "Warning", hex: "#F5A623", use: "Alertas" },
    { name: "Error", hex: "#E74C3C", use: "Erros" },
    { name: "Info", hex: "#3498DB", use: "Informacoes" },
  ],
};

const NAV_ITEMS = [
  { id: "arquetipo", label: "Arquetipo" },
  { id: "estrategia", label: "Estrategia" },
  { id: "posicionamento", label: "Posicionamento" },
  { id: "visual", label: "Visual" },
  { id: "verbal", label: "Verbal" },
  { id: "story", label: "Story" },
  { id: "design-system", label: "Design System" },
  { id: "cultura", label: "Cultura" },
];

// ---------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------
function useCopy() {
  const [copied, setCopied] = useState<string | null>(null);
  const copy = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(text);
    setTimeout(() => setCopied(null), 1500);
  };
  return { copied, copy };
}

// ---------------------------------------------------------------------------
// Atoms
// ---------------------------------------------------------------------------
function SectionTitle({ id, number, title, subtitle }: { id: string; number: string; title: string; subtitle?: string }) {
  return (
    <div id={id} className="scroll-mt-24 mb-12 md:mb-16">
      <p className="text-xs uppercase tracking-[0.3em] mb-3" style={{ color: T.accent, fontFamily: "'Kanit', sans-serif" }}>
        {number}
      </p>
      <h2
        className="text-3xl md:text-5xl font-bold mb-3 leading-tight"
        style={{ fontFamily: "'Kanit', sans-serif" }}
      >
        {title}
      </h2>
      {subtitle && <p className="text-lg" style={{ color: T.textSecondary }}>{subtitle}</p>}
      <div className="mt-6 h-px w-16" style={{ backgroundColor: T.accent }} />
    </div>
  );
}

function Card({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <div
      className={`rounded-lg p-6 ${className}`}
      style={{ backgroundColor: T.surfaceAlt, border: `1px solid ${T.border}` }}
    >
      {children}
    </div>
  );
}

function Badge({ children, variant = "default" }: { children: React.ReactNode; variant?: "default" | "green" | "red" | "yellow" }) {
  const colors = {
    default: { bg: T.border, text: T.textSecondary },
    green: { bg: "rgba(73,228,114,0.15)", text: T.accent },
    red: { bg: "rgba(231,76,60,0.15)", text: "#E74C3C" },
    yellow: { bg: "rgba(245,166,35,0.15)", text: "#F5A623" },
  };
  const c = colors[variant];
  return (
    <span className="inline-block text-xs font-medium px-2.5 py-1 rounded-full" style={{ backgroundColor: c.bg, color: c.text }}>
      {children}
    </span>
  );
}

function ProgressBar({ value, max = 10, label }: { value: number; max?: number; label: string }) {
  const pct = (value / max) * 100;
  return (
    <div className="flex items-center gap-3">
      <span className="text-xs w-20 shrink-0" style={{ color: T.textMuted }}>{label}</span>
      <div className="flex-1 h-2 rounded-full" style={{ backgroundColor: T.border }}>
        <div className="h-2 rounded-full transition-all" style={{ width: `${pct}%`, backgroundColor: T.accent }} />
      </div>
      <span className="text-xs font-mono w-8 text-right" style={{ color: T.textSecondary }}>{value}/{max}</span>
    </div>
  );
}

function ColorSwatch({ name, hex, rgb, use, size = "md" }: { name: string; hex: string; rgb?: string; use?: string; size?: "sm" | "md" }) {
  const { copied, copy } = useCopy();
  const isCopied = copied === hex;
  return (
    <button onClick={() => copy(hex)} className="text-left group w-full">
      <div
        className={`rounded-lg mb-3 transition-transform group-hover:scale-[1.02] ${size === "md" ? "h-24 md:h-32" : "h-16"}`}
        style={{ backgroundColor: hex, border: hex === "#000000" || hex === "#FFFFFF" ? `1px solid ${T.border}` : "none" }}
      />
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium">{name}</p>
        {isCopied ? <Check className="w-3 h-3" style={{ color: T.accent }} /> : <Copy className="w-3 h-3 opacity-0 group-hover:opacity-50 transition-opacity" />}
      </div>
      <p className="text-xs font-mono mt-0.5" style={{ color: T.textMuted }}>{hex}{rgb ? ` · ${rgb}` : ""}</p>
      {use && <p className="text-xs mt-1" style={{ color: T.textSecondary }}>{use}</p>}
    </button>
  );
}

function Table({ headers, rows }: { headers: string[]; rows: string[][] }) {
  return (
    <div className="overflow-x-auto rounded-lg" style={{ border: `1px solid ${T.border}` }}>
      <table className="w-full text-sm">
        <thead>
          <tr style={{ backgroundColor: T.surfaceAlt }}>
            {headers.map((h, i) => (
              <th key={i} className="text-left px-4 py-3 text-xs uppercase tracking-wider font-semibold" style={{ color: T.textSecondary, borderBottom: `1px solid ${T.border}`, fontFamily: "'Kanit', sans-serif" }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} className="transition-colors hover:bg-white/[0.02]" style={{ borderBottom: i < rows.length - 1 ? `1px solid ${T.borderSubtle}` : "none" }}>
              {row.map((cell, j) => (
                <td key={j} className="px-4 py-3" style={{ color: j === 0 ? T.textPrimary : T.textSecondary }}>{cell}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function TypographySpecimen({ label, weight, size, font, sample }: { label: string; weight: number; size: string; font: string; sample: string }) {
  return (
    <div className="py-6" style={{ borderBottom: `1px solid ${T.borderSubtle}` }}>
      <div className="flex items-baseline justify-between mb-2">
        <span className="text-xs uppercase tracking-wider" style={{ color: T.accent, fontFamily: "'Kanit', sans-serif" }}>{label}</span>
        <span className="text-xs font-mono" style={{ color: T.textMuted }}>{weight} · {size}</span>
      </div>
      <p style={{ fontFamily: font, fontWeight: weight, fontSize: size, lineHeight: 1.2, color: T.textPrimary }}>{sample}</p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------
export default function BrandbookPage() {
  const [activeSection, setActiveSection] = useState("");
  const [showTop, setShowTop] = useState(false);

  useEffect(() => {
    const handleScroll = () => setShowTop(window.scrollY > 600);
    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) { setActiveSection(e.target.id); break; }
        }
      },
      { rootMargin: "-100px 0px -60% 0px", threshold: 0.1 }
    );
    NAV_ITEMS.forEach(({ id }) => {
      const el = document.getElementById(id);
      if (el) observer.observe(el);
    });
    return () => observer.disconnect();
  }, []);

  return (
    <>
      {/* Google Fonts */}
      {/* eslint-disable-next-line @next/next/no-page-custom-font */}
      <link href="https://fonts.googleapis.com/css2?family=Kanit:wght@300;400;500;600;700;800&family=Inter:wght@300;400;500;600&family=JetBrains+Mono:wght@400&display=swap" rel="stylesheet" />

      <div className="min-h-screen" style={{ backgroundColor: T.bg, color: T.textPrimary }}>

        {/* ============================================================= */}
        {/* TOPBAR */}
        {/* ============================================================= */}
        <div className="fixed top-0 left-0 right-0 z-40 flex items-center justify-between px-4 md:px-8 py-3 print:hidden" style={{ backgroundColor: "rgba(0,0,0,0.6)", backdropFilter: "blur(12px)", borderBottom: `1px solid ${T.borderSubtle}` }}>
          <Link href="/" className="flex items-center gap-2 text-sm transition-colors hover:text-white" style={{ color: T.textMuted }}>
            <ArrowLeft className="w-4 h-4" />
            <span className="hidden sm:inline">Dashboard</span>
          </Link>
          <button onClick={() => window.print()} className="flex items-center gap-2 text-sm transition-colors hover:text-white" style={{ color: T.textMuted }}>
            <Printer className="w-4 h-4" />
            <span className="hidden sm:inline">Imprimir</span>
          </button>
        </div>

        {/* ============================================================= */}
        {/* HERO */}
        {/* ============================================================= */}
        <section className="flex flex-col items-center justify-center text-center min-h-screen px-6 pt-16">
          <p className="text-xs uppercase tracking-[0.4em] mb-8" style={{ color: T.textMuted }}>Brandbook &amp; Manual da Marca</p>
          <h1
            className="text-7xl sm:text-8xl md:text-9xl font-extrabold leading-none tracking-tight mb-6"
            style={{ fontFamily: "'Kanit', sans-serif" }}
          >
            BULKING
          </h1>
          <p className="text-lg md:text-xl mb-2" style={{ color: T.textSecondary, fontFamily: "'Kanit', sans-serif", fontWeight: 300 }}>
            Respect the Hustle.
          </p>
          <p className="text-xs mt-6" style={{ color: T.textMuted }}>v1.0 — Marco 2026</p>
          <div className="mt-16 animate-bounce">
            <div className="w-px h-12 mx-auto" style={{ background: `linear-gradient(to bottom, ${T.textMuted}, transparent)` }} />
          </div>
        </section>

        {/* ============================================================= */}
        {/* NAV STICKY */}
        {/* ============================================================= */}
        <nav className="sticky top-[49px] z-30 print:hidden overflow-x-auto" style={{ backgroundColor: "rgba(0,0,0,0.85)", backdropFilter: "blur(12px)", borderBottom: `1px solid ${T.borderSubtle}` }}>
          <div className="max-w-6xl mx-auto flex items-center gap-1 px-4 md:px-8 py-2">
            {NAV_ITEMS.map(({ id, label }) => (
              <a
                key={id}
                href={`#${id}`}
                className="shrink-0 px-3 py-1.5 rounded text-xs font-medium transition-colors"
                style={{
                  fontFamily: "'Kanit', sans-serif",
                  color: activeSection === id ? T.accent : T.textMuted,
                  backgroundColor: activeSection === id ? "rgba(73,228,114,0.1)" : "transparent",
                }}
                onClick={(e) => { e.preventDefault(); document.getElementById(id)?.scrollIntoView({ behavior: "smooth" }); }}
              >
                {label}
              </a>
            ))}
          </div>
        </nav>

        {/* ============================================================= */}
        {/* CONTENT */}
        {/* ============================================================= */}
        <main className="max-w-5xl mx-auto px-6 md:px-8">

          {/* =========================================================== */}
          {/* 1. ARQUETIPO */}
          {/* =========================================================== */}
          <section className="py-20 md:py-28">
            <SectionTitle id="arquetipo" number="01" title="Perfil Arquetipico" subtitle="12 Arquetipos Junguianos — Margaret Mark & Carol Pearson" />

            {/* Scorecard Top 3 */}
            <div className="space-y-4 mb-12">
              <h3 className="text-lg font-semibold mb-4" style={{ fontFamily: "'Kanit', sans-serif" }}>Scorecard</h3>
              <ProgressBar value={25} max={30} label="Hero" />
              <ProgressBar value={20} max={30} label="Outlaw" />
              <ProgressBar value={19} max={30} label="Creator" />
            </div>

            {/* Archetypes Selected */}
            <div className="grid md:grid-cols-2 gap-4 mb-12">
              <Card>
                <Badge variant="green">Primario — 75%</Badge>
                <h3 className="text-2xl font-bold mt-3 mb-2" style={{ fontFamily: "'Kanit', sans-serif" }}>Hero</h3>
                <p className="text-sm mb-4" style={{ color: T.textSecondary }}>O Hero disciplinado que constroi — nao apenas reage com coragem, mas projeta com intencao.</p>
                <Table
                  headers={["Elemento", "Definicao"]}
                  rows={[
                    ["Desejo", "Provar valor atraves de acao disciplinada"],
                    ["Objetivo", "Maestria — melhor versao de si mesmo"],
                    ["Medo", "Fraqueza, estagnacao, mediocridade"],
                    ["Estrategia", "Ser forte, competente e determinado"],
                    ["Dom", "Inspirar outros pelo exemplo"],
                  ]}
                />
              </Card>
              <Card>
                <Badge>Secundario — 25%</Badge>
                <h3 className="text-2xl font-bold mt-3 mb-2" style={{ fontFamily: "'Kanit', sans-serif" }}>Creator</h3>
                <p className="text-sm mb-4" style={{ color: T.textSecondary }}>A moda fitness com design e o Creator — fashion fitness como expressao de identidade.</p>
                <div className="mt-6 p-4 rounded-lg" style={{ backgroundColor: T.surface, border: `1px solid ${T.borderSubtle}` }}>
                  <p className="text-xs uppercase tracking-wider mb-2" style={{ color: T.accent, fontFamily: "'Kanit', sans-serif" }}>Shadow — O Que Evitar</p>
                  <ul className="space-y-1.5 text-sm" style={{ color: T.textSecondary }}>
                    <li>• Arrogancia e elitismo</li>
                    <li>• Fazer o cliente sentir que nao treina o suficiente</li>
                    <li>• Design pelo design, sem funcao</li>
                    <li>• Cultura toxica de overtraining</li>
                  </ul>
                </div>
              </Card>
            </div>

            {/* Competitive Map */}
            <h3 className="text-lg font-semibold mb-4" style={{ fontFamily: "'Kanit', sans-serif" }}>Mapa Competitivo</h3>
            <div className="grid sm:grid-cols-3 gap-4 mb-12">
              {[
                { brand: "Bulking", arch: "Hero + Creator", desc: "Disciplina + design. Hustle com estilo.", highlight: true },
                { brand: "Mith", arch: "Hero + Sage", desc: "Nostalgia da Era de Ouro. Reverencia aos classicos.", highlight: false },
                { brand: "Berzerk", arch: "Outlaw + Hero", desc: "Disruptivo, intenso, oversized. Rebeliao no shape.", highlight: false },
              ].map((c) => (
                <div key={c.brand} className="rounded-lg p-5" style={{ backgroundColor: T.surfaceAlt, border: c.highlight ? `1px solid ${T.accent}` : `1px solid ${T.border}` }}>
                  <p className="text-lg font-bold mb-1" style={{ fontFamily: "'Kanit', sans-serif", color: c.highlight ? T.accent : T.textPrimary }}>{c.brand}</p>
                  <p className="text-xs mb-2" style={{ color: T.textMuted }}>{c.arch}</p>
                  <p className="text-sm" style={{ color: T.textSecondary }}>{c.desc}</p>
                </div>
              ))}
            </div>

            {/* Cheat Sheet */}
            <h3 className="text-lg font-semibold mb-4" style={{ fontFamily: "'Kanit', sans-serif" }}>Cheat Sheet para o Time</h3>
            <div className="grid md:grid-cols-2 gap-4">
              <Card>
                <p className="text-xs uppercase tracking-wider mb-4" style={{ color: T.accent, fontFamily: "'Kanit', sans-serif" }}>Do — Faca</p>
                <ul className="space-y-2 text-sm" style={{ color: T.textSecondary }}>
                  {["Fale com confianca e determinacao", "Valorize o processo e a consistencia", "Mostre resultado real, nao promessa", "Use estetica limpa, forte e intencional", "Trate o cliente como parceiro de treino", "Celebre o esforco, nao so o resultado final"].map((t) => (
                    <li key={t} className="flex items-start gap-2"><span style={{ color: T.accent }}>+</span>{t}</li>
                  ))}
                </ul>
              </Card>
              <Card>
                <p className="text-xs uppercase tracking-wider mb-4" style={{ color: "#E74C3C", fontFamily: "'Kanit', sans-serif" }}>Don&apos;t — Nao Faca</p>
                <ul className="space-y-2 text-sm" style={{ color: T.textSecondary }}>
                  {["Nao grite ou use CAPSLOCK excessivo", "Nao ridicularize quem esta comecando", "Nao use motivacao barata (\"vai la campeao!\")", "Nao copie a estetica de marcas de suplemento", "Nao promova cultura toxica de overtraining", "Nao use humor excessivo — o Hero e serio"].map((t) => (
                    <li key={t} className="flex items-start gap-2"><span style={{ color: "#E74C3C" }}>−</span>{t}</li>
                  ))}
                </ul>
              </Card>
            </div>
          </section>

          {/* =========================================================== */}
          {/* 2. ESTRATEGIA */}
          {/* =========================================================== */}
          <section className="py-20 md:py-28" style={{ borderTop: `1px solid ${T.border}` }}>
            <SectionTitle id="estrategia" number="02" title="Estrategia de Marca" subtitle="Aaker Brand Vision + Kapferer Identity Prism + Sharp Distinctive Assets" />

            {/* Brand Essence */}
            <div className="text-center py-16 mb-12 rounded-lg" style={{ backgroundColor: T.surfaceAlt, border: `1px solid ${T.border}` }}>
              <p className="text-xs uppercase tracking-[0.3em] mb-4" style={{ color: T.textMuted }}>Brand Essence</p>
              <p className="text-3xl md:text-5xl font-bold" style={{ fontFamily: "'Kanit', sans-serif" }}>&ldquo;Disciplina com estilo.&rdquo;</p>
            </div>

            {/* Core Identity */}
            <h3 className="text-lg font-semibold mb-4" style={{ fontFamily: "'Kanit', sans-serif" }}>Core Identity</h3>
            <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-16">
              {[
                { n: "01", t: "Hustle como valor", d: "O trabalho duro e celebrado, nao romantizado" },
                { n: "02", t: "Fashion fitness", d: "Design autoral aplicado a roupa de treino" },
                { n: "03", t: "Custo-beneficio", d: "Qualidade real por preco justo" },
                { n: "04", t: "Masculinidade contemporanea", d: "Forte e estiloso, sem toxicidade" },
              ].map((item) => (
                <Card key={item.n}>
                  <p className="text-xs font-mono mb-2" style={{ color: T.accent }}>{item.n}</p>
                  <p className="text-sm font-semibold mb-1" style={{ fontFamily: "'Kanit', sans-serif" }}>{item.t}</p>
                  <p className="text-xs" style={{ color: T.textSecondary }}>{item.d}</p>
                </Card>
              ))}
            </div>

            {/* Kapferer Prism */}
            <h3 className="text-lg font-semibold mb-4" style={{ fontFamily: "'Kanit', sans-serif" }}>Prisma de Identidade Kapferer</h3>
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4 mb-16">
              {[
                { facet: "Fisico", desc: "Preto + verde neon. Wordmark bold. Tecidos tecnicos. Corte diferenciado P-GG." },
                { facet: "Personalidade", desc: "Determinado, confiante, direto, com bom gosto. Serio mas nao carrancudo." },
                { facet: "Cultura", desc: "Hustle culture positiva. Disciplina brasileira. Meritocracia do esforco." },
                { facet: "Relacao", desc: "Parceiro de treino. Coach acessivel. \"Eu te respeito porque voce faz o trabalho.\"" },
                { facet: "Reflexo", desc: "\"Eu sou o cara que treina e veste bem. Forte, estiloso e dedicado.\"" },
                { facet: "Autoimagem", desc: "\"Meu shape e meu estilo sao resultado do meu trabalho. Eu mereco vestir algo a altura.\"" },
              ].map((f) => (
                <Card key={f.facet}>
                  <p className="text-xs uppercase tracking-wider mb-2" style={{ color: T.accent, fontFamily: "'Kanit', sans-serif" }}>{f.facet}</p>
                  <p className="text-sm" style={{ color: T.textSecondary }}>{f.desc}</p>
                </Card>
              ))}
            </div>

            {/* Distinctive Assets */}
            <h3 className="text-lg font-semibold mb-4" style={{ fontFamily: "'Kanit', sans-serif" }}>Ativos Distintivos (Byron Sharp)</h3>
            <Table
              headers={["Ativo", "Status", "Meta", "Prioridade"]}
              rows={[
                ["Cor verde #49E472", "Presente no site", "Sinonimo da marca", "Critica"],
                ["Wordmark BULKING", "Logo existente", "Maximizar reconhecimento", "Alta"],
                ["\"Respect the Hustle\"", "Tagline no IG", "Frase iconica", "Alta"],
                ["Tipografia Kanit", "Usada no site", "Padronizar em tudo", "Media"],
                ["Estetica preto + verde", "Inconsistente", "Padrao unico", "Alta"],
              ]}
            />
          </section>

          {/* =========================================================== */}
          {/* 3. POSICIONAMENTO */}
          {/* =========================================================== */}
          <section className="py-20 md:py-28" style={{ borderTop: `1px solid ${T.border}` }}>
            <SectionTitle id="posicionamento" number="03" title="Posicionamento" subtitle="Al Ries Positioning Theory + Marty Neumeier Onlyness/Zag" />

            {/* The Word */}
            <div className="text-center py-12 mb-12 rounded-lg" style={{ backgroundColor: T.surfaceAlt, border: `1px solid ${T.border}` }}>
              <p className="text-xs uppercase tracking-[0.3em] mb-4" style={{ color: T.textMuted }}>A Palavra da Bulking</p>
              <p className="text-5xl md:text-7xl font-extrabold" style={{ fontFamily: "'Kanit', sans-serif", color: T.accent }}>HUSTLE</p>
              <p className="text-sm mt-4 max-w-md mx-auto" style={{ color: T.textSecondary }}>Trabalho duro, determinacao, processo diario, merecimento. Quando alguem pensa em &ldquo;hustle + roupa fitness&rdquo;, deve pensar Bulking.</p>
            </div>

            {/* Positioning Statements */}
            <h3 className="text-lg font-semibold mb-4" style={{ fontFamily: "'Kanit', sans-serif" }}>Positioning Statements</h3>
            <div className="space-y-4 mb-12">
              {[
                { type: "Target-Led", text: "Para homens que treinam de verdade e querem vestir a altura do shape que construiram, Bulking e a marca de roupas fitness que combina design autoral com caimento diferenciado, porque quem faz o trabalho merece vestir o resultado." },
                { type: "Benefit-Led", text: "Bulking e a unica marca de roupa fitness masculina que entrega estilo e caimento para corpos treinados por um preco justo, porque acreditamos que disciplina no treino merece disciplina no design." },
                { type: "Category-Led", text: "Na categoria de roupas fitness masculinas, Bulking e a marca que une fashion e academia — com design autoral, corte para quem treina, e o melhor custo-beneficio do mercado." },
              ].map((s) => (
                <div key={s.type} className="p-5 rounded-lg" style={{ backgroundColor: T.surfaceAlt, borderLeft: `3px solid ${T.accent}` }}>
                  <p className="text-xs uppercase tracking-wider mb-2" style={{ color: T.accent, fontFamily: "'Kanit', sans-serif" }}>{s.type}</p>
                  <p className="text-sm leading-relaxed" style={{ color: T.textSecondary }}>{s.text}</p>
                </div>
              ))}
            </div>

            {/* Zag Table */}
            <h3 className="text-lg font-semibold mb-4" style={{ fontFamily: "'Kanit', sans-serif" }}>Zag — Diferenciacao Radical</h3>
            <Table
              headers={["Eles fazem...", "Bulking faz..."]}
              rows={[
                ["Roupas genericas de academia", "Moda fitness com design autoral"],
                ["Tamanho padrao", "Corte para corpos treinados (P-GG)"],
                ["Preco premium OU qualidade baixa", "Custo-beneficio real"],
                ["Referencia ao passado (Mith)", "Foco no presente e futuro"],
                ["Uma silhueta so (Berzerk = oversized)", "Variedade de cortes e estilos"],
                ["Performance pura (Nike)", "Lifestyle + performance"],
              ]}
            />

            {/* Onlyness */}
            <div className="mt-12 p-6 rounded-lg text-center" style={{ border: `1px solid ${T.accent}`, backgroundColor: "rgba(73,228,114,0.03)" }}>
              <p className="text-xs uppercase tracking-[0.3em] mb-4" style={{ color: T.accent }}>Onlyness Statement</p>
              <p className="text-lg md:text-xl leading-relaxed max-w-3xl mx-auto" style={{ fontFamily: "'Kanit', sans-serif", fontWeight: 400 }}>
                Bulking e a unica marca de roupas fitness que combina design de moda com caimento para corpos treinados a preco justo, para homens que construiram seu shape e querem vesti-lo com intencao.
              </p>
            </div>
          </section>

          {/* =========================================================== */}
          {/* 4. IDENTIDADE VISUAL */}
          {/* =========================================================== */}
          <section className="py-20 md:py-28" style={{ borderTop: `1px solid ${T.border}` }}>
            <SectionTitle id="visual" number="04" title="Identidade Visual" subtitle="Wheeler Brand Identity Process + Design Tokens" />

            {/* Color Palette */}
            <h3 className="text-lg font-semibold mb-6" style={{ fontFamily: "'Kanit', sans-serif" }}>Paleta Primaria</h3>
            <div className="grid grid-cols-3 gap-4 mb-10">
              {COLORS.primary.map((c) => <ColorSwatch key={c.hex} {...c} />)}
            </div>

            <h3 className="text-lg font-semibold mb-6" style={{ fontFamily: "'Kanit', sans-serif" }}>Neutrals</h3>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-10">
              {COLORS.neutrals.map((c) => <ColorSwatch key={c.name} {...c} size="sm" />)}
            </div>

            <h3 className="text-lg font-semibold mb-6" style={{ fontFamily: "'Kanit', sans-serif" }}>Feedback</h3>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-12">
              {COLORS.feedback.map((c) => <ColorSwatch key={c.name} name={c.name} hex={c.hex} use={c.use} size="sm" />)}
            </div>

            {/* Color Proportions */}
            <h3 className="text-lg font-semibold mb-4" style={{ fontFamily: "'Kanit', sans-serif" }}>Proporcao de Uso</h3>
            <div className="flex rounded-lg overflow-hidden h-8 mb-12" style={{ border: `1px solid ${T.border}` }}>
              <div className="h-full flex items-center justify-center text-xs font-mono" style={{ width: "60%", backgroundColor: "#000", color: "#fff", borderRight: `1px solid ${T.border}` }}>60%</div>
              <div className="h-full flex items-center justify-center text-xs font-mono" style={{ width: "25%", backgroundColor: "#fff", color: "#000", borderRight: `1px solid ${T.border}` }}>25%</div>
              <div className="h-full flex items-center justify-center text-xs font-mono" style={{ width: "10%", backgroundColor: "#49E472", color: "#000", borderRight: `1px solid ${T.border}` }}>10%</div>
              <div className="h-full flex items-center justify-center text-xs font-mono" style={{ width: "5%", backgroundColor: "#707070", color: "#fff" }}>5%</div>
            </div>

            {/* Typography */}
            <h3 className="text-lg font-semibold mb-2" style={{ fontFamily: "'Kanit', sans-serif" }}>Tipografia</h3>
            <p className="text-sm mb-8" style={{ color: T.textSecondary }}>Kanit para headings e elementos de marca. Inter para body text.</p>

            <div className="mb-12">
              <TypographySpecimen label="Display" weight={800} size="4.5rem" font="'Kanit', sans-serif" sample="RESPECT THE HUSTLE" />
              <TypographySpecimen label="H1" weight={700} size="3rem" font="'Kanit', sans-serif" sample="Vista o trabalho." />
              <TypographySpecimen label="H2" weight={600} size="2.25rem" font="'Kanit', sans-serif" sample="Identidade Visual" />
              <TypographySpecimen label="H3" weight={600} size="1.5rem" font="'Kanit', sans-serif" sample="Paleta de Cores" />
              <TypographySpecimen label="Body" weight={400} size="1rem" font="'Inter', sans-serif" sample="A Bulking cria moda fitness com design autoral e caimento para corpos treinados, tornando o melhor custo-beneficio do mercado acessivel." />
              <TypographySpecimen label="Caption" weight={300} size="0.875rem" font="'Inter', sans-serif" sample="v1.0 — Marco 2026 — Goiania, GO" />
              <TypographySpecimen label="Button" weight={600} size="0.875rem" font="'Kanit', sans-serif" sample="COMPRE AGORA" />
            </div>

            {/* Logo */}
            <h3 className="text-lg font-semibold mb-4" style={{ fontFamily: "'Kanit', sans-serif" }}>Logo</h3>
            <div className="grid sm:grid-cols-2 gap-4 mb-8">
              <div className="rounded-lg p-8 flex items-center justify-center" style={{ backgroundColor: "#000", border: `1px solid ${T.border}` }}>
                <span className="text-4xl font-extrabold tracking-tight" style={{ fontFamily: "'Kanit', sans-serif", color: "#fff" }}>BULKING</span>
              </div>
              <div className="rounded-lg p-8 flex items-center justify-center" style={{ backgroundColor: "#fff" }}>
                <span className="text-4xl font-extrabold tracking-tight" style={{ fontFamily: "'Kanit', sans-serif", color: "#000" }}>BULKING</span>
              </div>
            </div>
            <Table
              headers={["Variacao", "Uso"]}
              rows={[
                ["Branco sobre preto", "Uso principal — fundos escuros"],
                ["Preto sobre branco", "Fundos claros"],
                ["Monocromatico", "Impressao P&B, documentos"],
                ["Com tagline", "BULKING + Respect the Hustle"],
                ["Icone/Favicon", "Letra B em verde sobre preto"],
              ]}
            />
          </section>

          {/* =========================================================== */}
          {/* 5. IDENTIDADE VERBAL */}
          {/* =========================================================== */}
          <section className="py-20 md:py-28" style={{ borderTop: `1px solid ${T.border}` }}>
            <SectionTitle id="verbal" number="05" title="Identidade Verbal" subtitle="Tom de Voz + Wheeler Verbal Identity" />

            {/* Tone Bars */}
            <h3 className="text-lg font-semibold mb-6" style={{ fontFamily: "'Kanit', sans-serif" }}>4 Dimensoes de Tom</h3>
            <div className="space-y-6 mb-12">
              {[
                { left: "Formal", right: "Casual", value: 4 },
                { left: "Serio", right: "Divertido", value: 3 },
                { left: "Respeitoso", right: "Irreverente", value: 4 },
                { left: "Factual", right: "Entusiasta", value: 6 },
              ].map((d) => (
                <div key={d.left}>
                  <div className="flex justify-between text-xs mb-2" style={{ color: T.textMuted }}>
                    <span>{d.left}</span><span>{d.right}</span>
                  </div>
                  <div className="relative h-2 rounded-full" style={{ backgroundColor: T.border }}>
                    <div className="absolute top-1/2 -translate-y-1/2 w-4 h-4 rounded-full" style={{ left: `${(d.value / 10) * 100}%`, transform: `translate(-50%, -50%)`, backgroundColor: T.accent }} />
                  </div>
                </div>
              ))}
            </div>

            {/* Vocabulary */}
            <h3 className="text-lg font-semibold mb-4" style={{ fontFamily: "'Kanit', sans-serif" }}>Vocabulario</h3>
            <div className="grid md:grid-cols-2 gap-4 mb-12">
              <Card>
                <p className="text-xs uppercase tracking-wider mb-4" style={{ color: T.accent, fontFamily: "'Kanit', sans-serif" }}>Usar</p>
                <div className="flex flex-wrap gap-2">
                  {["Hustle", "Shape", "Treino", "Construir", "Resultado", "Estilo", "Processo", "Merecer", "Vestir", "Intensidade"].map((w) => (
                    <Badge key={w} variant="green">{w}</Badge>
                  ))}
                </div>
              </Card>
              <Card>
                <p className="text-xs uppercase tracking-wider mb-4" style={{ color: "#E74C3C", fontFamily: "'Kanit', sans-serif" }}>Evitar</p>
                <div className="flex flex-wrap gap-2">
                  {["Baratinho", "Luxo", "Maromba", "Facil", "Desconto!!!", "Arrasa", "Campeao", "So hoje!"].map((w) => (
                    <Badge key={w} variant="red">{w}</Badge>
                  ))}
                </div>
              </Card>
            </div>

            {/* Key Messages */}
            <h3 className="text-lg font-semibold mb-4" style={{ fontFamily: "'Kanit', sans-serif" }}>Mensagens-Chave</h3>
            <div className="space-y-3 mb-12">
              {[
                { tag: "Tagline", msg: "Respect the Hustle." },
                { tag: "Suporte", msg: "Vista o trabalho." },
                { tag: "Promessa", msg: "Roupa de academia com design, caimento e qualidade — pelo preco que quem treina todo dia merece." },
                { tag: "Missao", msg: "Vestir quem faz o trabalho. Roupas fitness com design autoral e caimento para corpos treinados." },
                { tag: "Visao", msg: "Ser a marca de referencia quando um homem que treina pensa em roupa — no Brasil e alem." },
              ].map((m) => (
                <div key={m.tag} className="flex items-start gap-4 p-4 rounded-lg" style={{ backgroundColor: T.surfaceAlt }}>
                  <span className="shrink-0 text-xs uppercase tracking-wider w-20 pt-0.5" style={{ color: T.accent, fontFamily: "'Kanit', sans-serif" }}>{m.tag}</span>
                  <p className="text-sm" style={{ color: T.textSecondary }}>{m.msg}</p>
                </div>
              ))}
            </div>
          </section>

          {/* =========================================================== */}
          {/* 6. BRAND STORY */}
          {/* =========================================================== */}
          <section className="py-20 md:py-28" style={{ borderTop: `1px solid ${T.border}` }}>
            <SectionTitle id="story" number="06" title="Brand Story" subtitle="StoryBrand SB7 — Donald Miller" />

            {/* SB7 Steps */}
            <div className="space-y-4 mb-16">
              {[
                { n: "1", label: "Character", title: "O Heroi e o Cliente", desc: "Homem 20-40 anos que treina e quer que sua aparencia reflita o esforco." },
                { n: "2", label: "Problem", title: "O Problema", desc: "O mercado forca a escolher entre design caro e generico barato." },
                { n: "3", label: "Guide", title: "O Guia e a Bulking", desc: "Desde 2013 vestindo quem treina. +287K seguidores. Corte diferenciado." },
                { n: "4", label: "Plan", title: "O Plano", desc: "1. Escolha seu estilo → 2. Vista o shape → 3. Respeite o hustle." },
                { n: "5", label: "CTA", title: "Chamada para Acao", desc: "Direto: \"Compre agora\" / \"Vista o trabalho\". Transicional: \"Veja a colecao\"." },
                { n: "6", label: "Failure", title: "Se Nao Agir", desc: "Roupas genericas, dinheiro gasto em marcas caras, shape invisivel." },
                { n: "7", label: "Success", title: "A Transformacao", desc: "Roupa que reflete disciplina, elogios pelo estilo, guarda-roupa completo." },
              ].map((s) => (
                <div key={s.n} className="flex gap-4 p-5 rounded-lg" style={{ backgroundColor: T.surfaceAlt, border: `1px solid ${T.border}` }}>
                  <div className="shrink-0 w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold" style={{ backgroundColor: T.accent, color: "#000", fontFamily: "'Kanit', sans-serif" }}>{s.n}</div>
                  <div>
                    <p className="text-xs uppercase tracking-wider mb-1" style={{ color: T.textMuted }}>{s.label}</p>
                    <p className="font-semibold mb-1" style={{ fontFamily: "'Kanit', sans-serif" }}>{s.title}</p>
                    <p className="text-sm" style={{ color: T.textSecondary }}>{s.desc}</p>
                  </div>
                </div>
              ))}
            </div>

            {/* One-Liner */}
            <div className="p-8 rounded-lg text-center mb-12" style={{ backgroundColor: T.surfaceAlt, borderLeft: `3px solid ${T.accent}` }}>
              <p className="text-xs uppercase tracking-[0.3em] mb-4" style={{ color: T.accent }}>One-Liner</p>
              <p className="text-lg leading-relaxed max-w-3xl mx-auto" style={{ color: T.textSecondary }}>
                &ldquo;Muitos homens que treinam nao encontram roupas com design e caimento para seu shape a um preco justo. A Bulking cria moda fitness com corte diferenciado e o melhor custo-beneficio, pra que voce vista o resultado do seu trabalho com orgulho.&rdquo;
              </p>
            </div>

            {/* Narrative */}
            <h3 className="text-lg font-semibold mb-4" style={{ fontFamily: "'Kanit', sans-serif" }}>Narrativa da Marca</h3>
            <div className="space-y-4 text-base leading-relaxed" style={{ color: T.textSecondary }}>
              <p>A Bulking nasceu em 2013, em Goiania, de uma constatacao simples: o homem que treina de verdade nao encontra roupa a altura do esforco que faz. As opcoes eram roupas genericas de academia sem identidade ou marcas premium com precos que nao fazem sentido pra quem gasta com treino, dieta e suplementacao todo mes.</p>
              <p>Decidimos mudar isso. Criamos uma marca que respeita o hustle — o trabalho diario, a consistencia, a disciplina de quem esta na academia as 5h da manha enquanto o mundo dorme. Cada peca e desenhada com design autoral, corte pensado para corpos treinados e tecidos que acompanham a intensidade do treino. Tudo isso pelo preco que quem se dedica merece: justo.</p>
              <p>Hoje, mais de 287 mil pessoas confiam na Bulking pra vestir o trabalho. Porque quem faz o esforco merece vestir o resultado. <strong className="text-white">Respect the Hustle.</strong></p>
            </div>
          </section>

          {/* =========================================================== */}
          {/* 7. DESIGN SYSTEM */}
          {/* =========================================================== */}
          <section className="py-20 md:py-28" style={{ borderTop: `1px solid ${T.border}` }}>
            <SectionTitle id="design-system" number="07" title="Design System" subtitle="Brad Frost Atomic Design + Design Tokens + Dan Mall Governance" />

            {/* Tokens */}
            <h3 className="text-lg font-semibold mb-4" style={{ fontFamily: "'Kanit', sans-serif" }}>Tokens</h3>
            <p className="text-sm mb-6" style={{ color: T.textSecondary }}>Clique para copiar o valor.</p>
            <TokenBlock title="Color Tokens" tokens={[
              ["--color-black", "#000000"], ["--color-white", "#FFFFFF"], ["--color-green-500", "#49E472"],
              ["--color-green-600", "#3BC45E"], ["--color-gray-100", "#F5F5F5"], ["--color-gray-300", "#D9D9D9"],
              ["--color-gray-500", "#707070"], ["--color-gray-800", "#383838"],
            ]} />
            <TokenBlock title="Spacing" tokens={[
              ["--space-1", "4px"], ["--space-2", "8px"], ["--space-4", "16px"], ["--space-6", "24px"],
              ["--space-8", "32px"], ["--space-12", "48px"], ["--space-16", "64px"],
            ]} />
            <TokenBlock title="Border & Shadow" tokens={[
              ["--radius-sm", "4px"], ["--radius-md", "8px"], ["--radius-lg", "12px"],
              ["--shadow-sm", "0 1px 2px rgba(0,0,0,0.3)"], ["--shadow-md", "0 4px 8px rgba(0,0,0,0.3)"],
            ]} />

            {/* Component Specs */}
            <h3 className="text-lg font-semibold mt-12 mb-6" style={{ fontFamily: "'Kanit', sans-serif" }}>Componentes — Button</h3>
            <div className="flex flex-wrap gap-3 mb-8">
              <button className="px-6 py-2.5 rounded-lg text-sm font-semibold uppercase tracking-wider transition-transform hover:scale-[1.02]" style={{ backgroundColor: T.accent, color: "#000", fontFamily: "'Kanit', sans-serif" }}>Primary</button>
              <button className="px-6 py-2.5 rounded-lg text-sm font-semibold uppercase tracking-wider border transition-colors" style={{ backgroundColor: "transparent", color: "#fff", borderColor: "#fff", fontFamily: "'Kanit', sans-serif" }}>Secondary</button>
              <button className="px-6 py-2.5 rounded-lg text-sm font-semibold uppercase tracking-wider transition-colors" style={{ backgroundColor: "transparent", color: T.accent, fontFamily: "'Kanit', sans-serif" }}>Ghost</button>
              <button className="px-6 py-2.5 rounded-lg text-sm font-semibold uppercase tracking-wider opacity-40 cursor-not-allowed" style={{ backgroundColor: T.accent, color: "#000", fontFamily: "'Kanit', sans-serif" }}>Disabled</button>
            </div>

            {/* WCAG */}
            <h3 className="text-lg font-semibold mt-12 mb-4" style={{ fontFamily: "'Kanit', sans-serif" }}>Acessibilidade WCAG 2.1 AA</h3>
            <Table
              headers={["Combinacao", "Ratio", "Status"]}
              rows={[
                ["Branco sobre Preto", "21:1", "PASS AAA"],
                ["Verde sobre Preto", "8.5:1", "PASS AAA"],
                ["Cinza #707070 sobre Preto", "4.3:1", "PASS AA (grande)"],
                ["Cinza #383838 sobre Branco", "10.5:1", "PASS AAA"],
                ["Verde sobre Branco", "2.5:1", "FAIL"],
              ]}
            />
          </section>

          {/* =========================================================== */}
          {/* 8. CULTURA */}
          {/* =========================================================== */}
          <section className="py-20 md:py-28" style={{ borderTop: `1px solid ${T.border}` }}>
            <SectionTitle id="cultura" number="08" title="Cultura de Marca" subtitle="Denise Lee Yohn — FUSION + 9 Brand Types" />

            {/* Touchpoints */}
            <h3 className="text-lg font-semibold mb-6" style={{ fontFamily: "'Kanit', sans-serif" }}>Touchpoints</h3>
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4 mb-16">
              {[
                { tp: "Website", tom: "Determinado, confiante", vis: "Preto + verde, Kanit", exp: "Compra em 3 cliques" },
                { tp: "Instagram", tom: "Direto, inspirador", vis: "Grid escuro, alto contraste", exp: "Conteudo diario" },
                { tp: "Email", tom: "Pessoal, direto", vis: "Template dark, CTA verde", exp: "3 paragrafos max" },
                { tp: "Embalagem", tom: "Premium, intencional", vis: "Caixa preta, detalhes verdes", exp: "Unboxing com identidade" },
                { tp: "Entrega", tom: "Eficiente", vis: "Tracking real-time", exp: "Rapida, sem surpresas" },
                { tp: "Suporte", tom: "Parceiro, resolutivo", vis: "—", exp: "Resposta rapida, solucao" },
              ].map((t) => (
                <Card key={t.tp}>
                  <p className="font-semibold mb-3" style={{ fontFamily: "'Kanit', sans-serif" }}>{t.tp}</p>
                  <div className="space-y-2 text-xs" style={{ color: T.textSecondary }}>
                    <p><span style={{ color: T.textMuted }}>Tom:</span> {t.tom}</p>
                    <p><span style={{ color: T.textMuted }}>Visual:</span> {t.vis}</p>
                    <p><span style={{ color: T.textMuted }}>Experiencia:</span> {t.exp}</p>
                  </div>
                </Card>
              ))}
            </div>

            {/* Is This On-Brand? */}
            <h3 className="text-lg font-semibold mb-4" style={{ fontFamily: "'Kanit', sans-serif" }}>Framework &ldquo;Is This On-Brand?&rdquo;</h3>
            <p className="text-sm mb-6" style={{ color: T.textSecondary }}>Antes de qualquer decisao, passe por este filtro:</p>
            <div className="space-y-3">
              {[
                "Um Hero disciplinado com olhar de Creator faria isso?",
                "O cara que treina as 5h da manha se identificaria?",
                "\"Respect the Hustle\" caberia aqui?",
                "Isso e preto, verde e direto?",
                "Isso entrega custo-beneficio (valor real por preco justo)?",
              ].map((q, i) => (
                <div key={i} className="flex items-start gap-3 p-4 rounded-lg" style={{ backgroundColor: T.surfaceAlt, border: `1px solid ${T.border}` }}>
                  <span className="shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold" style={{ backgroundColor: T.accent, color: "#000", fontFamily: "'Kanit', sans-serif" }}>{i + 1}</span>
                  <p className="text-sm pt-1" style={{ color: T.textSecondary }}>{q}</p>
                </div>
              ))}
            </div>
          </section>

        </main>

        {/* ============================================================= */}
        {/* FOOTER */}
        {/* ============================================================= */}
        <footer className="py-20 text-center" style={{ borderTop: `1px solid ${T.border}` }}>
          <p className="text-3xl md:text-5xl font-bold mb-4" style={{ fontFamily: "'Kanit', sans-serif" }}>Respect the Hustle.</p>
          <p className="text-xs" style={{ color: T.textMuted }}>BULKING — Brandbook v1.0 — Marco 2026</p>
        </footer>

        {/* Scroll to top */}
        {showTop && (
          <button
            onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
            className="fixed bottom-6 right-6 z-50 w-10 h-10 rounded-full flex items-center justify-center transition-transform hover:scale-110 print:hidden"
            style={{ backgroundColor: T.accent, color: "#000" }}
          >
            <ChevronUp className="w-5 h-5" />
          </button>
        )}
      </div>

      {/* Print */}
      <style jsx global>{`
        @media print {
          nav, .fixed, button { display: none !important; }
          * { color: #000 !important; background: #fff !important; border-color: #ccc !important; }
        }
      `}</style>
    </>
  );
}

// ---------------------------------------------------------------------------
// Token Block Component
// ---------------------------------------------------------------------------
function TokenBlock({ title, tokens }: { title: string; tokens: string[][] }) {
  const { copied, copy } = useCopy();
  return (
    <div className="mb-8">
      <p className="text-xs uppercase tracking-wider mb-3" style={{ color: T.accent, fontFamily: "'Kanit', sans-serif" }}>{title}</p>
      <div className="rounded-lg overflow-hidden" style={{ backgroundColor: "#0D0D0D", border: `1px solid ${T.border}` }}>
        {tokens.map(([name, value]) => {
          const isCopied = copied === value;
          return (
            <button
              key={name}
              onClick={() => copy(value)}
              className="w-full flex items-center justify-between px-4 py-2.5 text-left transition-colors hover:bg-white/[0.03]"
              style={{ borderBottom: `1px solid ${T.borderSubtle}` }}
            >
              <span className="text-sm font-mono" style={{ color: T.textSecondary }}>{name}</span>
              <span className="flex items-center gap-2">
                {name.includes("color") && /^#[0-9A-Fa-f]{6}$/.test(value) && (
                  <span className="w-4 h-4 rounded-sm inline-block" style={{ backgroundColor: value, border: `1px solid ${T.border}` }} />
                )}
                <span className="text-sm font-mono" style={{ color: T.textPrimary }}>{value}</span>
                {isCopied ? <Check className="w-3 h-3" style={{ color: T.accent }} /> : <Copy className="w-3 h-3 opacity-30" />}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
