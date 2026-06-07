"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { Star, Loader2, ImagePlus, Check, X, ChevronLeft } from "lucide-react";

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
  media: MediaItem[];
  adsConsent: boolean;
}

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
          className="transition-transform hover:scale-110"
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
  // exemplo e configs reais, sem gravar nada. O ?ws é lido do window em runtime
  // (client-only) pra evitar exigir Suspense com useSearchParams.
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

  // Quiz por etapas: 0 = abertura; 1..N = produtos; N+1 = loja (se habilitado).
  const [step, setStep] = useState(0);
  const [name, setName] = useState("");
  const [answers, setAnswers] = useState<ProductAnswer[]>([]);
  const [storeRating, setStoreRating] = useState(0);
  const [storeComment, setStoreComment] = useState("");
  const [uploading, setUploading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    if (!token) return;
    try {
      const res = await fetch(`/api/reviews/request/${token}${apiQs()}`);
      if (res.status === 404) { setNotFound(true); return; }
      const d: RequestData = await res.json();
      setData(d);
      if (d.customer_name) setName(d.customer_name);
      setAnswers((d.products || []).map(() => ({ rating: 0, body: "", fields: {}, media: [], adsConsent: false })));
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
  const hasStore = !!data?.collect_store_review;
  // índice de etapas: 0 intro, 1..P produtos, depois loja.
  const storeStep = hasStore ? products.length + 1 : -1;
  const lastStep = hasStore ? products.length + 1 : products.length;
  const isProductStep = step >= 1 && step <= products.length;
  const productIdx = step - 1;

  const updateAnswer = (i: number, patch: Partial<ProductAnswer>) =>
    setAnswers((prev) => prev.map((a, idx) => (idx === i ? { ...a, ...patch } : a)));

  async function handleFiles(files: FileList | null, i: number) {
    if (!files || !files.length || !token) return;
    const current = answers[i]?.media || [];
    // Na pré-visualização não há upload real — mostra o arquivo localmente.
    if (isPreview) {
      const add: MediaItem[] = Array.from(files).slice(0, 8 - current.length).map((file) => ({
        url: URL.createObjectURL(file),
        type: file.type.startsWith("video") ? "video" : "image",
      }));
      updateAnswer(i, { media: [...current, ...add] });
      if (fileRef.current) fileRef.current.value = "";
      return;
    }
    setUploading(true);
    setError(null);
    try {
      const added: MediaItem[] = [];
      for (const file of Array.from(files).slice(0, 8 - current.length)) {
        const presign = await fetch(`/api/reviews/request/${token}/upload-url`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ filename: file.name, content_type: file.type }),
        }).then((r) => r.json());
        if (!presign.upload_url) throw new Error(presign.error || "Falha no upload");
        const put = await fetch(presign.upload_url, { method: "PUT", headers: { "Content-Type": file.type }, body: file });
        if (!put.ok) throw new Error("Falha ao enviar arquivo");
        added.push({ url: presign.public_url, type: presign.type });
      }
      updateAnswer(i, { media: [...current, ...added] });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro no upload");
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  function goNext() {
    setError(null);
    // Validação suave: avaliação pela metade trava; produto vazio = pular.
    if (isProductStep) {
      const a = answers[productIdx];
      if (a?.rating && !a.body.trim()) { setError("Escreva uma frase pra completar — ou toque em “Pular este produto”."); return; }
      if (a?.body.trim() && !a.rating) { setError("Dê uma nota — ou toque em “Pular este produto”."); return; }
    }
    setStep((s) => Math.min(s + 1, lastStep));
  }
  function goBack() { setError(null); setStep((s) => Math.max(0, s - 1)); }
  function skipProduct() {
    setError(null);
    updateAnswer(productIdx, { rating: 0, body: "", media: [], adsConsent: false });
    setStep((s) => Math.min(s + 1, lastStep));
  }

  async function submit() {
    if (!token || !data) return;
    const reviews = products
      .map((p, i) => ({
        product_id: p.id,
        rating: answers[i]?.rating || 0,
        body: answers[i]?.body || "",
        media: answers[i]?.media || [],
        ads_consent: answers[i]?.adsConsent || false,
        custom_fields: (data.form_fields || [])
          .filter((f) => answers[i]?.fields?.[f.key])
          .map((f) => ({ name: f.label, values: [answers[i].fields[f.key]] })),
      }))
      .filter((r) => r.rating && r.body.trim());

    if (reviews.length === 0) { setError("Avalie ao menos um produto."); return; }

    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/reviews/request/${token}${apiQs()}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          reviews,
          author_name: name,
          store_rating: storeRating,
          store_comment: storeComment,
        }),
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

  const totalSteps = lastStep; // nº de etapas além da abertura
  const bonusNote = data?.rewards ? (
    <div className="rounded-xl bg-amber-100 border border-amber-300 p-3 text-[13px] text-amber-900">
      <p className="font-semibold">🎁 Tem um cashback surpresa pra você!</p>
      <p className="text-amber-900">Avalie com <b>foto</b> ou <b>vídeo</b> e descubra quanto ganha — liberado quando sua avaliação for confirmada.</p>
    </div>
  ) : null;

  return (
    <div className="min-h-screen bg-neutral-50 flex items-start sm:items-center justify-center p-4 sm:py-12">
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
                  <button type="button" onClick={goBack} className="flex items-center gap-1 hover:text-neutral-700">
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
            {step === 0 && (
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
                    className="w-full rounded-xl border border-neutral-200 px-4 py-3 text-[15px] focus:outline-none focus:ring-2 focus:ring-neutral-900/10"
                  />
                </div>
                <button
                  type="button"
                  onClick={() => setStep(1)}
                  className="w-full bg-neutral-900 text-white rounded-full py-3.5 font-semibold text-[15px] hover:bg-neutral-800 transition-colors"
                >
                  Começar
                </button>
              </div>
            )}

            {/* ETAPAS DE PRODUTO */}
            {isProductStep && products[productIdx] && (
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
                  <label className="block text-sm font-semibold text-neutral-700 mb-1.5">Sua avaliação</label>
                  <textarea
                    value={answers[productIdx]?.body || ""}
                    onChange={(e) => updateAnswer(productIdx, { body: e.target.value })}
                    maxLength={4000}
                    rows={4}
                    placeholder="O que você gostou? Como serviu? Recomendaria?"
                    className="w-full rounded-xl border border-neutral-200 px-4 py-3 text-[15px] resize-none focus:outline-none focus:ring-2 focus:ring-neutral-900/10"
                  />
                </div>

                {/* Campos estruturados */}
                {data?.form_fields && data.form_fields.length > 0 && (
                  <div className="rounded-2xl border border-neutral-200 p-4">
                    <p className="text-sm font-semibold text-neutral-800 mb-0.5">Ajude quem vai comprar</p>
                    <p className="text-xs text-neutral-500 mb-3">Suas medidas e perfil aparecem na avaliação (opcional).</p>
                    <div className="grid grid-cols-2 gap-3">
                      {data.form_fields.map((f) => (
                        <div key={f.key}>
                          <label className="block text-[12px] font-medium text-neutral-600 mb-1">{f.label}</label>
                          {f.type === "select" ? (
                            <select
                              value={answers[productIdx]?.fields?.[f.key] || ""}
                              onChange={(e) => updateAnswer(productIdx, { fields: { ...answers[productIdx].fields, [f.key]: e.target.value } })}
                              className="w-full rounded-xl border border-neutral-200 px-3 py-2.5 text-[14px] bg-white focus:outline-none focus:ring-2 focus:ring-neutral-900/10"
                            >
                              <option value="">—</option>
                              {f.options.map((o) => <option key={o} value={o}>{o}</option>)}
                            </select>
                          ) : (
                            <input
                              value={answers[productIdx]?.fields?.[f.key] || ""}
                              onChange={(e) => updateAnswer(productIdx, { fields: { ...answers[productIdx].fields, [f.key]: e.target.value } })}
                              className="w-full rounded-xl border border-neutral-200 px-3 py-2.5 text-[14px] focus:outline-none focus:ring-2 focus:ring-neutral-900/10"
                            />
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Mídia + aviso de bônus */}
                {data?.ask_media && (
                  <div>
                    <label className="block text-sm font-semibold text-neutral-700 mb-1.5">Fotos e vídeos (opcional)</label>
                    {bonusNote && <div className="mb-2">{bonusNote}</div>}
                    <div className="flex flex-wrap gap-2">
                      {(answers[productIdx]?.media || []).map((m, mi) => (
                        <div key={mi} className="relative h-20 w-20 rounded-xl overflow-hidden border border-neutral-200">
                          {m.type === "video" ? (
                            <video src={m.url} className="h-full w-full object-cover" />
                          ) : (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={m.url} alt="" className="h-full w-full object-cover" />
                          )}
                          <button
                            type="button"
                            onClick={() => updateAnswer(productIdx, { media: answers[productIdx].media.filter((_, idx) => idx !== mi) })}
                            className="absolute top-1 right-1 h-5 w-5 rounded-full bg-black/60 text-white flex items-center justify-center"
                          >
                            <X className="h-3 w-3" />
                          </button>
                        </div>
                      ))}
                      {(answers[productIdx]?.media || []).length < 8 && (
                        <button
                          type="button"
                          onClick={() => fileRef.current?.click()}
                          disabled={uploading}
                          className="h-20 w-20 rounded-xl border-2 border-dashed border-neutral-300 flex items-center justify-center text-neutral-400 hover:border-neutral-400"
                        >
                          {uploading ? <Loader2 className="h-5 w-5 animate-spin" /> : <ImagePlus className="h-6 w-6" />}
                        </button>
                      )}
                    </div>
                    <input
                      ref={fileRef}
                      type="file"
                      accept="image/*,video/*"
                      multiple
                      className="hidden"
                      onChange={(e) => handleFiles(e.target.files, productIdx)}
                    />
                    {/* Consentimento de ADS — só quando há vídeo */}
                    {data?.ads_enabled && (answers[productIdx]?.media || []).some((m) => m.type === "video") && (
                      <label className="mt-3 flex items-start gap-2 text-[13px] text-neutral-600 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={answers[productIdx]?.adsConsent || false}
                          onChange={(e) => updateAnswer(productIdx, { adsConsent: e.target.checked })}
                          className="mt-0.5 h-4 w-4"
                        />
                        <span>
                          Autorizo a marca a usar meu vídeo em anúncios e redes sociais.
                          {data?.rewards ? " Se a gente selecionar seu vídeo, seu cashback pode ser ainda maior 🎬" : ""}
                        </span>
                      </label>
                    )}
                  </div>
                )}

                {error && <p className="text-sm text-red-600 text-center">{error}</p>}

                {step === lastStep ? (
                  <button
                    type="button"
                    onClick={() => submit()}
                    disabled={submitting}
                    className="w-full bg-neutral-900 text-white rounded-full py-3.5 font-semibold text-[15px] hover:bg-neutral-800 disabled:opacity-50 transition-colors flex items-center justify-center gap-2"
                  >
                    {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
                    Enviar avaliação
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={goNext}
                    className="w-full bg-neutral-900 text-white rounded-full py-3.5 font-semibold text-[15px] hover:bg-neutral-800 transition-colors"
                  >
                    Continuar
                  </button>
                )}
                {products.length > 1 && step < lastStep && (
                  <button type="button" onClick={skipProduct} className="w-full text-center text-[13px] text-neutral-400 hover:text-neutral-600">
                    Pular este produto
                  </button>
                )}
                {step === lastStep && (
                  <p className="text-center text-xs text-neutral-400">Seu nome poderá aparecer publicamente. Seu contato não será publicado.</p>
                )}
              </div>
            )}

            {/* ETAPA DA LOJA */}
            {hasStore && step === storeStep && (
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
                  className="w-full rounded-xl border border-neutral-200 px-4 py-3 text-[14px] resize-none focus:outline-none focus:ring-2 focus:ring-neutral-900/10"
                />
                {error && <p className="text-sm text-red-600 text-center">{error}</p>}
                <button
                  type="button"
                  onClick={submit}
                  disabled={submitting}
                  className="w-full bg-neutral-900 text-white rounded-full py-3.5 font-semibold text-[15px] hover:bg-neutral-800 disabled:opacity-50 transition-colors flex items-center justify-center gap-2"
                >
                  {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
                  Enviar avaliação
                </button>
                <p className="text-center text-xs text-neutral-400">Seu nome poderá aparecer publicamente. Seu contato não será publicado.</p>
              </div>
            )}

          </>
        )}
      </div>
    </div>
  );
}
