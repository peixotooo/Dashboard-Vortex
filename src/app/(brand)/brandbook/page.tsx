"use client";

import React, { useState, useEffect } from "react";
import Link from "next/link";
import { ArrowLeft, ChevronUp, Printer, Copy, Check } from "lucide-react";

/* ========================================================================
   BULKING — Manual da Marca v2.1
   Paleta: preto, branco e tons de cinza. Zero cores.
   Tipografia: Kanit (headings), Inter (body)
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
    { name: "Charcoal", hex: "#111111", rgb: "17, 17, 17", use: "Alternancia de superficies." },
    { name: "Graphite", hex: "#1A1A1A", rgb: "26, 26, 26", use: "Bordas sutis." },
    { name: "Dark Gray", hex: "#333333", rgb: "51, 51, 51", use: "Icones inativos." },
    { name: "Medium Gray", hex: "#666666", rgb: "102, 102, 102", use: "Labels e captions." },
    { name: "Silver", hex: "#999999", rgb: "153, 153, 153", use: "Accents secundarios." },
    { name: "Light Gray", hex: "#CCCCCC", rgb: "204, 204, 204", use: "Hover states, subtitulos." },
    { name: "Off-White", hex: "#E5E5E5", rgb: "229, 229, 229", use: "Destaques sutis." },
    { name: "Pure White", hex: "#FFFFFF", rgb: "255, 255, 255", use: "Texto principal, accent primario." },
  ],
};

const NAV_ITEMS = [
  { id: "quem-somos", label: "Quem Somos", number: "01" },
  { id: "produto", label: "Produto", number: "02" },
  { id: "publico", label: "Publico", number: "03" },
  { id: "posicionamento", label: "Posicionamento", number: "04" },
  { id: "visual", label: "Visual", number: "05" },
  { id: "verbal", label: "Verbal", number: "06" },
  { id: "estetica-regras", label: "Estetica & Regras", number: "07" },
  { id: "referencias", label: "Referencias", number: "08" },
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
      <span className="absolute -top-6 -left-2 text-[7rem] md:text-[10rem] font-extrabold leading-none select-none pointer-events-none" style={{ fontFamily: "'Kanit', sans-serif", color: T.surfaceAlt, opacity: 0.7 }}>{number}</span>
      <p className="text-xs uppercase tracking-[0.3em] mb-3 relative z-10" style={{ color: T.accentSubtle, fontFamily: "'Kanit', sans-serif" }}>{number}</p>
      <h2 className="text-3xl md:text-5xl font-bold mb-3 leading-tight relative z-10" style={{ fontFamily: "'Kanit', sans-serif" }}>{title}</h2>
      {subtitle && <p className="text-lg relative z-10" style={{ color: T.textSecondary }}>{subtitle}</p>}
      <div className="mt-6 h-px w-16 relative z-10" style={{ backgroundColor: T.textPrimary }} />
    </div>
  );
}

function Card({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`rounded-lg p-6 ${className}`} style={{ backgroundColor: T.surfaceAlt, border: `1px solid ${T.border}` }}>{children}</div>
  );
}

function Badge({ children, variant = "default" }: { children: React.ReactNode; variant?: "default" | "light" | "dark" }) {
  const colors = { default: { bg: T.border, text: T.textSecondary }, light: { bg: "rgba(255,255,255,0.1)", text: T.textPrimary }, dark: { bg: T.surfaceElevated, text: T.accentMuted } };
  const c = colors[variant];
  return <span className="inline-block text-xs font-medium px-2.5 py-1 rounded-full" style={{ backgroundColor: c.bg, color: c.text }}>{children}</span>;
}

function ColorSwatch({ name, hex, rgb, use }: { name: string; hex: string; rgb?: string; use?: string }) {
  const { copied, copy } = useCopy();
  const isCopied = copied === hex;
  return (
    <button onClick={() => copy(hex)} className="text-left group w-full">
      <div className="rounded-lg mb-3 h-16 transition-transform group-hover:scale-[1.02]" style={{ backgroundColor: hex, border: hex === "#000000" || hex === "#FFFFFF" || hex === "#E5E5E5" ? `1px solid ${T.border}` : "none" }} />
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
            {headers.map((h, i) => <th key={i} className="text-left px-4 py-3 text-xs uppercase tracking-wider font-semibold" style={{ color: T.textSecondary, borderBottom: `1px solid ${T.border}`, fontFamily: "'Kanit', sans-serif" }}>{h}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} className="transition-colors hover:bg-white/[0.02]" style={{ borderBottom: i < rows.length - 1 ? `1px solid ${T.borderSubtle}` : "none" }}>
              {row.map((cell, j) => <td key={j} className="px-4 py-3" style={{ color: j === 0 ? T.textPrimary : T.textSecondary }}>{cell}</td>)}
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

function PullQuote({ children }: { children: React.ReactNode }) {
  return (
    <blockquote className="py-12 md:py-16 my-12 md:my-16 relative" style={{ borderTop: `1px solid ${T.border}`, borderBottom: `1px solid ${T.border}` }}>
      <span className="absolute top-4 left-0 text-6xl leading-none select-none" style={{ fontFamily: "'Kanit', sans-serif", color: T.border }}>&ldquo;</span>
      <p className="text-2xl md:text-4xl font-light leading-snug max-w-4xl pl-2" style={{ fontFamily: "'Kanit', sans-serif" }}>{children}</p>
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
      (entries) => { for (const e of entries) { if (e.isIntersecting) { setActiveSection(e.target.id); break; } } },
      { rootMargin: "-100px 0px -60% 0px", threshold: 0.1 }
    );
    NAV_ITEMS.forEach(({ id }) => { const el = document.getElementById(id); if (el) observer.observe(el); });
    return () => observer.disconnect();
  }, []);

  return (
    <>
      {/* eslint-disable-next-line @next/next/no-page-custom-font */}
      <link href="https://fonts.googleapis.com/css2?family=Kanit:wght@300;400;500;600;700;800&family=Inter:wght@300;400;500;600&display=swap" rel="stylesheet" />

      <div className="min-h-screen" style={{ backgroundColor: T.bg, color: T.textPrimary }}>

        {/* TOPBAR */}
        <div className="fixed top-0 left-0 right-0 z-40 flex items-center justify-between px-4 md:px-8 py-3 print:hidden" style={{ backgroundColor: "rgba(0,0,0,0.6)", backdropFilter: "blur(12px)", borderBottom: `1px solid ${T.borderSubtle}` }}>
          <Link href="/" className="flex items-center gap-2 text-sm transition-colors hover:text-white" style={{ color: T.textMuted }}>
            <ArrowLeft className="w-4 h-4" /><span className="hidden sm:inline">Dashboard</span>
          </Link>
          <button onClick={() => window.print()} className="flex items-center gap-2 text-sm transition-colors hover:text-white" style={{ color: T.textMuted }}>
            <Printer className="w-4 h-4" /><span className="hidden sm:inline">Imprimir</span>
          </button>
        </div>

        {/* HERO */}
        <section className="flex flex-col items-center justify-center text-center min-h-screen px-6 pt-16">
          <p className="text-xs uppercase tracking-[0.4em] mb-8" style={{ color: T.textMuted }}>Manual da Marca</p>
          <h1 className="text-8xl sm:text-9xl md:text-[12rem] font-extrabold leading-none tracking-tight mb-6" style={{ fontFamily: "'Kanit', sans-serif" }}>BULKING</h1>
          <p className="text-lg md:text-xl mb-2" style={{ color: T.textSecondary, fontFamily: "'Kanit', sans-serif", fontWeight: 300 }}>Respect the Hustle.</p>
          <p className="text-xs mt-6" style={{ color: T.textMuted }}>v2.1 — Marco 2026</p>
          <div className="mt-16"><div className="w-px h-16 mx-auto" style={{ background: `linear-gradient(to bottom, ${T.textMuted}, transparent)` }} /></div>
        </section>

        {/* NAV STICKY */}
        <nav className="sticky top-[49px] z-30 print:hidden overflow-x-auto" style={{ backgroundColor: "rgba(0,0,0,0.85)", backdropFilter: "blur(12px)", borderBottom: `1px solid ${T.borderSubtle}` }}>
          <div className="max-w-6xl mx-auto flex items-center gap-1 px-4 md:px-8 py-2">
            {NAV_ITEMS.map(({ id, label }) => (
              <a key={id} href={`#${id}`} className="shrink-0 px-3 py-1.5 rounded text-xs font-medium transition-colors"
                style={{ fontFamily: "'Kanit', sans-serif", color: activeSection === id ? T.textPrimary : T.textMuted, backgroundColor: activeSection === id ? "rgba(255,255,255,0.08)" : "transparent" }}
                onClick={(e) => { e.preventDefault(); document.getElementById(id)?.scrollIntoView({ behavior: "smooth" }); }}>{label}</a>
            ))}
          </div>
        </nav>

        {/* CONTENT */}
        <main className="max-w-5xl mx-auto px-6 md:px-8">

          {/* =========================================================== */}
          {/* 01. QUEM SOMOS */}
          {/* =========================================================== */}
          <section className="py-24 md:py-32">
            <SectionTitle id="quem-somos" number="01" title="Quem Somos" subtitle="Origem, essencia e identidade" />

            <PullQuote>
              A Bulking e uma marca brasileira de vestuario que traduz a cultura do treino em identidade de vida, criando pecas que funcionam dentro e fora da academia.
            </PullQuote>

            {/* Origin */}
            <div className="grid md:grid-cols-3 gap-4 mb-12">
              {[
                { n: "2013", t: "Fundacao", d: "Nascemos em Goiania com mentalidade de execucao e resiliencia." },
                { n: "40%+", t: "Recorrencia", d: "Mais de 40% dos clientes compram novamente." },
                { n: "R$10M+", t: "Faturamento anual", d: "Buscando escalar como referencia numero 1 em lifestyle fitness." },
              ].map((item) => (
                <Card key={item.n}>
                  <p className="text-3xl font-extrabold mb-2" style={{ fontFamily: "'Kanit', sans-serif" }}>{item.n}</p>
                  <p className="text-sm font-semibold mb-1" style={{ fontFamily: "'Kanit', sans-serif" }}>{item.t}</p>
                  <p className="text-xs" style={{ color: T.textSecondary }}>{item.d}</p>
                </Card>
              ))}
            </div>

            {/* Missao + Visao */}
            <div className="grid md:grid-cols-2 gap-4 mb-12">
              <Card>
                <p className="text-xs uppercase tracking-wider mb-2" style={{ color: T.accentSubtle, fontFamily: "'Kanit', sans-serif" }}>Missao</p>
                <p className="text-sm" style={{ color: T.textSecondary }}>Inspirar e reconhecer aqueles que se dedicam acima da media, conquistando seus objetivos com esforco e consistencia.</p>
              </Card>
              <Card>
                <p className="text-xs uppercase tracking-wider mb-2" style={{ color: T.accentSubtle, fontFamily: "'Kanit', sans-serif" }}>Visao</p>
                <p className="text-sm" style={{ color: T.textSecondary }}>Fortalecer a presenca da marca por meio da expansao estrategica de canais e publico, elevando continuamente o padrao dos produtos para superar expectativas.</p>
              </Card>
            </div>

            {/* Valores */}
            <h3 className="text-lg font-semibold mb-4" style={{ fontFamily: "'Kanit', sans-serif" }}>Valores</h3>
            <div className="grid sm:grid-cols-2 gap-4 mb-12">
              {[
                { t: "Determinacao", d: "Valorizamos o trabalho duro e a persistencia em cada acao." },
                { t: "Reputacao Excelente", d: "Mantemos padroes elevados em todos os aspectos — produto, comunicacao e experiencia." },
                { t: "Consistencia", d: "Evolucao continua acima de resultados imediatos." },
                { t: "Exigencia", d: "Busca constante por melhorias. Cada detalhe importa." },
              ].map((v) => (
                <Card key={v.t}>
                  <p className="text-sm font-semibold mb-1" style={{ fontFamily: "'Kanit', sans-serif" }}>{v.t}</p>
                  <p className="text-xs" style={{ color: T.textSecondary }}>{v.d}</p>
                </Card>
              ))}
            </div>

            {/* Archetype */}
            <h3 className="text-lg font-semibold mb-4" style={{ fontFamily: "'Kanit', sans-serif" }}>Arquetipo</h3>
            <div className="grid md:grid-cols-2 gap-4 mb-12">
              <Card>
                <Badge variant="light">Primario — 75%</Badge>
                <h4 className="text-2xl font-bold mt-3 mb-2" style={{ fontFamily: "'Kanit', sans-serif" }}>Hero</h4>
                <p className="text-sm" style={{ color: T.textSecondary }}>O Hero disciplinado que constroi — prova valor atraves de acao, nao de discurso.</p>
              </Card>
              <Card>
                <Badge variant="dark">Secundario — 25%</Badge>
                <h4 className="text-2xl font-bold mt-3 mb-2" style={{ fontFamily: "'Kanit', sans-serif" }}>Creator</h4>
                <p className="text-sm" style={{ color: T.textSecondary }}>Fashion fitness como expressao de identidade. Design autoral aplicado a roupa de treino.</p>
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
          {/* 02. PRODUTO & ECOSSISTEMA */}
          {/* =========================================================== */}
          <section className="py-24 md:py-32" style={{ borderTop: `1px solid ${T.border}` }}>
            <SectionTitle id="produto" number="02" title="Produto & Ecossistema" subtitle="O que vendemos e como nos organizamos" />

            <p className="text-base leading-relaxed mb-6" style={{ color: T.textSecondary }}>
              Itens carro-chefe de alta demanda: camisetas oversized e regatas, com variedade de cores e temas. A marca transita entre o visual de performance e o casual, sem depender de estetica puramente fitness.
            </p>

            <PullQuote>A Bulking funciona melhor quando parece marca de moda com raizes no treino, nao quando parece uniforme de academia.</PullQuote>

            {/* Sub-lines */}
            <h3 className="text-lg font-semibold mb-6" style={{ fontFamily: "'Kanit', sans-serif" }}>Linhas e Sub-marcas</h3>
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4 mb-12">
              {[
                { name: "Bulking Club", desc: "Programa de fidelidade e comunidade. Membros com acesso antecipado a drops." },
                { name: "Team Bulking", desc: "Embaixadores e clientes engajados que representam a marca." },
                { name: "Bulking Army", desc: "Base ampla de seguidores que se identificam com a cultura." },
                { name: "Bulking Studio", desc: "Acabamento premium e design mais refinado." },
                { name: "Athlete Division", desc: "Performance-first. Para quem treina com intensidade maxima." },
                { name: "Luxury Heritage", desc: "Pecas com valor agregado elevado. Qualidade como statement." },
                { name: "Heavy", desc: "Estetica pesada, robusta. Presenca e impacto visual." },
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

            <div className="space-y-3 mb-12">
              {[
                "Homens e mulheres, de 18 a 35 anos, que treinam ou vivem a cultura do treino como estilo de vida.",
                "Pessoas movidas por disciplina, constancia, ambicao e evolucao pessoal.",
                "Consumidores que querem vestir identidade, nao so roupa.",
                "Publico que busca roupas com bom custo-beneficio e significado.",
              ].map((text, i) => (
                <div key={i} className="flex items-start gap-4 p-4 rounded-lg" style={{ backgroundColor: T.surfaceAlt }}>
                  <span className="shrink-0 text-xs font-mono pt-0.5" style={{ color: T.accentMuted }}>{String(i + 1).padStart(2, "0")}</span>
                  <p className="text-sm" style={{ color: T.textSecondary }}>{text}</p>
                </div>
              ))}
            </div>

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

            <PullQuote>Eu nao pego atalho. O treino e minha metafora pra vida. Quem e de dentro entende, quem e de fora quer entrar.</PullQuote>

            <div className="grid md:grid-cols-2 gap-4">
              <Card>
                <p className="text-xs uppercase tracking-wider mb-2" style={{ color: T.accentSubtle, fontFamily: "'Kanit', sans-serif" }}>Reflexo</p>
                <p className="text-sm" style={{ color: T.textSecondary }}>Alguem que treina como estilo de vida e veste identidade, nao so roupa. Forte, estiloso e dedicado.</p>
              </Card>
              <Card>
                <p className="text-xs uppercase tracking-wider mb-2" style={{ color: T.accentSubtle, fontFamily: "'Kanit', sans-serif" }}>Autoimagem</p>
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

            {/* Positioning Note */}
            <p className="text-base leading-relaxed mb-12" style={{ color: T.textSecondary }}>
              Buscamos inspiracao em mercados como streetwear e athleisure para criar um estilo proprio, autentico e fora do senso comum. Rejeitamos simbolos e linguagens saturadas. Nosso foco esta em construir uma comunidade forte, engajada e conectada com a essencia da marca.
            </p>

            {/* The Word */}
            <div className="text-center py-12 mb-12 rounded-lg" style={{ backgroundColor: T.surface, border: `1px solid ${T.border}` }}>
              <p className="text-xs uppercase tracking-[0.3em] mb-4" style={{ color: T.textMuted }}>A Palavra da Bulking</p>
              <p className="text-5xl md:text-7xl font-extrabold" style={{ fontFamily: "'Kanit', sans-serif" }}>HUSTLE</p>
              <p className="text-sm mt-4 max-w-md mx-auto" style={{ color: T.textSecondary }}>Trabalho duro, determinacao, processo diario, respeito pelo caminho dificil.</p>
            </div>

            {/* Promise */}
            <h3 className="text-lg font-semibold mb-4" style={{ fontFamily: "'Kanit', sans-serif" }}>Promessa</h3>
            <div className="space-y-3 mb-12">
              {["Voce veste respeito pela rotina que ninguem ve.", "Voce veste a disciplina que te transforma."].map((text, i) => (
                <div key={i} className="p-5 rounded-lg" style={{ backgroundColor: T.surfaceAlt, borderLeft: `3px solid ${T.textPrimary}` }}>
                  <p className="text-lg" style={{ fontFamily: "'Kanit', sans-serif", fontWeight: 400 }}>{text}</p>
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
            <SectionTitle id="visual" number="05" title="Identidade Visual" subtitle="Paleta, tipografia e logo" />

            <p className="text-sm mb-8" style={{ color: T.textSecondary }}>
              A Bulking opera em preto, branco e tons de cinza. Sem cores. A forca vem do contraste, da tipografia e da composicao.
            </p>

            {/* Color Palette */}
            <h3 className="text-lg font-semibold mb-6" style={{ fontFamily: "'Kanit', sans-serif" }}>Paleta</h3>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-4 mb-12">
              {COLORS.palette.map((c) => <ColorSwatch key={c.hex + c.name} {...c} />)}
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
            <p className="text-sm mb-8" style={{ color: T.textSecondary }}>Kanit para headings e elementos de marca. Inter para body text.</p>
            <div className="mb-12">
              <TypographySpecimen label="Display" weight={800} size="4.5rem" font="'Kanit', sans-serif" sample="RESPECT THE HUSTLE" />
              <TypographySpecimen label="H1" weight={700} size="3rem" font="'Kanit', sans-serif" sample="Cultura do treino como identidade." />
              <TypographySpecimen label="H2" weight={600} size="2.25rem" font="'Kanit', sans-serif" sample="Identidade Visual" />
              <TypographySpecimen label="Body" weight={400} size="1rem" font="'Inter', sans-serif" sample="A Bulking traduz a cultura do treino em identidade de vida, criando pecas que funcionam dentro e fora da academia." />
              <TypographySpecimen label="Caption" weight={300} size="0.875rem" font="'Inter', sans-serif" sample="v2.1 — Marco 2026 — Goiania, GO" />
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
            <Table headers={["Variacao", "Uso"]} rows={[
              ["Branco sobre preto", "Uso principal — fundos escuros, digital, social"],
              ["Preto sobre branco", "Fundos claros, impressos, documentos"],
              ["Monocromatico cinza", "Contextos neutros, colaterais, bordados"],
              ["Com tagline", "BULKING + Respect the Hustle — campanhas e hero sections"],
            ]} />
          </section>

          {/* =========================================================== */}
          {/* 06. IDENTIDADE VERBAL */}
          {/* =========================================================== */}
          <section className="py-24 md:py-32" style={{ borderTop: `1px solid ${T.border}` }}>
            <SectionTitle id="verbal" number="06" title="Identidade Verbal" subtitle="Tom de voz, vocabulario e mensagens" />

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
            <h3 className="text-lg font-semibold mb-6" style={{ fontFamily: "'Kanit', sans-serif" }}>Dimensoes de Tom</h3>
            <div className="space-y-6 mb-12">
              {[
                { left: "Formal", right: "Casual", value: 4 },
                { left: "Serio", right: "Divertido", value: 3 },
                { left: "Respeitoso", right: "Irreverente", value: 4 },
                { left: "Factual", right: "Entusiasta", value: 6 },
              ].map((d) => (
                <div key={d.left}>
                  <div className="flex justify-between text-xs mb-2" style={{ color: T.textMuted }}><span>{d.left}</span><span>{d.right}</span></div>
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
                  {["Hustle", "Disciplina", "Constancia", "Construcao", "Respeito", "Legado", "Rotina", "Presenca", "Missao", "Progresso"].map((w) => (
                    <Badge key={w} variant="light">{w}</Badge>
                  ))}
                </div>
              </Card>
              <Card>
                <p className="text-xs uppercase tracking-wider mb-4" style={{ color: T.accentMuted, fontFamily: "'Kanit', sans-serif" }}>Evitar</p>
                <div className="flex flex-wrap gap-2">
                  {["Vai la campeao", "Transforme sua vida", "Desconto!!!", "Arrasa", "Facil", "Maromba", "So hoje!", "Bora"].map((w) => (
                    <Badge key={w} variant="dark">{w}</Badge>
                  ))}
                </div>
              </Card>
            </div>

            {/* What We Avoid */}
            <h3 className="text-lg font-semibold mb-4" style={{ fontFamily: "'Kanit', sans-serif" }}>O Que Evitamos</h3>
            <div className="grid sm:grid-cols-2 gap-3 mb-12">
              {[
                "Linguagem de coach.",
                "Promessas milagrosas.",
                "Motivacao generica e frases vazias.",
                "Tom infantilizado ou caricato.",
                "Emojis.",
                "Girias e linguajar informal demais.",
                "Comunicacao excessivamente informal.",
                "Poses cliches de bodybuilder.",
                "Abordagens genericas em produtos e campanhas.",
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
                { tag: "Missao", msg: "Inspirar e reconhecer aqueles que se dedicam acima da media, conquistando seus objetivos com esforco e consistencia." },
                { tag: "Visao", msg: "Fortalecer a presenca da marca por meio da expansao estrategica de canais e publico, elevando continuamente o padrao dos produtos para superar expectativas." },
              ].map((m) => (
                <div key={m.tag} className="flex items-start gap-4 p-4 rounded-lg" style={{ backgroundColor: T.surfaceAlt }}>
                  <span className="shrink-0 text-xs uppercase tracking-wider w-20 pt-0.5" style={{ color: T.accentSubtle, fontFamily: "'Kanit', sans-serif" }}>{m.tag}</span>
                  <p className="text-sm" style={{ color: T.textSecondary }}>{m.msg}</p>
                </div>
              ))}
            </div>
          </section>

          {/* =========================================================== */}
          {/* 07. ESTETICA & REGRAS */}
          {/* =========================================================== */}
          <section className="py-24 md:py-32" style={{ borderTop: `1px solid ${T.border}` }}>
            <SectionTitle id="estetica-regras" number="07" title="Estetica & Regras" subtitle="Direcao criativa e principios inegociaveis" />

            {/* Direction */}
            <h3 className="text-lg font-semibold mb-4" style={{ fontFamily: "'Kanit', sans-serif" }}>Direcao Criativa</h3>
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
            <div className="grid md:grid-cols-2 gap-4 mb-12">
              <Card>
                <p className="text-xs uppercase tracking-wider mb-4" style={{ color: T.accentSubtle, fontFamily: "'Kanit', sans-serif" }}>Funciona</p>
                <ul className="space-y-2 text-sm" style={{ color: T.textSecondary }}>
                  {["Alto contraste preto e branco", "Cenarios arquitetonicos e urbanos", "Fundos minimalistas", "Atleta como modelo — presenca, nao pose", "Tipografia grande como elemento visual", "Narrativa cultural, nao promocional"].map((t) => (
                    <li key={t} className="flex items-start gap-2"><span style={{ color: T.accentSubtle }}>+</span>{t}</li>
                  ))}
                </ul>
              </Card>
              <Card>
                <p className="text-xs uppercase tracking-wider mb-4" style={{ color: T.accentMuted, fontFamily: "'Kanit', sans-serif" }}>Nao Funciona</p>
                <ul className="space-y-2 text-sm" style={{ color: T.textSecondary }}>
                  {["Selfie de espelho em academia", "Fundos neon ou saturados", "Estetica de marca de suplemento", "Fotos stock genericas", "Poses cliches de bodybuilder", "Autopromocao explicita", "Abordagens genericas"].map((t) => (
                    <li key={t} className="flex items-start gap-2"><span style={{ color: T.accentMuted }}>—</span>{t}</li>
                  ))}
                </ul>
              </Card>
            </div>

            {/* Photography Direction */}
            <h3 className="text-lg font-semibold mb-4" style={{ fontFamily: "'Kanit', sans-serif" }}>Fotografia</h3>
            <Table headers={["Elemento", "Direcao"]} rows={[
              ["Iluminacao", "Contraste alto, sombras duras ou luz natural direcional"],
              ["Cenario", "Urbano, arquitetonico, industrial. Nunca academia generica."],
              ["Modelo", "Presenca, atitude, olhar direto. Nao e pose de catalogo."],
              ["Cor", "Preto e branco preferencialmente. Se colorido, tons neutros e frios."],
              ["Composicao", "Espaco negativo generoso. Tipografia integrada a imagem."],
            ]} />

            {/* Golden Rules */}
            <h3 className="text-lg font-semibold mt-16 mb-6" style={{ fontFamily: "'Kanit', sans-serif" }}>Regras de Ouro</h3>
            <div className="grid sm:grid-cols-2 gap-4 mb-12">
              <RuleCard number="01" title="Cultura antes de conversao" description="A conversao vem como consequencia. Construa cultura primeiro, venda depois." />
              <RuleCard number="02" title="Produto forte + narrativa forte" description="Um nao funciona sem o outro. Design autoral e historia caminham juntos." />
              <RuleCard number="03" title="Nao romantizar facilidade" description="A marca respeita o caminho dificil. Sem atalhos, sem promessas vazias." />
              <RuleCard number="04" title="Comunidade e o diferencial" description="O concorrente copia produto, preco e estetica. Nao copia comunidade." />
            </div>

            {/* Cheat Sheet */}
            <h3 className="text-lg font-semibold mb-4" style={{ fontFamily: "'Kanit', sans-serif" }}>Cheat Sheet</h3>
            <div className="grid md:grid-cols-2 gap-4">
              <Card>
                <p className="text-xs uppercase tracking-wider mb-4" style={{ color: T.accentSubtle, fontFamily: "'Kanit', sans-serif" }}>Faca</p>
                <ul className="space-y-2 text-sm" style={{ color: T.textSecondary }}>
                  {["Fale com confianca e determinacao", "Valorize o processo e a consistencia", "Mostre resultado real, nao promessa", "Use estetica limpa, forte e intencional", "Trate o cliente como parceiro de jornada", "Celebre o esforco, nao so o resultado final"].map((t) => (
                    <li key={t} className="flex items-start gap-2"><span style={{ color: T.accentSubtle }}>+</span>{t}</li>
                  ))}
                </ul>
              </Card>
              <Card>
                <p className="text-xs uppercase tracking-wider mb-4" style={{ color: T.accentMuted, fontFamily: "'Kanit', sans-serif" }}>Nao Faca</p>
                <ul className="space-y-2 text-sm" style={{ color: T.textSecondary }}>
                  {["Nao grite ou use CAPSLOCK excessivo", "Nao ridicularize quem esta comecando", "Nao use motivacao barata ou girias", "Nao copie estetica de marca de suplemento", "Nao promova cultura toxica de overtraining", "Nao use emojis em comunicacao da marca"].map((t) => (
                    <li key={t} className="flex items-start gap-2"><span style={{ color: T.accentMuted }}>—</span>{t}</li>
                  ))}
                </ul>
              </Card>
            </div>
          </section>

          {/* =========================================================== */}
          {/* 08. REFERENCIAS & INSPIRACOES */}
          {/* =========================================================== */}
          <section className="py-24 md:py-32" style={{ borderTop: `1px solid ${T.border}` }}>
            <SectionTitle id="referencias" number="08" title="Referencias & Inspiracoes" subtitle="Marcas que informam nosso posicionamento" />

            <p className="text-sm mb-12" style={{ color: T.textSecondary }}>
              Nao copiamos ninguem. Estudamos quem faz bem para fazer melhor. Cada marca abaixo representa um aspecto que admiramos e que nos ajuda a refinar o que a Bulking pode ser.
            </p>

            {/* Performance */}
            <h3 className="text-lg font-semibold mb-6" style={{ fontFamily: "'Kanit', sans-serif" }}>Performance</h3>
            <div className="grid md:grid-cols-2 gap-4 mb-12">
              <Card>
                <div className="flex items-baseline justify-between mb-3">
                  <p className="text-xl font-bold" style={{ fontFamily: "'Kanit', sans-serif" }}>ASRV</p>
                  <span className="text-xs" style={{ color: T.textMuted }}>@ASRV</span>
                </div>
                <Badge variant="dark">Posicionamento de performance</Badge>
                <p className="text-sm mt-3" style={{ color: T.textSecondary }}>Marca californiana que criou a categoria &ldquo;Urban Training&rdquo; — 25+ tecidos proprietarios, distribuicao em Equinox, estetica minimalista e tecnica. Prova que roupa fitness pode cobrar premium quando o produto tem historia tecnica real.</p>
                <p className="text-xs mt-3" style={{ color: T.textMuted }}>Estetica: Minimalista, escura, tecnica. Sem logos altos — a textura e o corte falam.</p>
              </Card>
              <Card>
                <div className="flex items-baseline justify-between mb-3">
                  <p className="text-xl font-bold" style={{ fontFamily: "'Kanit', sans-serif" }}>247 BY REPRESENT</p>
                  <span className="text-xs" style={{ color: T.textMuted }}>@247REPRESENT</span>
                </div>
                <Badge variant="dark">Performance + Comunidade</Badge>
                <p className="text-sm mt-3" style={{ color: T.textSecondary }}>Sub-marca da Represent CLO focada em activewear com DNA de streetwear premium. Tecidos tecnicos com silhueta de moda. Referencia direta: performance que nao parece roupa de academia.</p>
                <p className="text-xs mt-3" style={{ color: T.textMuted }}>Estetica: Tons neutros, minimalismo atletico, branding sutil &ldquo;247&rdquo;.</p>
              </Card>
            </div>

            {/* Community */}
            <h3 className="text-lg font-semibold mb-6" style={{ fontFamily: "'Kanit', sans-serif" }}>Comunidade</h3>
            <div className="grid md:grid-cols-2 gap-4 mb-12">
              <Card>
                <div className="flex items-baseline justify-between mb-3">
                  <p className="text-xl font-bold" style={{ fontFamily: "'Kanit', sans-serif" }}>GYMSHARK</p>
                  <span className="text-xs" style={{ color: T.textMuted }}>@GYMSHARK</span>
                </div>
                <Badge variant="dark">Construcao de comunidade</Badge>
                <p className="text-sm mt-3" style={{ color: T.textSecondary }}>De uma garagem no UK a avaliacao de $1.6B+. Pioneira em usar influenciadores como co-criadores de marca, nao so como midia paga. 18M+ seguidores, eventos pop-up, drops com contagem regressiva. Comunidade como motor de crescimento.</p>
                <p className="text-xs mt-3" style={{ color: T.textMuted }}>Estetica: Acessivel, energetica. Logo iconica como badge de pertencimento.</p>
              </Card>
              <Card>
                <div className="flex items-baseline justify-between mb-3">
                  <p className="text-xl font-bold" style={{ fontFamily: "'Kanit', sans-serif" }}>DARC SPORT</p>
                  <span className="text-xs" style={{ color: T.textMuted }}>@DARCSPORT</span>
                </div>
                <Badge variant="dark">Comunidade tribal</Badge>
                <p className="text-sm mt-3" style={{ color: T.textSecondary }}>Funde gym culture com estetica gotica sob a filosofia &ldquo;Wolves Among Sheep&rdquo;. O lobo nao e branding — e identidade tribal. Vestir Darc Sport na academia e sinal social. Prova que comunidade se constroi com simbolismo e significado, nao com marketing.</p>
                <p className="text-xs mt-3" style={{ color: T.textMuted }}>Estetica: Escura, gotica, agressiva. Lobos, tipografia medieval, oversized.</p>
              </Card>
              <Card>
                <div className="flex items-baseline justify-between mb-3">
                  <p className="text-xl font-bold" style={{ fontFamily: "'Kanit', sans-serif" }}>VQFIT</p>
                  <span className="text-xs" style={{ color: T.textMuted }}>@VQFIT</span>
                </div>
                <Badge variant="dark">Comunidade + Drops</Badge>
                <p className="text-sm mt-3" style={{ color: T.textSecondary }}>Active streetwear londrino. Collabs com pop culture (Dragon Ball, Yu-Gi-Oh!), modelo de drops limitados e programa de fidelidade como retencao. Mostra como marca mid-tier ganha relevancia cultural.</p>
                <p className="text-xs mt-3" style={{ color: T.textMuted }}>Estetica: Minimalista premium, preto/branco/militar, branding emborrachado.</p>
              </Card>
            </div>

            {/* Benchmarks */}
            <h3 className="text-lg font-semibold mb-6" style={{ fontFamily: "'Kanit', sans-serif" }}>Benchmarks</h3>
            <div className="grid md:grid-cols-2 gap-4 mb-12">
              <Card>
                <div className="flex items-baseline justify-between mb-3">
                  <p className="text-xl font-bold" style={{ fontFamily: "'Kanit', sans-serif" }}>ALPHALETE</p>
                  <span className="text-xs" style={{ color: T.textMuted }}>@ALPHALETE</span>
                </div>
                <Badge variant="dark">Benchmark Gringo</Badge>
                <p className="text-sm mt-3" style={{ color: T.textSecondary }}>De YouTuber a $100M+. Ecossistema completo: apparel + Alphaland (complexo de academia de 18.5 acres) + 3D Energy Drinks. Modelo creator-as-founder. O benchmark do que uma marca fitness brasileira pode se tornar em escala.</p>
                <p className="text-xs mt-3" style={{ color: T.textMuted }}>Estetica: Limpa, versatil. Linhas redesenhadas a cada lancamento.</p>
              </Card>
              <Card>
                <div className="flex items-baseline justify-between mb-3">
                  <p className="text-xl font-bold" style={{ fontFamily: "'Kanit', sans-serif" }}>FLAG NOR FAIL</p>
                  <span className="text-xs" style={{ color: T.textMuted }}>@FLAGNORFAIL</span>
                </div>
                <Badge variant="dark">Benchmark Gringo</Badge>
                <p className="text-sm mt-3" style={{ color: T.textSecondary }}>Fundada por Rob Bailey (musico) e Dana Linn Bailey (pro bodybuilder). Modelo de drops limitados (~300 unidades por design). OG do playbook &ldquo;personalidade fitness vira marca&rdquo;. Comunidade construida sobre identidade de fundador.</p>
                <p className="text-xs mt-3" style={{ color: T.textMuted }}>Estetica: Escura com acentos dourados, tipografia industrial, imagens raw de alta energia.</p>
              </Card>
            </div>

            {/* Luxury Streetwear */}
            <h3 className="text-lg font-semibold mb-6" style={{ fontFamily: "'Kanit', sans-serif" }}>Luxury Streetwear</h3>
            <div className="grid md:grid-cols-2 gap-4 mb-12">
              <Card>
                <div className="flex items-baseline justify-between mb-3">
                  <p className="text-xl font-bold" style={{ fontFamily: "'Kanit', sans-serif" }}>COLE BUXTON</p>
                  <span className="text-xs" style={{ color: T.textMuted }}>@COLE_BUXTON</span>
                </div>
                <Badge variant="dark">Luxury Streetwear</Badge>
                <p className="text-sm mt-3" style={{ color: T.textSecondary }}>Reimagina estetica de boxe e gym old-school (Rocky, Ali) com lente de luxo minimalista. Filosofia &ldquo;Athletic Essentialism&rdquo; — so o essencial. Zero marketing gimmick, estourou no Instagram so com produto. North star pra &ldquo;fitness brand que nao parece fitness brand&rdquo;.</p>
                <p className="text-xs mt-3" style={{ color: T.textMuted }}>Estetica: Radicalmente minimalista. Tecidos pesados, tons lavados, zero logo. Quiet luxury + gym.</p>
              </Card>
              <Card>
                <div className="flex items-baseline justify-between mb-3">
                  <p className="text-xl font-bold" style={{ fontFamily: "'Kanit', sans-serif" }}>REPRESENT CLO</p>
                  <span className="text-xs" style={{ color: T.textMuted }}>@REPRESENTCLO</span>
                </div>
                <Badge variant="dark">Luxury Streetwear</Badge>
                <p className="text-sm mt-3" style={{ color: T.textSecondary }}>Label independente de Manchester que levou hoodies e camisetas a territorio de luxo global. Fabricacao europeia, storytelling cultural (rock, motorsport, heritage britanico). VIP membership com exclusividade. Prova que streetwear pode ser premium sem ser pretensioso.</p>
                <p className="text-xs mt-3" style={{ color: T.textMuted }}>Estetica: Oversized tailored, graficos vintage, algodao pesado, ponte entre high fashion e street.</p>
              </Card>
              <Card>
                <div className="flex items-baseline justify-between mb-3">
                  <p className="text-xl font-bold" style={{ fontFamily: "'Kanit', sans-serif" }}>THE COUTURE CLUB</p>
                  <span className="text-xs" style={{ color: T.textMuted }}>@THECOUTURECLUB</span>
                </div>
                <Badge variant="dark">Luxury Streetwear</Badge>
                <p className="text-sm mt-3" style={{ color: T.textSecondary }}>Manchester. &ldquo;Designer quality at accessible prices.&rdquo; Streetwear urbano com toques de alfaiataria. Presente na Selfridges. Mostra como parecer caro sem cobrar caro — cues de luxo (tecido, design in-house, retail premium) com preco acessivel.</p>
                <p className="text-xs mt-3" style={{ color: T.textMuted }}>Estetica: Contemporanea, detalhes bordados, silhuetas tailored, gym to nightlife.</p>
              </Card>
            </div>

            {/* Collabs */}
            <h3 className="text-lg font-semibold mb-6" style={{ fontFamily: "'Kanit', sans-serif" }}>Collabs & Comunicacao</h3>
            <div className="grid md:grid-cols-1 gap-4">
              <Card>
                <div className="flex items-baseline justify-between mb-3">
                  <p className="text-xl font-bold" style={{ fontFamily: "'Kanit', sans-serif" }}>KITH</p>
                  <span className="text-xs" style={{ color: T.textMuted }}>@KITH</span>
                </div>
                <Badge variant="dark">Collabs e Comunicacao</Badge>
                <p className="text-sm mt-3" style={{ color: T.textSecondary }}>NYC. Transcendeu streetwear pra se tornar plataforma cultural de luxo. Ronnie Fieg diz nao pra maioria das collabs — cada uma e momento cultural, nao co-branding. Parceiros: Nike, Versace, Armani, Coca-Cola. Lojas projetadas pela Snarkitecture funcionam como instalacoes. Licao: menos collabs, melhores collabs, com narrativa real.</p>
                <p className="text-xs mt-3" style={{ color: T.textMuted }}>Estetica: Minimalismo luxuoso. Tons terrosos, ausencia de logos altos. &ldquo;Voce ja sabe&rdquo; — confianca silenciosa.</p>
              </Card>
            </div>
          </section>

        </main>

        {/* FOOTER */}
        <footer className="py-24 text-center" style={{ borderTop: `1px solid ${T.border}` }}>
          <p className="text-3xl md:text-5xl font-bold mb-4" style={{ fontFamily: "'Kanit', sans-serif" }}>Respect the Hustle.</p>
          <p className="text-sm mb-1" style={{ color: T.textMuted }}>www.bulking.com.br &middot; @bulkingoficial</p>
          <p className="text-xs" style={{ color: T.textMuted }}>BULKING — Manual da Marca v2.1 — Marco 2026</p>
        </footer>

        {/* Scroll to top */}
        {showTop && (
          <button onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })} className="fixed bottom-6 right-6 z-50 w-10 h-10 rounded-full flex items-center justify-center transition-transform hover:scale-110 print:hidden" style={{ backgroundColor: T.textPrimary, color: T.bg }}>
            <ChevronUp className="w-5 h-5" />
          </button>
        )}
      </div>

      <style jsx global>{`@media print { nav, .fixed, button { display: none !important; } * { color: #000 !important; background: #fff !important; border-color: #ccc !important; } section { page-break-inside: avoid; } }`}</style>
    </>
  );
}
