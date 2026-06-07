"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { Star, Loader2, ImagePlus, Check, X, ChevronLeft, Video } from "lucide-react";

interface FormField {
  key: string;
  label: string;
  type: "select" | "text";
  options: string[];
}
interface ProductInfo {
  id: string | null;
  name: string | null;
  image: string | null;
  url: string | null;
}
interface RequestData {
  already_completed: boolean;
  customer_name: string | null;
  product: ProductInfo;
  products: ProductInfo[];
  ask_media: boolean;
  ads_enabled: boolean;
  collect_store_review: boolean;
  form_fields: FormField[];
  accent_color: string;
  star_color: string;
  rewards: { photo: number; video: number; video_ads: number } | null;
}

interface MediaItem {
  url: string;
  type: "image" | "video";
}

interface ProductAnswer {
  rating: number;
  body: string;
  fields: Record<string, string>;
  media: MediaItem[]; // fotos do produto
}

type StepDesc = { kind: "intro" } | { kind: "product"; idx: number } | { kind: "video" } | { kind: "store" };

function StarsInput({ value, onChange, color, size = 36 }: { value: number; onChange: (n: number) => void; color: string; size?: number }) {
  const [hover, setHover] = useState(0);
  return (
    <div className="flex justify-center gap-1.5">
      {[1, 2, 3, 4, 5].map((i) => (
        <button
          key={i}
          type="button"
          onMouseEnter={() => setHover(i)}
          onMouseLeave={() => setHover(0)}
          onClick={() => onChange(i)}
          className="transition-transform hover:scale-110 active:scale-95 p-1"
          aria-label={`${i} estrelas`}
        >
          <Star
            style={{
              width: size,
              height: size,
              fill: i <= (hover || value) ? color : "transparent",
              color: i <= (hover || value) ? color : "#d4d4d8",
            }}
          />
        </button>
      ))}
    </div>
  );
}

export default function AvaliarPage() {
  const params = useParams<{ token: string }>();
  const token = params?.token;
  // Modo pré-visualização: /avaliar/preview?ws=<id> — renderiza com dados de
  // exemplo e configs reais, sem gravar nada. O ?ws é lido do window em runtime.
  const isPreview = token === "preview";
  const apiQs = useCallback(() => {
    if (!isPreview || typeof window === "undefined") return "";
    const ws = new URLSearchParams(window.location.search).get("ws");
    return ws ? `?ws=${encodeURIComponent(ws)}` : "";
  }, [isPreview]);

  const [data, setData] = useState<RequestData | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [done, setDone] = useState<null | { moderated: boolean; reward?: { amount: number; ads_max: number | null } | null }>(null);

  const [step, setStep] = useState(0);
  const [name, setName] = useState("");
  const [answers, setAnswers] = useState<ProductAnswer[]>([]);
  // Perfil do cliente (tamanho, idade, altura…). Preenchido uma vez e sugerido
  // automaticamente nos próximos produtos — ele só precisa dar as estrelas.
  const [profileFields, setProfileFields] = useState<Record<string, string>>({});
  // Vídeo (um por pedido) — etapa exclusiva, vira material de anúncio.
  const [videoMedia, setVideoMedia] = useState<MediaItem[]>([]);
  const [videoAdsConsent, setVideoAdsConsent] = useState(true);
  const [videoUploading, setVideoUploading] = useState(false);
  const [storeRating, setStoreRating] = useState(0);
  const [storeComment, setStoreComment] = useState("");
  const [uploading, setUploading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const photoRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    if (!token) return;
    try {
      const res = await fetch(`/api/reviews/request/${token}${apiQs()}`);
      if (res.status === 404) { setNotFound(true); return; }
      const d: RequestData = await res.json();
      setData(d);
      if (d.customer_name) setName(d.customer_name);
      setAnswers((d.products || []).map(() => ({ rating: 0, body: "", fields: {}, media: [] })));
      if (d.already_completed) setDone({ moderated: false });
    } catch {
      setNotFound(true);
    } finally {
      setLoading(false);
    }
  }, [token, apiQs]);

  useEffect(() => { load(); }, [load]);

  const accent = data?.star_color || data?.accent_color || "#e6b800";
  const products = data?.products || [];
  const askMedia = !!data?.ask_media;
  const hasStore = !!data?.collect_store_review;

  // Etapas: abertura → 1 por produto → vídeo (se mídia) → loja (se habilitado).
  const stepList: StepDesc[] = [{ kind: "intro" }];
  products.forEach((_, i) => stepList.push({ kind: "product", idx: i }));
  if (askMedia) stepList.push({ kind: "video" });
  if (hasStore) stepList.push({ kind: "store" });
  const lastStep = stepList.length - 1;
  const totalSteps = stepList.length - 1; // exclui a abertura
  const current = stepList[Math.min(step, lastStep)] || stepList[0];
  const productIdx = current.kind === "product" ? current.idx : 0;

  const updateAnswer = (i: number, patch: Partial<ProductAnswer>) =>
    setAnswers((prev) => prev.map((a, idx) => (idx === i ? { ...a, ...patch } : a)));

  // Define um campo do produto atual E memoriza no perfil (sugestão p/ os próximos).
  const setField = (i: number, key: string, value: string) => {
    setAnswers((prev) => prev.map((a, idx) => (idx === i ? { ...a, fields: { ...a.fields, [key]: value } } : a)));
    setProfileFields((p) => ({ ...p, [key]: value }));
  };
  const fieldValue = (i: number, key: string) => answers[i]?.fields?.[key] ?? profileFields[key] ?? "";

  // Upload genérico (foto ou vídeo). Em preview usa URL local.
  const uploadFiles = useCallback(async (files: FileList, maxAdd: number): Promise<MediaItem[]> => {
    const out: MediaItem[] = [];
    const list = Array.from(files).slice(0, Math.max(0, maxAdd));
    if (isPreview) {
      for (const file of list) out.push({ url: URL.createObjectURL(file), type: file.type.startsWith("video") ? "video" : "image" });
      return out;
    }
    for (const file of list) {
      const presign = await fetch(`/api/reviews/request/${token}/upload-url`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filename: file.name, content_type: file.type }),
      }).then((r) => r.json());
      if (!presign.upload_url) throw new Error(presign.error || "Falha no upload");
      const put = await fetch(presign.upload_url, { method: "PUT", headers: { "Content-Type": file.type }, body: file });
      if (!put.ok) throw new Error("Falha ao enviar arquivo");
      out.push({ url: presign.public_url, type: presign.type });
    }
    return out;
  }, [isPreview, token]);

  async function handlePhotoFiles(files: FileList | null, i: number) {
    if (!files || !files.length || !token) return;
    const currentMedia = answers[i]?.media || [];
    setUploading(true);
    setError(null);
    try {
      const added = (await uploadFiles(files, 6 - currentMedia.length)).filter((m) => m.type === "image");
      updateAnswer(i, { media: [...currentMedia, ...added] });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro no upload");
    } finally {
      setUploading(false);
      if (photoRef.current) photoRef.current.value = "";
    }
  }

  async function handleVideoFiles(files: FileList | null) {
    if (!files || !files.length || !token) return;
    setVideoUploading(true);
    setError(null);
    try {
      const added = (await uploadFiles(files, 1)).filter((m) => m.type === "video");
      if (added.length) setVideoMedia(added.slice(0, 1));
      else setError("Selecione um arquivo de vídeo.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro no upload");
    } finally {
      setVideoUploading(false);
      if (videoRef.current) videoRef.current.value = "";
    }
  }

  function goNext() {
    setError(null);
    if (current.kind === "product") {
      const a = answers[productIdx];
      if (!a?.rating) { setError("Toque nas estrelas pra avaliar este produto 🙂"); return; }
    }
    setStep((s) => Math.min(s + 1, lastStep));
  }
  function goBack() { setError(null); setStep((s) => Math.max(0, s - 1)); }

  async function submit() {
    if (!token || !data) return;
    const reviews = products
      .map((p, i) => ({
        product_id: p.id,
        rating: answers[i]?.rating || 0,
        body: answers[i]?.body || "",
        media: (answers[i]?.media || []) as MediaItem[],
        ads_consent: false,
        custom_fields: (data.form_fields || [])
          .map((f) => ({ f, v: fieldValue(i, f.key) }))
          .filter(({ v }) => v)
          .map(({ f, v }) => ({ name: f.label, values: [v] })),
      }))
      .filter((r) => r.rating); // texto é opcional — basta a nota

    if (reviews.length === 0) { setError("Dê as estrelas pra avaliar."); return; }

    // O vídeo (um por pedido) é anexado à 1ª avaliação — é o material de anúncio.
    if (videoMedia.length) {
      reviews[0] = { ...reviews[0], media: [...reviews[0].media, ...videoMedia], ads_consent: videoAdsConsent };
    }

    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/reviews/request/${token}${apiQs()}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reviews, author_name: name, store_rating: storeRating, store_comment: storeComment }),
      });
      const d = await res.json();
      if (d.ok) setDone({ moderated: !!d.moderated, reward: d.reward || null });
      else setError(d.error || "Não foi possível enviar.");
    } catch {
      setError("Erro de conexão.");
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-neutral-50">
        <Loader2 className="h-6 w-6 animate-spin text-neutral-400" />
      </div>
    );
  }

  if (notFound) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-neutral-50 p-4">
        <div className="text-center text-neutral-500">
          <p className="text-lg font-medium">Link não encontrado</p>
          <p className="text-sm mt-1">Este convite de avaliação não é válido ou expirou.</p>
        </div>
      </div>
    );
  }

  const bonusNote = data?.rewards ? (
    <div className="rounded-xl bg-amber-100 border border-amber-300 p-3 text-[13px] text-amber-900">
      <p className="font-semibold">🎁 Tem um cashback surpresa pra você!</p>
      <p className="text-amber-900">Avalie com <b>foto</b> e principalmente <b>vídeo</b> e descubra quanto ganha — liberado quando sua avaliação for confirmada.</p>
    </div>
  ) : null;

  const primaryLabel = step === lastStep ? "Enviar avaliação" : "Continuar";

  return (
    <div className="min-h-screen bg-neutral-50 text-neutral-900 [color-scheme:light] flex items-start sm:items-center justify-center p-4 sm:py-12">
      <div className="w-full max-w-lg bg-white rounded-3xl shadow-sm border border-neutral-100 p-6 sm:p-9">
        {isPreview && (
          <div className="mb-5 rounded-xl bg-neutral-900 text-white text-center text-[13px] font-medium px-4 py-2.5">
            👁️ Pré-visualização — nada é enviado. É assim que o cliente vê a página.
          </div>
        )}

        {done ? (
          <div className="text-center py-8">
            <div className="mx-auto mb-4 h-14 w-14 rounded-full bg-green-50 flex items-center justify-center">
              <Check className="h-7 w-7 text-green-500" />
            </div>
            <h1 className="text-2xl font-bold text-neutral-900">Obrigado! 💛</h1>
            <p className="text-neutral-500 mt-2">
              {done.moderated
                ? "Sua avaliação foi enviada e será publicada após revisão."
                : "Sua avaliação foi publicada. Você ajuda muita gente!"}
            </p>
            {done.reward && (
              <div className="mt-4 rounded-2xl bg-amber-100 border border-amber-300 p-4">
                <p className="text-lg font-bold text-amber-900">🎁 Você ganhou R$ {done.reward.amount} de cashback!</p>
                <p className="text-[13px] text-amber-900 mt-0.5">
                  Será creditado na sua carteira assim que sua avaliação for aprovada.
                  {done.reward.ads_max ? ` E pode chegar a R$ ${done.reward.ads_max} se a gente selecionar seu vídeo para anúncios! 🎬` : ""}
                </p>
              </div>
            )}
          </div>
        ) : (
          <>
            {/* Progresso */}
            {step > 0 && (
              <div className="mb-5">
                <div className="flex items-center justify-between text-xs text-neutral-400 mb-1.5">
                  <button type="button" onClick={goBack} className="flex items-center gap-1 hover:text-neutral-700 -ml-1 p-1">
                    <ChevronLeft className="h-4 w-4" /> Voltar
                  </button>
                  <span>Etapa {step} de {totalSteps}</span>
                </div>
                <div className="h-1.5 w-full bg-neutral-100 rounded-full overflow-hidden">
                  <div className="h-full rounded-full transition-all" style={{ width: `${(step / totalSteps) * 100}%`, background: accent }} />
                </div>
              </div>
            )}

            {/* ETAPA 0 — Abertura */}
            {current.kind === "intro" && (
              <div className="space-y-5 text-center">
                <h1 className="text-2xl font-bold text-neutral-900 leading-tight">
                  {name ? `${name.split(" ")[0]}, bora avaliar?` : "Bora avaliar?"}
                </h1>
                <p className="text-neutral-500 text-sm">
                  {products.length > 1
                    ? `Você comprou ${products.length} itens. Vamos avaliar um por um — leva 1 minutinho e ajuda muita gente a comprar com confiança.`
                    : "Conta rapidinho o que você achou — leva 1 minutinho e ajuda muita gente a comprar com confiança."}
                </p>
                {bonusNote}
                <div className="text-left">
                  <label className="block text-sm font-semibold text-neutral-700 mb-1.5">Seu nome</label>
                  <input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    maxLength={120}
                    placeholder="Como quer aparecer"
                    className="w-full rounded-xl border border-neutral-200 bg-white text-neutral-900 placeholder:text-neutral-400 px-4 py-3 text-[15px] focus:outline-none focus:ring-2 focus:ring-neutral-900/10"
                  />
                </div>
                <button
                  type="button"
                  onClick={() => setStep(1)}
                  className="w-full bg-neutral-900 text-white rounded-full py-4 sm:py-3.5 font-semibold text-[15px] hover:bg-neutral-800 transition-colors"
                >
                  Começar
                </button>
              </div>
            )}

            {/* ETAPAS DE PRODUTO */}
            {current.kind === "product" && products[productIdx] && (
              <div className="space-y-4">
                {products[productIdx].image && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={products[productIdx].image!} alt="" className="mx-auto h-24 w-24 object-cover rounded-2xl border border-neutral-100" />
                )}
                <h2 className="text-xl font-bold text-neutral-900 text-center leading-tight">
                  {products[productIdx].name || "O que você achou?"}
                </h2>

                <div className="py-1"><StarsInput value={answers[productIdx]?.rating || 0} onChange={(n) => updateAnswer(productIdx, { rating: n })} color={accent} /></div>

                <div>
                  <label className="block text-sm font-semibold text-neutral-700 mb-1.5">Sua avaliação <span className="font-normal text-neutral-400">(opcional)</span></label>
                  <textarea
                    value={answers[productIdx]?.body || ""}
                    onChange={(e) => updateAnswer(productIdx, { body: e.target.value })}
                    maxLength={4000}
                    rows={4}
                    placeholder="O que você gostou? Como serviu? Recomendaria?"
                    className="w-full rounded-xl border border-neutral-200 bg-white text-neutral-900 placeholder:text-neutral-400 px-4 py-3 text-[15px] resize-none focus:outline-none focus:ring-2 focus:ring-neutral-900/10"
                  />
                </div>

                {/* Campos estruturados */}
                {data?.form_fields && data.form_fields.length > 0 && (
                  <div className="rounded-2xl border border-neutral-200 p-4">
                    <p className="text-sm font-semibold text-neutral-800 mb-0.5">Ajude quem vai comprar</p>
                    <p className="text-xs text-neutral-500 mb-3">
                      {productIdx > 0
                        ? "Já preenchemos com o seu perfil — ajuste se for diferente neste produto."
                        : "Suas medidas e perfil aparecem na avaliação (opcional)."}
                    </p>
                    <div className="grid grid-cols-2 gap-3">
                      {data.form_fields.map((f) => (
                        <div key={f.key}>
                          <label className="block text-[12px] font-medium text-neutral-600 mb-1">{f.label}</label>
                          {f.type === "select" ? (
                            <select
                              value={fieldValue(productIdx, f.key)}
                              onChange={(e) => setField(productIdx, f.key, e.target.value)}
                              className="w-full rounded-xl border border-neutral-200 bg-white text-neutral-900 placeholder:text-neutral-400 px-3 py-2.5 text-[14px] focus:outline-none focus:ring-2 focus:ring-neutral-900/10"
                            >
                              <option value="">—</option>
                              {f.options.map((o) => <option key={o} value={o}>{o}</option>)}
                            </select>
                          ) : (
                            <input
                              value={fieldValue(productIdx, f.key)}
                              onChange={(e) => setField(productIdx, f.key, e.target.value)}
                              className="w-full rounded-xl border border-neutral-200 bg-white text-neutral-900 placeholder:text-neutral-400 px-3 py-2.5 text-[14px] focus:outline-none focus:ring-2 focus:ring-neutral-900/10"
                            />
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Fotos do produto (opcional) — o vídeo tem etapa própria adiante */}
                {askMedia && (
                  <div>
                    <label className="block text-sm font-semibold text-neutral-700 mb-1.5">Fotos do produto <span className="font-normal text-neutral-400">(opcional)</span></label>
                    <div className="flex flex-wrap gap-2">
                      {(answers[productIdx]?.media || []).map((m, mi) => (
                        <div key={mi} className="relative h-20 w-20 rounded-xl overflow-hidden border border-neutral-200">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={m.url} alt="" className="h-full w-full object-cover" />
                          <button
                            type="button"
                            onClick={() => updateAnswer(productIdx, { media: answers[productIdx].media.filter((_, idx) => idx !== mi) })}
                            className="absolute top-1 right-1 h-5 w-5 rounded-full bg-black/60 text-white flex items-center justify-center"
                          >
                            <X className="h-3 w-3" />
                          </button>
                        </div>
                      ))}
                      {(answers[productIdx]?.media || []).length < 6 && (
                        <button
                          type="button"
                          onClick={() => photoRef.current?.click()}
                          disabled={uploading}
                          className="h-20 w-20 rounded-xl border-2 border-dashed border-neutral-300 flex items-center justify-center text-neutral-400 hover:border-neutral-400"
                        >
                          {uploading ? <Loader2 className="h-5 w-5 animate-spin" /> : <ImagePlus className="h-6 w-6" />}
                        </button>
                      )}
                    </div>
                    <input ref={photoRef} type="file" accept="image/*" multiple className="hidden" onChange={(e) => handlePhotoFiles(e.target.files, productIdx)} />
                  </div>
                )}
              </div>
            )}

            {/* ETAPA EXCLUSIVA — VÍDEO (vira anúncio) */}
            {current.kind === "video" && (
              <div className="space-y-4">
                <div className="text-center space-y-1.5">
                  <div className="mx-auto h-12 w-12 rounded-2xl bg-neutral-900 text-white flex items-center justify-center">
                    <Video className="h-6 w-6" />
                  </div>
                  <h2 className="text-xl font-bold text-neutral-900 leading-tight">Grave um vídeo e ganhe mais 🎬</h2>
                  <p className="text-sm text-neutral-500">
                    Os melhores vídeos viram <b>propaganda da marca</b> — e rendem o <b>maior cashback</b>. Caprichou? Pode aparecer pra todo mundo.
                  </p>
                </div>

                {/* Dicas pra um vídeo bem feito */}
                <div className="rounded-2xl border border-neutral-200 p-4">
                  <p className="text-sm font-semibold text-neutral-800 mb-2">Como gravar um vídeo top</p>
                  <ul className="space-y-1.5 text-[13px] text-neutral-600">
                    <li className="flex gap-2"><span>💡</span> Local <b>bem iluminado</b> (luz natural cai super bem)</li>
                    <li className="flex gap-2"><span>🧹</span> Fundo <b>arrumado e limpo</b>, sem bagunça</li>
                    <li className="flex gap-2"><span>🔍</span> Mostre os <b>detalhes</b>: tecido, caimento, costura, estampa</li>
                    <li className="flex gap-2"><span>🏋️</span> <b>Vista e use</b> a peça — conte como serviu no seu corpo</li>
                    <li className="flex gap-2"><span>📱</span> Grave <b>na vertical</b>, de 15 a 40 segundos</li>
                  </ul>
                </div>

                {videoMedia.length > 0 ? (
                  <div className="relative rounded-2xl overflow-hidden border border-neutral-200 bg-black">
                    <video src={videoMedia[0].url} controls className="w-full max-h-72 object-contain bg-black" />
                    <button
                      type="button"
                      onClick={() => setVideoMedia([])}
                      className="absolute top-2 right-2 h-7 w-7 rounded-full bg-black/60 text-white flex items-center justify-center"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => videoRef.current?.click()}
                    disabled={videoUploading}
                    className="w-full rounded-2xl border-2 border-dashed border-neutral-300 py-7 flex flex-col items-center justify-center gap-2 text-neutral-500 hover:border-neutral-900 hover:text-neutral-900 transition-colors"
                  >
                    {videoUploading ? <Loader2 className="h-7 w-7 animate-spin" /> : <Video className="h-7 w-7" />}
                    <span className="text-sm font-medium">{videoUploading ? "Enviando…" : "Gravar / enviar vídeo"}</span>
                  </button>
                )}
                <input ref={videoRef} type="file" accept="video/*" capture="environment" className="hidden" onChange={(e) => handleVideoFiles(e.target.files)} />

                {/* Consentimento de ADS — quando há vídeo */}
                {data?.ads_enabled && videoMedia.length > 0 && (
                  <label className="flex items-start gap-2 text-[13px] text-neutral-600 cursor-pointer">
                    <input type="checkbox" checked={videoAdsConsent} onChange={(e) => setVideoAdsConsent(e.target.checked)} className="mt-0.5 h-4 w-4" />
                    <span>
                      Autorizo a marca a usar meu vídeo em anúncios e redes sociais.
                      {data?.rewards ? " Se a gente selecionar seu vídeo, seu cashback é o maior de todos 🎬" : ""}
                    </span>
                  </label>
                )}

                {data?.rewards && (
                  <div className="rounded-xl bg-amber-100 border border-amber-300 p-3 text-[13px] text-amber-900">
                    <p className="font-semibold">O vídeo rende o maior cashback 💛</p>
                    <p className="text-amber-900">Vídeo &gt; foto. E se ele virar anúncio, o cashback é o máximo. É opcional, mas super recomendado!</p>
                  </div>
                )}
              </div>
            )}

            {/* ETAPA DA LOJA */}
            {current.kind === "store" && (
              <div className="space-y-4">
                <h2 className="text-xl font-bold text-neutral-900 text-center leading-tight">E a experiência com a loja?</h2>
                <p className="text-center text-sm text-neutral-500">Entrega, prazo, atendimento, embalagem.</p>
                <div className="py-1"><StarsInput value={storeRating} onChange={setStoreRating} color={accent} size={32} /></div>
                <textarea
                  value={storeComment}
                  onChange={(e) => setStoreComment(e.target.value)}
                  maxLength={2000}
                  rows={3}
                  placeholder="Como foi comprar com a gente? (opcional)"
                  className="w-full rounded-xl border border-neutral-200 bg-white text-neutral-900 placeholder:text-neutral-400 px-4 py-3 text-[14px] resize-none focus:outline-none focus:ring-2 focus:ring-neutral-900/10"
                />
              </div>
            )}

            {/* Rodapé de ação fixo (mobile-first) — compartilhado pelas etapas */}
            {step > 0 && (
              <div className="sticky bottom-0 z-10 -mx-6 sm:mx-0 px-6 sm:px-0 pt-3 pb-4 sm:pb-0 bg-white border-t border-neutral-100 sm:border-0 space-y-2 mt-4">
                {error && <p className="text-sm text-red-600 text-center">{error}</p>}
                <button
                  type="button"
                  onClick={step === lastStep ? submit : goNext}
                  disabled={submitting}
                  className="w-full bg-neutral-900 text-white rounded-full py-4 sm:py-3.5 font-semibold text-[15px] hover:bg-neutral-800 disabled:opacity-50 transition-colors flex items-center justify-center gap-2"
                >
                  {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
                  {primaryLabel}
                </button>
                {current.kind === "video" && videoMedia.length === 0 && (
                  <p className="text-center text-[12px] text-neutral-400">Sem vídeo agora? Tudo bem, é só continuar — mas é com vídeo que rende mais 💛</p>
                )}
                {step === lastStep && (
                  <p className="text-center text-xs text-neutral-400">Seu nome poderá aparecer publicamente. Seu contato não será publicado.</p>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
