"use client";

import React, { useState, useEffect } from "react";
import Link from "next/link";
import { ArrowLeft, ChevronUp, Printer, Copy, Check } from "lucide-react";

/* ========================================================================
   BULKING — Manual da Marca v2.0
   Paleta: preto, branco e tons de cinza. Zero cores.
   Tipografia: Kanit (headings), Inter (body), JetBrains Mono (tokens)
   ======================================================================== */

// ---------------------------------------------------------------------------
// Tokens
// ---------------------------------------------------------------------------
const T = {
  bg: "#000000",
  surface: "#0A0A0A",
  surfaceAlt: "#111111",
  surfaceElevated: "#1A1A1A",
  border: "#262626",
  borderSubtle: "#1A1A1A",
  textPrimary: "#FFFFFF",
  textSecondary: "#A1A1A1",
  textMuted: "#666666",
  accent: "#FFFFFF",
  accentSubtle: "#CCCCCC",
  accentMuted: "#999999",
} as const;

const COLORS = {
  palette: [
    { name: "Pure Black", hex: "#000000", rgb: "0, 0, 0", use: "Fundo principal. Base da identidade." },
    { name: "Rich Black", hex: "#0A0A0A", rgb: "10, 10, 10", use: "Superficies elevadas, cards." },
    { name: "Charcoal", hex: "#111111", rgb: "17, 17, 17", use: "Superficies terciarias, alternancia." },
    { name: "Graphite", hex: "#1A1A1A", rgb: "26, 26, 26", use: "Bordas sutis, backgrounds elevados." },
    { name: "Dark Gray", hex: "#333333", rgb: "51, 51, 51", use: "Texto terciario, icones inativos." },
    { name: "Medium Gray", hex: "#666666", rgb: "102, 102, 102", use: "Labels, texto muted, captions." },
    { name: "Silver", hex: "#999999", rgb: "153, 153, 153", use: "Accents secundarios, numeracao." },
    { name: "Light Gray", hex: "#CCCCCC", rgb: "204, 204, 204", use: "Accents, hover states, subtitulos." },
    { name: "Off-White", hex: "#E5E5E5", rgb: "229, 229, 229", use: "Bordas em fundo escuro, destaques sutis." },
    { name: "Pure White", hex: "#FFFFFF", rgb: "255, 255, 255", use: "Texto principal, destaques, accent primario." },
  ],
};

const NAV_ITEMS = [
  { id: "quem-somos", label: "Quem Somos", number: "01" },
  { id: "o-que-fazemos", label: "O Que Fazemos", number: "02" },
  { id: "publico", label: "Publico", number: "03" },
  { id: "posicionamento", label: "Posicionamento", number: "04" },
  { id: "visual", label: "Visual", number: "05" },
  { id: "verbal", label: "Verbal", number: "06" },
  { id: "estetica", label: "Estetica", number: "07" },
  { id: "comunidade", label: "Comunidade", number: "08" },
  { id: "ambicao", label: "Ambicao", number: "09" },
  { id: "regras", label: "Regras", number: "10" },
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
    <div id={id} className="scroll-mt-24 mb-12 md:mb-16 relative">
      <span
        className="absolute -top-6 -left-2 text-[7rem] md:text-[10rem] font-extrabold leading-none select-none pointer-events-none"
        style={{ fontFamily: "'Kanit', sans-serif", color: T.surfaceAlt, opacity: 0.7 }}
      >
        {number}
      </span>
      <p className="text-xs uppercase tracking-[0.3em] mb-3 relative z-10" style={{ color: T.accentSubtle, fontFamily: "'Kanit', sans-serif" }}>
        {number}
      </p>
      <h2 className="text-3xl md:text-5xl font-bold mb-3 leading-tight relative z-10" style={{ fontFamily: "'Kanit', sans-serif" }}>
        {title}
      </h2>
      {subtitle && <p className="text-lg relative z-10" style={{ color: T.textSecondary }}>{subtitle}</p>}
      <div className="mt-6 h-px w-16 relative z-10" style={{ backgroundColor: T.textPrimary }} />
    </div>
  );
}

function Card({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`rounded-lg p-6 ${className}`} style={{ backgroundColor: T.surfaceAlt, border: `1px solid ${T.border}` }}>
      {children}
    </div>
  );
}

function Badge({ children, variant = "default" }: { children: React.ReactNode; variant?: "default" | "light" | "dark" | "outline" }) {
  const colors = {
    default: { bg: T.border, text: T.textSecondary, border: "none" },
    light: { bg: "rgba(255,255,255,0.1)", text: T.textPrimary, border: "none" },
    dark: { bg: T.surfaceElevated, text: T.accentMuted, border: "none" },
    outline: { bg: "transparent", text: T.accentSubtle, border: `1px solid ${T.border}` },
  };
  const c = colors[variant];
  return (
    <span className="inline-block text-xs font-medium px-2.5 py-1 rounded-full" style={{ backgroundColor: c.bg, color: c.text, border: c.border }}>
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
        <div className="h-2 rounded-full transition-all" style={{ width: `${pct}%`, background: `linear-gradient(90deg, ${T.textMuted}, ${T.textPrimary})` }} />
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
        style={{ backgroundColor: hex, border: hex === "#000000" || hex === "#FFFFFF" || hex === "#E5E5E5" ? `1px solid ${T.border}` : "none" }}
      />
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium">{name}</p>
        {isCopied ? <Check className="w-3 h-3" style={{ color: T.textPrimary }} /> : <Copy className="w-3 h-3 opacity-0 group-hover:opacity-50 transition-opacity" />}
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
        <span className="text-xs uppercase tracking-wider" style={{ color: T.accentSubtle, fontFamily: "'Kanit', sans-serif" }}>{label}</span>
        <span className="text-xs font-mono" style={{ color: T.textMuted }}>{weight} · {size}</span>
      </div>
      <p style={{ fontFamily: font, fontWeight: weight, fontSize: size, lineHeight: 1.2, color: T.textPrimary }}>{sample}</p>
    </div>
  );
}

function PullQuote({ children, attribution }: { children: React.ReactNode; attribution?: string }) {
  return (
    <blockquote className="py-12 md:py-16 my-12 md:my-16 relative" style={{ borderTop: `1px solid ${T.border}`, borderBottom: `1px solid ${T.border}` }}>
      <span className="absolute top-4 left-0 text-6xl leading-none select-none" style={{ fontFamily: "'Kanit', sans-serif", color: T.border }}>
        &ldquo;
      </span>
      <p className="text-2xl md:text-4xl font-light leading-snug max-w-4xl pl-2" style={{ fontFamily: "'Kanit', sans-serif" }}>
        {children}
      </p>
      {attribution && (
        <cite className="block mt-4 text-sm not-italic pl-2" style={{ color: T.textMuted }}>{attribution}</cite>
      )}
    </blockquote>
  );
}

function RuleCard({ number, title, description }: { number: string; title: string; description: string }) {
  return (
    <div className="p-6 rounded-lg" style={{ backgroundColor: T.surfaceAlt, borderLeft: `3px solid ${T.textPrimary}` }}>
      <span className="text-3xl font-extrabold" style={{ fontFamily: "'Kanit', sans-serif", color: T.accentMuted }}>{number}</span>
      <h4 className="text-lg font-semibold mt-2 mb-2" style={{ fontFamily: "'Kanit', sans-serif" }}>{title}</h4>
      <p className="text-sm" style={{ color: T.textSecondary }}>{description}</p>
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
          <p className="text-xs uppercase tracking-[0.4em] mb-8" style={{ color: T.textMuted }}>Manual da Marca</p>
          <h1
            className="text-8xl sm:text-9xl md:text-[12rem] font-extrabold leading-none tracking-tight mb-6"
            style={{ fontFamily: "'Kanit', sans-serif" }}
          >
            BULKING
          </h1>
          <p className="text-lg md:text-xl mb-2" style={{ color: T.textSecondary, fontFamily: "'Kanit', sans-serif", fontWeight: 300 }}>
            Respect the Hustle.
          </p>
          <p className="text-xs mt-6" style={{ color: T.textMuted }}>v2.0 — Marco 2026</p>
          <div className="mt-16">
            <div className="w-px h-16 mx-auto" style={{ background: `linear-gradient(to bottom, ${T.textMuted}, transparent)` }} />
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
                  color: activeSection === id ? T.textPrimary : T.textMuted,
                  backgroundColor: activeSection === id ? "rgba(255,255,255,0.08)" : "transparent",
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
          {/* 01. QUEM SOMOS */}
          {/* =========================================================== */}
          <section className="py-24 md:py-32">
            <SectionTitle id="quem-somos" number="01" title="Quem Somos" subtitle="Origem, essencia e o que nos define" />

            <PullQuote>
              A Bulking e uma marca brasileira de vestuario que traduz a cultura do treino em identidade de vida, criando pecas que funcionam dentro e fora da academia.
            </PullQuote>

            {/* Origin */}
            <div className="grid md:grid-cols-3 gap-4 mb-12">
              {[
                { n: "2013", t: "Fundacao", d: "Nascemos em Goiania com mentalidade de execucao e resiliencia, crescendo de um comeco com caixa apertado." },
                { n: "40%+", t: "Recorrencia", d: "Mais de 40% dos clientes compram novamente. Sinal de produto e marca bem encaixados." },
                { n: "R$10M+", t: "Faturamento", d: "Historico anual na casa de R$ 10 milhoes, buscando escalar como referencia numero 1." },
              ].map((item) => (
                <Card key={item.n}>
                  <p className="text-3xl font-extrabold mb-2" style={{ fontFamily: "'Kanit', sans-serif" }}>{item.n}</p>
                  <p className="text-sm font-semibold mb-1" style={{ fontFamily: "'Kanit', sans-serif" }}>{item.t}</p>
                  <p className="text-xs" style={{ color: T.textSecondary }}>{item.d}</p>
                </Card>
              ))}
            </div>

            {/* What We Do */}
            <h3 className="text-lg font-semibold mb-4" style={{ fontFamily: "'Kanit', sans-serif" }}>O Que Fazemos</h3>
            <div className="space-y-3 mb-12">
              {[
                "Criamos produtos de vestuario com DNA de performance e street, com acabamento, modelagem e estetica pensados para o lifestyle de quem treina.",
                "Construimos comunidade e pertencimento com Bulking Club e Team Bulking, ativando clientes para engajamento, recompra e participacao em campanhas.",
                "Operamos como marca e sistema: conteudo, lancamentos, campanhas, CRM e performance trabalhando juntos para crescer com consistencia.",
              ].map((text, i) => (
                <div key={i} className="flex items-start gap-4 p-4 rounded-lg" style={{ backgroundColor: T.surfaceAlt }}>
                  <span className="shrink-0 text-xs font-mono pt-0.5" style={{ color: T.accentMuted }}>{String(i + 1).padStart(2, "0")}</span>
                  <p className="text-sm" style={{ color: T.textSecondary }}>{text}</p>
                </div>
              ))}
            </div>

            {/* Archetype Summary */}
            <h3 className="text-lg font-semibold mb-4" style={{ fontFamily: "'Kanit', sans-serif" }}>Arquetipo</h3>
            <div className="grid md:grid-cols-2 gap-4 mb-12">
              <Card>
                <Badge variant="light">Primario — 75%</Badge>
                <h4 className="text-2xl font-bold mt-3 mb-2" style={{ fontFamily: "'Kanit', sans-serif" }}>Hero</h4>
                <p className="text-sm" style={{ color: T.textSecondary }}>O Hero disciplinado que constroi — nao apenas reage com coragem, mas projeta com intencao. Prova valor atraves de acao disciplinada.</p>
              </Card>
              <Card>
                <Badge variant="dark">Secundario — 25%</Badge>
                <h4 className="text-2xl font-bold mt-3 mb-2" style={{ fontFamily: "'Kanit', sans-serif" }}>Creator</h4>
                <p className="text-sm" style={{ color: T.textSecondary }}>Fashion fitness como expressao de identidade. O Creator da forma ao que o Hero constroi — design autoral aplicado a roupa de treino.</p>
              </Card>
            </div>

            {/* What We Are NOT */}
            <h3 className="text-lg font-semibold mb-4" style={{ fontFamily: "'Kanit', sans-serif" }}>O Que a Bulking Nao E</h3>
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {[
                "Nao e fast fashion.",
                "Nao e marca generica de modinha fitness.",
                "Nao depende de desconto como identidade.",
                "Nao se posiciona como guru do cliente.",
                "Nao e sobre ostentacao vazia ou performance de ego.",
                "Nao e uniforme de academia.",
              ].map((text) => (
                <div key={text} className="flex items-start gap-3 p-4 rounded-lg" style={{ backgroundColor: T.surface, border: `1px solid ${T.borderSubtle}` }}>
                  <span className="shrink-0 text-sm" style={{ color: T.accentMuted }}>—</span>
                  <p className="text-sm" style={{ color: T.textSecondary }}>{text}</p>
                </div>
              ))}
            </div>
          </section>

          {/* =========================================================== */}
          {/* 02. O QUE FAZEMOS */}
          {/* =========================================================== */}
          <section className="py-24 md:py-32" style={{ borderTop: `1px solid ${T.border}` }}>
            <SectionTitle id="o-que-fazemos" number="02" title="O Que Fazemos" subtitle="Produtos, linhas e ecossistema" />

            <div className="mb-12">
              <p className="text-base leading-relaxed mb-6" style={{ color: T.textSecondary }}>
                Itens carro-chefe de alta demanda: camisetas oversized e regatas, com variedade de cores e temas. A marca transita entre o visual de performance e o casual, sem depender de estetica puramente fitness.
              </p>
              <PullQuote>
                A Bulking funciona melhor quando parece marca de moda com raizes no treino, nao quando parece uniforme de academia.
              </PullQuote>
            </div>

            {/* Sub-lines */}
            <h3 className="text-lg font-semibold mb-6" style={{ fontFamily: "'Kanit', sans-serif" }}>Ecossistema de Linhas</h3>
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {[
                { name: "Bulking Club", desc: "Programa de fidelidade e comunidade. Alavanca de retencao, recompra e mobilizacao em campanhas." },
                { name: "Team Bulking", desc: "Linha que reforca pertencimento ao coletivo. Quem veste e de dentro." },
                { name: "Bulking Army", desc: "Identidade de grupo com codigos militares. Disciplina como estetica." },
                { name: "Bulking Studio", desc: "Linha com acabamento premium e design mais refinado." },
                { name: "Athlete Division", desc: "Performance-first. Para quem treina com intensidade maxima." },
                { name: "Luxury Heritage", desc: "Pecas com valor agregado elevado. Qualidade como statement." },
                { name: "Heavy", desc: "Estetica pesada, robusta. Para quem quer presenca e impacto visual." },
              ].map((line) => (
                <Card key={line.name}>
                  <p className="text-sm font-semibold mb-2" style={{ fontFamily: "'Kanit', sans-serif" }}>{line.name}</p>
                  <p className="text-xs" style={{ color: T.textSecondary }}>{line.desc}</p>
                </Card>
              ))}
            </div>
          </section>

          {/* =========================================================== */}
          {/* 03. PUBLICO */}
          {/* =========================================================== */}
          <section className="py-24 md:py-32" style={{ borderTop: `1px solid ${T.border}` }}>
            <SectionTitle id="publico" number="03" title="Publico" subtitle="Quem veste Bulking e por que" />

            {/* Who */}
            <h3 className="text-lg font-semibold mb-4" style={{ fontFamily: "'Kanit', sans-serif" }}>Quem E</h3>
            <div className="space-y-3 mb-12">
              {[
                "Homens e mulheres que treinam ou vivem a cultura do treino como estilo de vida.",
                "Pessoas movidas por disciplina, constancia, ambicao e evolucao pessoal.",
                "Consumidores que querem vestir identidade, nao so roupa.",
              ].map((text, i) => (
                <div key={i} className="flex items-start gap-4 p-4 rounded-lg" style={{ backgroundColor: T.surfaceAlt }}>
                  <span className="shrink-0 text-xs font-mono pt-0.5" style={{ color: T.accentMuted }}>{String(i + 1).padStart(2, "0")}</span>
                  <p className="text-sm" style={{ color: T.textSecondary }}>{text}</p>
                </div>
              ))}
            </div>

            {/* What They Value */}
            <h3 className="text-lg font-semibold mb-4" style={{ fontFamily: "'Kanit', sans-serif" }}>O Que Valorizam</h3>
            <div className="grid sm:grid-cols-2 gap-4 mb-12">
              {[
                { t: "Pertencimento e cultura", d: "Codigos de grupo: simbolos, frases, rituais, drops e colecoes com narrativa." },
                { t: "Qualidade percebida", d: "Modelagem que veste bem, acabamento que se sente. Nao aceita generico." },
                { t: "Estetica com presenca", d: "Quer se destacar sem caricatura. Visual forte, nao fantasiado." },
                { t: "Respeito por quem rala", d: "Mensagens que validam a jornada. Sem atalhos, sem promessas vazias." },
              ].map((item) => (
                <Card key={item.t}>
                  <p className="text-sm font-semibold mb-1" style={{ fontFamily: "'Kanit', sans-serif" }}>{item.t}</p>
                  <p className="text-xs" style={{ color: T.textSecondary }}>{item.d}</p>
                </Card>
              ))}
            </div>

            {/* Self-Image */}
            <h3 className="text-lg font-semibold mb-4" style={{ fontFamily: "'Kanit', sans-serif" }}>Como Se Enxergam</h3>
            <PullQuote>
              Eu nao pego atalho. O treino e minha metafora pra vida. Gosto de codigos de grupo — quem e de dentro entende, quem e de fora quer entrar.
            </PullQuote>

            {/* Kapferer */}
            <div className="grid md:grid-cols-2 gap-4">
              <Card>
                <p className="text-xs uppercase tracking-wider mb-2" style={{ color: T.accentSubtle, fontFamily: "'Kanit', sans-serif" }}>Reflexo (Kapferer)</p>
                <p className="text-sm" style={{ color: T.textSecondary }}>Alguem que treina como estilo de vida e veste identidade, nao so roupa. Forte, estiloso e dedicado.</p>
              </Card>
              <Card>
                <p className="text-xs uppercase tracking-wider mb-2" style={{ color: T.accentSubtle, fontFamily: "'Kanit', sans-serif" }}>Autoimagem (Kapferer)</p>
                <p className="text-sm" style={{ color: T.textSecondary }}>Meu shape e meu estilo sao resultado do meu trabalho. Eu mereco vestir algo a altura do que construi.</p>
              </Card>
            </div>
          </section>

          {/* =========================================================== */}
          {/* 04. POSICIONAMENTO */}
          {/* =========================================================== */}
          <section className="py-24 md:py-32" style={{ borderTop: `1px solid ${T.border}` }}>
            <SectionTitle id="posicionamento" number="04" title="Posicionamento" subtitle="Essencia, promessa e diferenciacao" />

            {/* Brand Essence */}
            <div className="text-center py-16 mb-12 rounded-lg" style={{ backgroundColor: T.surfaceAlt, border: `1px solid ${T.border}` }}>
              <p className="text-xs uppercase tracking-[0.3em] mb-4" style={{ color: T.textMuted }}>Brand Essence</p>
              <p className="text-3xl md:text-5xl font-bold" style={{ fontFamily: "'Kanit', sans-serif" }}>&ldquo;Cultura do treino como identidade de vida.&rdquo;</p>
            </div>

            {/* The Word */}
            <div className="text-center py-12 mb-12 rounded-lg" style={{ backgroundColor: T.surface, border: `1px solid ${T.border}` }}>
              <p className="text-xs uppercase tracking-[0.3em] mb-4" style={{ color: T.textMuted }}>A Palavra da Bulking</p>
              <p className="text-5xl md:text-7xl font-extrabold" style={{ fontFamily: "'Kanit', sans-serif", color: T.textPrimary }}>HUSTLE</p>
              <p className="text-sm mt-4 max-w-md mx-auto" style={{ color: T.textSecondary }}>Trabalho duro, determinacao, processo diario, respeito pelo caminho dificil. Quando alguem pensa em hustle + roupa de treino, deve pensar Bulking.</p>
            </div>

            {/* Promise */}
            <h3 className="text-lg font-semibold mb-4" style={{ fontFamily: "'Kanit', sans-serif" }}>Promessa</h3>
            <div className="space-y-3 mb-12">
              {[
                "Voce veste respeito pela rotina que ninguem ve.",
                "Voce veste a disciplina que te transforma.",
              ].map((text, i) => (
                <div key={i} className="p-5 rounded-lg" style={{ backgroundColor: T.surfaceAlt, borderLeft: `3px solid ${T.textPrimary}` }}>
                  <p className="text-lg" style={{ fontFamily: "'Kanit', sans-serif", fontWeight: 400 }}>{text}</p>
                </div>
              ))}
            </div>

            {/* Visual Hammer + Verbal Nail */}
            <h3 className="text-lg font-semibold mb-4" style={{ fontFamily: "'Kanit', sans-serif" }}>Visual Hammer & Verbal Nail (Al Ries)</h3>
            <div className="grid md:grid-cols-2 gap-4 mb-12">
              <Card>
                <p className="text-xs uppercase tracking-wider mb-3" style={{ color: T.accentSubtle, fontFamily: "'Kanit', sans-serif" }}>Visual Hammer</p>
                <p className="text-4xl font-extrabold mb-3" style={{ fontFamily: "'Kanit', sans-serif" }}>BULKING</p>
                <p className="text-sm" style={{ color: T.textSecondary }}>O wordmark em Kanit ExtraBold, preto e branco. Presenca tipografica que se impoe sem precisar de cor ou simbolo.</p>
              </Card>
              <Card>
                <p className="text-xs uppercase tracking-wider mb-3" style={{ color: T.accentSubtle, fontFamily: "'Kanit', sans-serif" }}>Verbal Nail</p>
                <p className="text-2xl font-medium mb-3" style={{ fontFamily: "'Kanit', sans-serif" }}>Respect the Hustle.</p>
                <p className="text-sm" style={{ color: T.textSecondary }}>A frase que ancora tudo. Respeito pelo processo, pela constancia, pelo trabalho duro. O nucleo da marca em tres palavras.</p>
              </Card>
            </div>

            {/* Positioning Statements */}
            <h3 className="text-lg font-semibold mb-4" style={{ fontFamily: "'Kanit', sans-serif" }}>Positioning Statements</h3>
            <div className="space-y-4 mb-12">
              {[
                { type: "Target-Led", text: "Para homens e mulheres que treinam de verdade e querem vestir a altura do que construiram, Bulking e a marca de vestuario que combina design autoral com identidade de treino, porque quem faz o trabalho merece vestir o resultado." },
                { type: "Benefit-Led", text: "Bulking e a unica marca de roupa fitness que entrega estetica de moda com raizes no treino — qualidade percebida, modelagem pensada e pertencimento real para quem vive a cultura do hustle." },
                { type: "Category-Led", text: "Na categoria de vestuario fitness, Bulking e a marca que traduz cultura de treino em identidade de vida — com design autoral, comunidade ativa e pertencimento que o concorrente nao copia." },
              ].map((s) => (
                <div key={s.type} className="p-5 rounded-lg" style={{ backgroundColor: T.surfaceAlt, borderLeft: `3px solid ${T.accentSubtle}` }}>
                  <p className="text-xs uppercase tracking-wider mb-2" style={{ color: T.accentSubtle, fontFamily: "'Kanit', sans-serif" }}>{s.type}</p>
                  <p className="text-sm leading-relaxed" style={{ color: T.textSecondary }}>{s.text}</p>
                </div>
              ))}
            </div>

            {/* Onlyness */}
            <div className="p-8 rounded-lg text-center" style={{ border: `1px solid ${T.border}`, backgroundColor: T.surfaceAlt }}>
              <p className="text-xs uppercase tracking-[0.3em] mb-4" style={{ color: T.accentSubtle }}>Onlyness Statement</p>
              <p className="text-lg md:text-xl leading-relaxed max-w-3xl mx-auto" style={{ fontFamily: "'Kanit', sans-serif", fontWeight: 400 }}>
                Bulking e a unica marca de vestuario fitness que combina estetica de moda com cultura de treino e comunidade ativa, para quem vive o hustle como identidade — nao como fantasia.
              </p>
            </div>
          </section>

          {/* =========================================================== */}
          {/* 05. IDENTIDADE VISUAL */}
          {/* =========================================================== */}
          <section className="py-24 md:py-32" style={{ borderTop: `1px solid ${T.border}` }}>
            <SectionTitle id="visual" number="05" title="Identidade Visual" subtitle="Paleta, tipografia, logo e design tokens" />

            {/* Color Palette */}
            <h3 className="text-lg font-semibold mb-6" style={{ fontFamily: "'Kanit', sans-serif" }}>Paleta Completa</h3>
            <p className="text-sm mb-8" style={{ color: T.textSecondary }}>
              A Bulking opera em preto, branco e tons de cinza. Sem cores. A forca vem do contraste, da tipografia e da composicao — nao de saturacao.
            </p>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-4 mb-12">
              {COLORS.palette.map((c) => <ColorSwatch key={c.hex + c.name} {...c} size="sm" />)}
            </div>

            {/* Color Proportions */}
            <h3 className="text-lg font-semibold mb-4" style={{ fontFamily: "'Kanit', sans-serif" }}>Proporcao de Uso</h3>
            <div className="flex rounded-lg overflow-hidden h-8 mb-12" style={{ border: `1px solid ${T.border}` }}>
              <div className="h-full flex items-center justify-center text-xs font-mono" style={{ width: "65%", backgroundColor: "#000", color: "#fff", borderRight: `1px solid ${T.border}` }}>Preto 65%</div>
              <div className="h-full flex items-center justify-center text-xs font-mono" style={{ width: "25%", backgroundColor: "#fff", color: "#000", borderRight: `1px solid ${T.border}` }}>Branco 25%</div>
              <div className="h-full flex items-center justify-center text-xs font-mono" style={{ width: "10%", backgroundColor: "#666", color: "#fff" }}>Cinzas 10%</div>
            </div>

            {/* Typography */}
            <h3 className="text-lg font-semibold mb-2" style={{ fontFamily: "'Kanit', sans-serif" }}>Tipografia</h3>
            <p className="text-sm mb-8" style={{ color: T.textSecondary }}>Kanit para headings e elementos de marca. Inter para body text. JetBrains Mono para tokens e codigo.</p>

            <div className="mb-12">
              <TypographySpecimen label="Display" weight={800} size="4.5rem" font="'Kanit', sans-serif" sample="RESPECT THE HUSTLE" />
              <TypographySpecimen label="H1" weight={700} size="3rem" font="'Kanit', sans-serif" sample="Cultura do treino como identidade." />
              <TypographySpecimen label="H2" weight={600} size="2.25rem" font="'Kanit', sans-serif" sample="Identidade Visual" />
              <TypographySpecimen label="H3" weight={600} size="1.5rem" font="'Kanit', sans-serif" sample="Paleta de Cores" />
              <TypographySpecimen label="Body" weight={400} size="1rem" font="'Inter', sans-serif" sample="A Bulking traduz a cultura do treino em identidade de vida, criando pecas que funcionam dentro e fora da academia com uma comunidade forte." />
              <TypographySpecimen label="Caption" weight={300} size="0.875rem" font="'Inter', sans-serif" sample="v2.0 — Marco 2026 — Goiania, GO" />
              <TypographySpecimen label="Button" weight={600} size="0.875rem" font="'Kanit', sans-serif" sample="VISTA O TRABALHO" />
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
                ["Branco sobre preto", "Uso principal — fundos escuros, digital, social"],
                ["Preto sobre branco", "Fundos claros, impressos, documentos"],
                ["Monocromatico cinza", "Contextos neutros, colaterais, bordados"],
                ["Com tagline", "BULKING + Respect the Hustle — campanhas e hero sections"],
              ]}
            />

            {/* Design Tokens */}
            <h3 className="text-lg font-semibold mt-12 mb-4" style={{ fontFamily: "'Kanit', sans-serif" }}>Design Tokens</h3>
            <p className="text-sm mb-6" style={{ color: T.textSecondary }}>Clique para copiar o valor.</p>
            <TokenBlock title="Color Tokens" tokens={[
              ["--color-black", "#000000"], ["--color-white", "#FFFFFF"],
              ["--color-gray-50", "#E5E5E5"], ["--color-gray-100", "#CCCCCC"],
              ["--color-gray-300", "#999999"], ["--color-gray-500", "#666666"],
              ["--color-gray-700", "#333333"], ["--color-gray-800", "#1A1A1A"],
              ["--color-gray-900", "#111111"], ["--color-gray-950", "#0A0A0A"],
            ]} />
            <TokenBlock title="Spacing" tokens={[
              ["--space-1", "4px"], ["--space-2", "8px"], ["--space-4", "16px"], ["--space-6", "24px"],
              ["--space-8", "32px"], ["--space-12", "48px"], ["--space-16", "64px"],
            ]} />
            <TokenBlock title="Border & Shadow" tokens={[
              ["--radius-sm", "4px"], ["--radius-md", "8px"], ["--radius-lg", "12px"],
              ["--shadow-sm", "0 1px 2px rgba(0,0,0,0.3)"], ["--shadow-md", "0 4px 8px rgba(0,0,0,0.3)"],
            ]} />

            {/* Button Components */}
            <h3 className="text-lg font-semibold mt-12 mb-6" style={{ fontFamily: "'Kanit', sans-serif" }}>Componentes — Button</h3>
            <div className="flex flex-wrap gap-3 mb-8">
              <button className="px-6 py-2.5 rounded-lg text-sm font-semibold uppercase tracking-wider transition-transform hover:scale-[1.02]" style={{ backgroundColor: T.textPrimary, color: T.bg, fontFamily: "'Kanit', sans-serif" }}>Primary</button>
              <button className="px-6 py-2.5 rounded-lg text-sm font-semibold uppercase tracking-wider border transition-colors" style={{ backgroundColor: "transparent", color: "#fff", borderColor: "#fff", fontFamily: "'Kanit', sans-serif" }}>Secondary</button>
              <button className="px-6 py-2.5 rounded-lg text-sm font-semibold uppercase tracking-wider transition-colors" style={{ backgroundColor: "transparent", color: T.accentSubtle, fontFamily: "'Kanit', sans-serif" }}>Ghost</button>
              <button className="px-6 py-2.5 rounded-lg text-sm font-semibold uppercase tracking-wider opacity-40 cursor-not-allowed" style={{ backgroundColor: T.textMuted, color: T.bg, fontFamily: "'Kanit', sans-serif" }}>Disabled</button>
            </div>

            {/* WCAG */}
            <h3 className="text-lg font-semibold mt-12 mb-4" style={{ fontFamily: "'Kanit', sans-serif" }}>Acessibilidade WCAG 2.1 AA</h3>
            <Table
              headers={["Combinacao", "Ratio", "Status"]}
              rows={[
                ["Branco #FFF sobre Preto #000", "21:1", "PASS AAA"],
                ["Off-White #E5E5E5 sobre Preto #000", "17.4:1", "PASS AAA"],
                ["Light Gray #CCC sobre Preto #000", "13.3:1", "PASS AAA"],
                ["Silver #999 sobre Preto #000", "6.3:1", "PASS AA"],
                ["Medium Gray #666 sobre Preto #000", "3.9:1", "PASS AA (large)"],
                ["Dark Gray #333 sobre Branco #FFF", "12.6:1", "PASS AAA"],
                ["Medium Gray #666 sobre Branco #FFF", "5.7:1", "PASS AA"],
              ]}
            />
          </section>

          {/* =========================================================== */}
          {/* 06. IDENTIDADE VERBAL */}
          {/* =========================================================== */}
          <section className="py-24 md:py-32" style={{ borderTop: `1px solid ${T.border}` }}>
            <SectionTitle id="verbal" number="06" title="Identidade Verbal" subtitle="Tom de voz, vocabulario e regras de comunicacao" />

            {/* Voice Character */}
            <div className="mb-12">
              <PullQuote>Cultura acima de propaganda. Verdade acima de hype.</PullQuote>
            </div>

            {/* How We Speak */}
            <h3 className="text-lg font-semibold mb-4" style={{ fontFamily: "'Kanit', sans-serif" }}>Como Falamos</h3>
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3 mb-12">
              {[
                "Direto, confiante, sem enrolacao.",
                "Respeitoso com a jornada do cliente.",
                "Forte e com presenca, sem exagero.",
                "Mais cultura do que propaganda.",
                "Mais verdade do que hype.",
              ].map((text) => (
                <div key={text} className="p-4 rounded-lg" style={{ backgroundColor: T.surfaceAlt, border: `1px solid ${T.border}` }}>
                  <p className="text-sm" style={{ color: T.textSecondary }}>{text}</p>
                </div>
              ))}
            </div>

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
                    <div className="absolute top-1/2 -translate-y-1/2 w-4 h-4 rounded-full" style={{ left: `${(d.value / 10) * 100}%`, transform: `translate(-50%, -50%)`, backgroundColor: T.textPrimary }} />
                  </div>
                </div>
              ))}
            </div>

            {/* Vocabulary */}
            <h3 className="text-lg font-semibold mb-4" style={{ fontFamily: "'Kanit', sans-serif" }}>Vocabulario</h3>
            <div className="grid md:grid-cols-2 gap-4 mb-12">
              <Card>
                <p className="text-xs uppercase tracking-wider mb-4" style={{ color: T.accentSubtle, fontFamily: "'Kanit', sans-serif" }}>Usar</p>
                <div className="flex flex-wrap gap-2">
                  {["Hustle", "Disciplina", "Constancia", "Construcao", "Respeito", "Legado", "Rotina", "Presenca", "Missao", "Progresso", "Firmeza", "Aco"].map((w) => (
                    <Badge key={w} variant="light">{w}</Badge>
                  ))}
                </div>
              </Card>
              <Card>
                <p className="text-xs uppercase tracking-wider mb-4" style={{ color: T.accentMuted, fontFamily: "'Kanit', sans-serif" }}>Evitar</p>
                <div className="flex flex-wrap gap-2">
                  {["Vai la campeao", "Transforme sua vida", "Desconto!!!", "Arrasa", "Facil", "Luxo", "Maromba", "So hoje!", "Bora"].map((w) => (
                    <Badge key={w} variant="dark">{w}</Badge>
                  ))}
                </div>
              </Card>
            </div>

            {/* What We Avoid in Text */}
            <h3 className="text-lg font-semibold mb-4" style={{ fontFamily: "'Kanit', sans-serif" }}>O Que Evitamos no Texto</h3>
            <div className="grid sm:grid-cols-2 gap-3 mb-12">
              {[
                "Linguagem de coach.",
                "Promessas milagrosas e \"transforme sua vida em 7 dias\".",
                "Frases vazias de motivacao generica.",
                "Tom infantilizado, forcado ou caricato.",
                "Emojis.",
                "Linguajar com girias.",
                "Excesso de cores e pontuacao.",
              ].map((text) => (
                <div key={text} className="flex items-start gap-3 p-3 rounded-lg" style={{ backgroundColor: T.surface }}>
                  <span className="shrink-0 text-sm" style={{ color: T.accentMuted }}>—</span>
                  <p className="text-sm" style={{ color: T.textSecondary }}>{text}</p>
                </div>
              ))}
            </div>

            {/* Key Messages */}
            <h3 className="text-lg font-semibold mb-4" style={{ fontFamily: "'Kanit', sans-serif" }}>Mensagens-Chave</h3>
            <div className="space-y-3">
              {[
                { tag: "Slogan", msg: "Respect the Hustle." },
                { tag: "Essencia", msg: "Cultura do treino como identidade de vida." },
                { tag: "Promessa", msg: "Voce veste respeito pela rotina que ninguem ve." },
                { tag: "Missao", msg: "Traduzir a cultura do treino em vestuario com identidade, comunidade e pertencimento." },
                { tag: "Visao", msg: "Evoluir de marca de roupa para plataforma cultural do lifestyle do treino." },
              ].map((m) => (
                <div key={m.tag} className="flex items-start gap-4 p-4 rounded-lg" style={{ backgroundColor: T.surfaceAlt }}>
                  <span className="shrink-0 text-xs uppercase tracking-wider w-20 pt-0.5" style={{ color: T.accentSubtle, fontFamily: "'Kanit', sans-serif" }}>{m.tag}</span>
                  <p className="text-sm" style={{ color: T.textSecondary }}>{m.msg}</p>
                </div>
              ))}
            </div>
          </section>

          {/* =========================================================== */}
          {/* 07. ESTETICA & DIRECAO CRIATIVA */}
          {/* =========================================================== */}
          <section className="py-24 md:py-32" style={{ borderTop: `1px solid ${T.border}` }}>
            <SectionTitle id="estetica" number="07" title="Estetica & Direcao Criativa" subtitle="Editorial, fotografia e composicao visual" />

            <PullQuote>
              Minimalismo, sofisticacao e presenca. Simbolos, tipografia, textura e composicao para transmitir atitude.
            </PullQuote>

            {/* Direction */}
            <h3 className="text-lg font-semibold mb-4" style={{ fontFamily: "'Kanit', sans-serif" }}>Direcao Editorial</h3>
            <div className="space-y-3 mb-12">
              {[
                "A Bulking funciona melhor quando parece marca de moda com raizes no treino, nao quando parece uniforme de academia.",
                "Editorial e campanha ganham forca com minimalismo, sofisticacao e presenca.",
                "Narrativa visual e textual deve reforcar pertencimento e identidade, evitando autopromocao explicita.",
                "Cada drop deve parecer evento cultural: quem e de dentro entende, quem e de fora quer entrar.",
              ].map((text, i) => (
                <div key={i} className="flex items-start gap-4 p-4 rounded-lg" style={{ backgroundColor: T.surfaceAlt }}>
                  <span className="shrink-0 text-xs font-mono pt-0.5" style={{ color: T.accentMuted }}>{String(i + 1).padStart(2, "0")}</span>
                  <p className="text-sm" style={{ color: T.textSecondary }}>{text}</p>
                </div>
              ))}
            </div>

            {/* What Works vs Doesn't */}
            <h3 className="text-lg font-semibold mb-4" style={{ fontFamily: "'Kanit', sans-serif" }}>O Que Funciona vs. O Que Nao Funciona</h3>
            <div className="grid md:grid-cols-2 gap-4 mb-12">
              <Card>
                <p className="text-xs uppercase tracking-wider mb-4" style={{ color: T.accentSubtle, fontFamily: "'Kanit', sans-serif" }}>Funciona</p>
                <ul className="space-y-2 text-sm" style={{ color: T.textSecondary }}>
                  {[
                    "Alto contraste preto e branco",
                    "Cenarios arquitetonicos e urbanos",
                    "Fundos minimalistas, sem poluicao",
                    "Atleta como modelo — presenca, nao pose",
                    "Tipografia grande como elemento visual",
                    "Textura e composicao acima de cor",
                    "Narrativa cultural, nao promocional",
                  ].map((t) => (
                    <li key={t} className="flex items-start gap-2"><span style={{ color: T.accentSubtle }}>+</span>{t}</li>
                  ))}
                </ul>
              </Card>
              <Card>
                <p className="text-xs uppercase tracking-wider mb-4" style={{ color: T.accentMuted, fontFamily: "'Kanit', sans-serif" }}>Nao Funciona</p>
                <ul className="space-y-2 text-sm" style={{ color: T.textSecondary }}>
                  {[
                    "Selfie de espelho em academia",
                    "Fundos neon ou saturados",
                    "Estetica de marca de suplemento",
                    "Fotos stock genericas",
                    "Excesso de filtros e efeitos",
                    "Layouts sobrecarregados de informacao",
                    "Autopromocao explicita (\"somos os melhores\")",
                  ].map((t) => (
                    <li key={t} className="flex items-start gap-2"><span style={{ color: T.accentMuted }}>—</span>{t}</li>
                  ))}
                </ul>
              </Card>
            </div>

            {/* Photography Direction */}
            <h3 className="text-lg font-semibold mb-4" style={{ fontFamily: "'Kanit', sans-serif" }}>Direcao de Fotografia</h3>
            <Table
              headers={["Elemento", "Direcao"]}
              rows={[
                ["Iluminacao", "Contraste alto, sombras duras ou luz natural direcional"],
                ["Cenario", "Urbano, arquitetonico, industrial. Nunca academia generica."],
                ["Modelo", "Presenca, atitude, olhar direto. Nao e pose de catalogo."],
                ["Cor", "Preto e branco preferencialmente. Se colorido, tons neutros e frios."],
                ["Composicao", "Espaco negativo generoso. Tipografia integrada a imagem."],
                ["Tratamento", "Contraste alto, granulado sutil, sem filtros fashion."],
              ]}
            />
          </section>

          {/* =========================================================== */}
          {/* 08. COMUNIDADE & EXPERIENCIA */}
          {/* =========================================================== */}
          <section className="py-24 md:py-32" style={{ borderTop: `1px solid ${T.border}` }}>
            <SectionTitle id="comunidade" number="08" title="Comunidade & Experiencia" subtitle="A base como ativo estrategico" />

            <PullQuote>
              A comunidade e o diferencial que o concorrente nao copia.
            </PullQuote>

            {/* Community Layers */}
            <h3 className="text-lg font-semibold mb-6" style={{ fontFamily: "'Kanit', sans-serif" }}>Camadas de Comunidade</h3>
            <div className="grid sm:grid-cols-3 gap-4 mb-12">
              {[
                { name: "Bulking Club", desc: "Alavanca de retencao, recompra e mobilizacao. Membros com acesso antecipado a drops e Black Friday em fases." },
                { name: "Team Bulking", desc: "Embaixadores e clientes engajados que representam a marca. Codigos de grupo, identidade compartilhada." },
                { name: "Bulking Army", desc: "Base ampla de seguidores e compradores que se identificam com a cultura e espalham a marca organicamente." },
              ].map((c) => (
                <Card key={c.name}>
                  <p className="text-sm font-semibold mb-2" style={{ fontFamily: "'Kanit', sans-serif" }}>{c.name}</p>
                  <p className="text-xs" style={{ color: T.textSecondary }}>{c.desc}</p>
                </Card>
              ))}
            </div>

            {/* Experience Philosophy */}
            <h3 className="text-lg font-semibold mb-4" style={{ fontFamily: "'Kanit', sans-serif" }}>Filosofia de Experiencia</h3>
            <div className="space-y-3 mb-12">
              {[
                "A Bulking trata a base como ativo estrategico, nao so como compradores.",
                "O ideal e que cada drop pareca evento cultural: quem e de dentro entende, quem e de fora quer entrar.",
                "Produto forte e narrativa forte andam juntos. Um nao funciona sem o outro.",
              ].map((text, i) => (
                <div key={i} className="flex items-start gap-4 p-4 rounded-lg" style={{ backgroundColor: T.surfaceAlt }}>
                  <span className="shrink-0 text-xs font-mono pt-0.5" style={{ color: T.accentMuted }}>{String(i + 1).padStart(2, "0")}</span>
                  <p className="text-sm" style={{ color: T.textSecondary }}>{text}</p>
                </div>
              ))}
            </div>

            {/* Touchpoints */}
            <h3 className="text-lg font-semibold mb-6" style={{ fontFamily: "'Kanit', sans-serif" }}>Touchpoints</h3>
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {[
                { tp: "Website", tom: "Determinado, confiante", vis: "Preto, branco, Kanit bold", exp: "Compra em 3 cliques" },
                { tp: "Instagram", tom: "Direto, cultural", vis: "Grid escuro, alto contraste", exp: "Conteudo diario, sem emojis" },
                { tp: "WhatsApp", tom: "Pessoal, direto", vis: "Mensagem limpa, sem spam", exp: "Canal de venda e relacionamento" },
                { tp: "Embalagem", tom: "Premium, intencional", vis: "Caixa preta, detalhes brancos", exp: "Unboxing com identidade" },
                { tp: "Email", tom: "Pessoal, sem enrolacao", vis: "Template dark, CTA branco", exp: "3 paragrafos max" },
                { tp: "Suporte", tom: "Parceiro, resolutivo", vis: "Alinhado com a marca", exp: "Resposta rapida, solucao" },
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
          </section>

          {/* =========================================================== */}
          {/* 09. AMBICAO & VISAO */}
          {/* =========================================================== */}
          <section className="py-24 md:py-32" style={{ borderTop: `1px solid ${T.border}` }}>
            <SectionTitle id="ambicao" number="09" title="Ambicao & Visao" subtitle="De marca de roupa a plataforma cultural" />

            <PullQuote>
              Evoluir de marca de roupa para plataforma cultural do lifestyle do treino.
            </PullQuote>

            <div className="grid sm:grid-cols-2 gap-4 mb-12">
              {[
                { t: "Expansao de linhas", d: "Crescer o feminino, explorar categorias adjacentes, sem diluir identidade." },
                { t: "Presenca fisica", d: "Lojas proprias e possibilidade de franquias no futuro, mantendo experiencia alinhada." },
                { t: "Canais de venda", d: "Marketplaces, WhatsApp como canal direto, e-commerce como base principal." },
                { t: "Inteligencia de dados", d: "Pricing, estoque e demanda orientados por dados. Reduzir rupturas, aumentar eficiencia." },
                { t: "Colaboracoes estrategicas", d: "Elevam percepcao, ampliam audiencia e trazem legitimidade — sem virar collab por hype." },
                { t: "Plataforma cultural", d: "Ser referencia numero 1 em lifestyle com valor agregado. Treino como cultura, nao como nicho." },
              ].map((item) => (
                <Card key={item.t}>
                  <p className="text-sm font-semibold mb-1" style={{ fontFamily: "'Kanit', sans-serif" }}>{item.t}</p>
                  <p className="text-xs" style={{ color: T.textSecondary }}>{item.d}</p>
                </Card>
              ))}
            </div>
          </section>

          {/* =========================================================== */}
          {/* 10. REGRAS DE OURO */}
          {/* =========================================================== */}
          <section className="py-24 md:py-32" style={{ borderTop: `1px solid ${T.border}` }}>
            <SectionTitle id="regras" number="10" title="Regras de Ouro" subtitle="Principios inegociaveis da marca" />

            <div className="grid sm:grid-cols-2 gap-4 mb-16">
              <RuleCard number="01" title="Cultura antes de conversao" description="A conversao vem como consequencia. Construa cultura primeiro, venda depois." />
              <RuleCard number="02" title="Produto forte + narrativa forte" description="Um nao funciona sem o outro. Design autoral e historia caminham juntos." />
              <RuleCard number="03" title="Nao romantizar facilidade" description="A marca respeita o caminho dificil. Sem atalhos, sem promessas vazias." />
              <RuleCard number="04" title="Comunidade e o diferencial" description="O concorrente copia produto, copia preco, copia estetica. Nao copia comunidade." />
            </div>

            {/* Is This On-Brand? */}
            <h3 className="text-lg font-semibold mb-4" style={{ fontFamily: "'Kanit', sans-serif" }}>Framework &ldquo;Is This On-Brand?&rdquo;</h3>
            <p className="text-sm mb-6" style={{ color: T.textSecondary }}>Antes de qualquer decisao criativa, passe por este filtro:</p>
            <div className="space-y-3 mb-12">
              {[
                "Um Hero disciplinado com olhar de Creator faria isso?",
                "Quem treina como estilo de vida se identificaria?",
                "\"Respect the Hustle\" caberia aqui?",
                "Isso e preto, branco e direto?",
                "Comunica pertencimento sem autopromocao?",
                "Parece marca de moda com raizes no treino?",
              ].map((q, i) => (
                <div key={i} className="flex items-start gap-3 p-4 rounded-lg" style={{ backgroundColor: T.surfaceAlt, border: `1px solid ${T.border}` }}>
                  <span className="shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold" style={{ backgroundColor: T.textPrimary, color: T.bg, fontFamily: "'Kanit', sans-serif" }}>{i + 1}</span>
                  <p className="text-sm pt-1" style={{ color: T.textSecondary }}>{q}</p>
                </div>
              ))}
            </div>

            {/* Cheat Sheet */}
            <h3 className="text-lg font-semibold mb-4" style={{ fontFamily: "'Kanit', sans-serif" }}>Cheat Sheet para o Time</h3>
            <div className="grid md:grid-cols-2 gap-4">
              <Card>
                <p className="text-xs uppercase tracking-wider mb-4" style={{ color: T.accentSubtle, fontFamily: "'Kanit', sans-serif" }}>Faca</p>
                <ul className="space-y-2 text-sm" style={{ color: T.textSecondary }}>
                  {[
                    "Fale com confianca e determinacao",
                    "Valorize o processo e a consistencia",
                    "Mostre resultado real, nao promessa",
                    "Use estetica limpa, forte e intencional",
                    "Trate o cliente como parceiro de jornada",
                    "Celebre o esforco, nao so o resultado final",
                  ].map((t) => (
                    <li key={t} className="flex items-start gap-2"><span style={{ color: T.accentSubtle }}>+</span>{t}</li>
                  ))}
                </ul>
              </Card>
              <Card>
                <p className="text-xs uppercase tracking-wider mb-4" style={{ color: T.accentMuted, fontFamily: "'Kanit', sans-serif" }}>Nao Faca</p>
                <ul className="space-y-2 text-sm" style={{ color: T.textSecondary }}>
                  {[
                    "Nao grite ou use CAPSLOCK excessivo",
                    "Nao ridicularize quem esta comecando",
                    "Nao use motivacao barata ou girias",
                    "Nao copie estetica de marca de suplemento",
                    "Nao promova cultura toxica de overtraining",
                    "Nao use emojis em comunicacao da marca",
                  ].map((t) => (
                    <li key={t} className="flex items-start gap-2"><span style={{ color: T.accentMuted }}>—</span>{t}</li>
                  ))}
                </ul>
              </Card>
            </div>
          </section>

        </main>

        {/* ============================================================= */}
        {/* FOOTER */}
        {/* ============================================================= */}
        <footer className="py-24 text-center" style={{ borderTop: `1px solid ${T.border}` }}>
          <p className="text-3xl md:text-5xl font-bold mb-4" style={{ fontFamily: "'Kanit', sans-serif" }}>Respect the Hustle.</p>
          <p className="text-sm mb-1" style={{ color: T.textMuted }}>www.bulking.com.br &middot; @bulkingoficial</p>
          <p className="text-xs" style={{ color: T.textMuted }}>BULKING — Manual da Marca v2.0 — Marco 2026</p>
        </footer>

        {/* Scroll to top */}
        {showTop && (
          <button
            onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
            className="fixed bottom-6 right-6 z-50 w-10 h-10 rounded-full flex items-center justify-center transition-transform hover:scale-110 print:hidden"
            style={{ backgroundColor: T.textPrimary, color: T.bg }}
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
          section { page-break-inside: avoid; }
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
      <p className="text-xs uppercase tracking-wider mb-3" style={{ color: T.accentSubtle, fontFamily: "'Kanit', sans-serif" }}>{title}</p>
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
                {isCopied ? <Check className="w-3 h-3" style={{ color: T.textPrimary }} /> : <Copy className="w-3 h-3 opacity-30" />}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
