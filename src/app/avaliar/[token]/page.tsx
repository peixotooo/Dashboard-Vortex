"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { Star, Loader2, ImagePlus, Check, X } from "lucide-react";

interface FormField {
  key: string;
  label: string;
  type: "select" | "text";
  options: string[];
}
interface RequestData {
  already_completed: boolean;
  customer_name: string | null;
  product: { id: string | null; name: string | null; image: string | null; url: string | null };
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

export default function AvaliarPage() {
  const params = useParams<{ token: string }>();
  const token = params?.token;

  const [data, setData] = useState<RequestData | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [done, setDone] = useState<null | { moderated: boolean; reward?: { amount: number; ads_max: number | null } | null }>(null);

  const [rating, setRating] = useState(0);
  const [hover, setHover] = useState(0);
  const [storeRating, setStoreRating] = useState(0);
  const [storeHover, setStoreHover] = useState(0);
  const [storeComment, setStoreComment] = useState("");
  const [formAnswers, setFormAnswers] = useState<Record<string, string>>({});
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [name, setName] = useState("");
  const [media, setMedia] = useState<MediaItem[]>([]);
  const [adsConsent, setAdsConsent] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    if (!token) return;
    try {
      const res = await fetch(`/api/reviews/request/${token}`);
      if (res.status === 404) { setNotFound(true); return; }
      const d: RequestData = await res.json();
      setData(d);
      if (d.customer_name) setName(d.customer_name);
      if (d.already_completed) setDone({ moderated: false });
    } catch {
      setNotFound(true);
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => { load(); }, [load]);

  async function handleFiles(files: FileList | null) {
    if (!files || !files.length || !token) return;
    setUploading(true);
    setError(null);
    try {
      for (const file of Array.from(files).slice(0, 8 - media.length)) {
        const presign = await fetch(`/api/reviews/request/${token}/upload-url`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ filename: file.name, content_type: file.type }),
        }).then((r) => r.json());
        if (!presign.upload_url) throw new Error(presign.error || "Falha no upload");
        const put = await fetch(presign.upload_url, { method: "PUT", headers: { "Content-Type": file.type }, body: file });
        if (!put.ok) throw new Error("Falha ao enviar arquivo");
        setMedia((m) => [...m, { url: presign.public_url, type: presign.type }]);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro no upload");
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function submit() {
    if (!token) return;
    if (!rating) { setError("Escolha uma nota."); return; }
    if (!body.trim()) { setError("Escreva sua avaliação."); return; }
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/reviews/request/${token}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          rating, title, body, author_name: name, media, ads_consent: adsConsent,
          store_rating: storeRating, store_comment: storeComment,
          custom_fields: (data?.form_fields || [])
            .filter((f) => formAnswers[f.key])
            .map((f) => ({ name: f.label, values: [formAnswers[f.key]] })),
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

  const accent = data?.star_color || data?.accent_color || "#e6b800";

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

  return (
    <div className="min-h-screen bg-neutral-50 flex items-start sm:items-center justify-center p-4 sm:py-12">
      <div className="w-full max-w-lg bg-white rounded-3xl shadow-sm border border-neutral-100 p-6 sm:p-9">
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
              <div className="mt-4 rounded-2xl bg-amber-50 border border-amber-200 p-4">
                <p className="text-lg font-bold text-amber-900">🎁 Você ganhou R$ {done.reward.amount} de cashback!</p>
                <p className="text-[13px] text-amber-800 mt-0.5">
                  Será creditado na sua carteira assim que sua avaliação for aprovada.
                  {done.reward.ads_max ? ` E pode chegar a R$ ${done.reward.ads_max} se a gente selecionar seu vídeo para anúncios! 🎬` : ""}
                </p>
              </div>
            )}
          </div>
        ) : (
          <>
            {data?.product?.image && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={data.product.image} alt="" className="mx-auto mb-5 h-28 w-28 object-cover rounded-2xl border border-neutral-100" />
            )}
            <h1 className="text-2xl font-bold text-neutral-900 text-center leading-tight">
              {data?.customer_name ? `${data.customer_name}, o que você achou?` : "O que você achou?"}
            </h1>
            {data?.product?.name && (
              <p className="text-center text-neutral-500 mt-1.5 text-sm">{data.product.name}</p>
            )}

            {/* Estrelas */}
            <div className="flex justify-center gap-1.5 my-7">
              {[1, 2, 3, 4, 5].map((i) => (
                <button
                  key={i}
                  type="button"
                  onMouseEnter={() => setHover(i)}
                  onMouseLeave={() => setHover(0)}
                  onClick={() => setRating(i)}
                  className="transition-transform hover:scale-110"
                  aria-label={`${i} estrelas`}
                >
                  <Star
                    className="h-9 w-9"
                    style={{
                      fill: i <= (hover || rating) ? accent : "transparent",
                      color: i <= (hover || rating) ? accent : "#d4d4d8",
                    }}
                  />
                </button>
              ))}
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-semibold text-neutral-700 mb-1.5">Título</label>
                <input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  maxLength={120}
                  placeholder="Resuma sua experiência"
                  className="w-full rounded-xl border border-neutral-200 px-4 py-3 text-[15px] focus:outline-none focus:ring-2 focus:ring-neutral-900/10"
                />
              </div>
              <div>
                <label className="block text-sm font-semibold text-neutral-700 mb-1.5">Sua avaliação</label>
                <textarea
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  maxLength={4000}
                  rows={4}
                  placeholder="O que você gostou? Como serviu? Recomendaria?"
                  className="w-full rounded-xl border border-neutral-200 px-4 py-3 text-[15px] resize-none focus:outline-none focus:ring-2 focus:ring-neutral-900/10"
                />
              </div>

              {/* Campos estruturados — ajudam outros clientes a decidir */}
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
                            value={formAnswers[f.key] || ""}
                            onChange={(e) => setFormAnswers((a) => ({ ...a, [f.key]: e.target.value }))}
                            className="w-full rounded-xl border border-neutral-200 px-3 py-2.5 text-[14px] bg-white focus:outline-none focus:ring-2 focus:ring-neutral-900/10"
                          >
                            <option value="">—</option>
                            {f.options.map((o) => <option key={o} value={o}>{o}</option>)}
                          </select>
                        ) : (
                          <input
                            value={formAnswers[f.key] || ""}
                            onChange={(e) => setFormAnswers((a) => ({ ...a, [f.key]: e.target.value }))}
                            className="w-full rounded-xl border border-neutral-200 px-3 py-2.5 text-[14px] focus:outline-none focus:ring-2 focus:ring-neutral-900/10"
                          />
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Avaliação da LOJA (experiência), separada do produto */}
              {data?.collect_store_review && (
                <div className="rounded-2xl border border-neutral-200 p-4 bg-neutral-50/60">
                  <p className="text-sm font-semibold text-neutral-800">E a experiência com a loja?</p>
                  <p className="text-xs text-neutral-500 mb-2">Entrega, prazo, atendimento, embalagem.</p>
                  <div className="flex gap-1.5 mb-2">
                    {[1, 2, 3, 4, 5].map((i) => (
                      <button
                        key={i}
                        type="button"
                        onMouseEnter={() => setStoreHover(i)}
                        onMouseLeave={() => setStoreHover(0)}
                        onClick={() => setStoreRating(i)}
                        className="transition-transform hover:scale-110"
                        aria-label={`${i} estrelas para a loja`}
                      >
                        <Star className="h-7 w-7" style={{ fill: i <= (storeHover || storeRating) ? accent : "transparent", color: i <= (storeHover || storeRating) ? accent : "#d4d4d8" }} />
                      </button>
                    ))}
                  </div>
                  <textarea
                    value={storeComment}
                    onChange={(e) => setStoreComment(e.target.value)}
                    maxLength={2000}
                    rows={2}
                    placeholder="Como foi comprar com a gente? (opcional)"
                    className="w-full rounded-xl border border-neutral-200 px-4 py-2.5 text-[14px] resize-none focus:outline-none focus:ring-2 focus:ring-neutral-900/10"
                  />
                </div>
              )}

              <div>
                <label className="block text-sm font-semibold text-neutral-700 mb-1.5">Seu nome</label>
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  maxLength={120}
                  placeholder="Como quer aparecer"
                  className="w-full rounded-xl border border-neutral-200 px-4 py-3 text-[15px] focus:outline-none focus:ring-2 focus:ring-neutral-900/10"
                />
              </div>

              {/* Recompensa surpresa (sem revelar o valor antes) */}
              {data?.rewards && (
                <div className="rounded-xl bg-amber-50 border border-amber-200 p-3 text-[13px] text-amber-900">
                  <p className="font-semibold">🎁 Tem um cashback surpresa pra você!</p>
                  <p className="text-amber-800/90">Avalie com <b>foto</b> ou <b>vídeo</b> e descubra quanto você ganha — liberado assim que sua avaliação for confirmada.</p>
                </div>
              )}

              {/* Mídia */}
              {data?.ask_media && (
                <div>
                  <label className="block text-sm font-semibold text-neutral-700 mb-1.5">Fotos e vídeos (opcional)</label>
                  <div className="flex flex-wrap gap-2">
                    {media.map((m, i) => (
                      <div key={i} className="relative h-20 w-20 rounded-xl overflow-hidden border border-neutral-200">
                        {m.type === "video" ? (
                          <video src={m.url} className="h-full w-full object-cover" />
                        ) : (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={m.url} alt="" className="h-full w-full object-cover" />
                        )}
                        <button
                          type="button"
                          onClick={() => setMedia((arr) => arr.filter((_, idx) => idx !== i))}
                          className="absolute top-1 right-1 h-5 w-5 rounded-full bg-black/60 text-white flex items-center justify-center"
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </div>
                    ))}
                    {media.length < 8 && (
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
                    onChange={(e) => handleFiles(e.target.files)}
                  />

                  {/* Consentimento de uso em ADS — só quando há vídeo */}
                  {data?.ads_enabled && media.some((m) => m.type === "video") && (
                    <label className="mt-3 flex items-start gap-2 text-[13px] text-neutral-600 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={adsConsent}
                        onChange={(e) => setAdsConsent(e.target.checked)}
                        className="mt-0.5 h-4 w-4"
                      />
                      <span>
                        Autorizo a marca a usar meu vídeo em anúncios e redes sociais.
                        {data?.rewards ? " Se aprovado, rola um bônus extra 🎁" : ""}
                      </span>
                    </label>
                  )}
                </div>
              )}

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
          </>
        )}
      </div>
    </div>
  );
}
