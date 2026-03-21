"use client";

import React, { useState, useEffect, useCallback } from "react";
import { useRouter, useParams } from "next/navigation";
import {
  ChevronRight,
  ArrowLeft,
  CheckCircle2,
  Loader2,
  Image as ImageIcon,
  AlertCircle,
  Lock,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useAccount } from "@/lib/account-context";

const OBJECTIVES = [
  { value: "OUTCOME_TRAFFIC", label: "Tráfego" },
  { value: "OUTCOME_LEADS", label: "Leads" },
  { value: "OUTCOME_SALES", label: "Vendas" },
  { value: "OUTCOME_AWARENESS", label: "Reconhecimento" },
  { value: "OUTCOME_ENGAGEMENT", label: "Engajamento" },
  { value: "OUTCOME_APP_PROMOTION", label: "Promoção de App" },
];

const OPTIMIZATION_GOALS = [
  { value: "LINK_CLICKS", label: "Cliques no Link" },
  { value: "IMPRESSIONS", label: "Impressões" },
  { value: "REACH", label: "Alcance" },
  { value: "LEAD_GENERATION", label: "Geração de Cadastro" },
  { value: "OFFSITE_CONVERSIONS", label: "Conversões" },
];

const CTA_OPTIONS = [
  { value: "LEARN_MORE", label: "Saiba Mais" },
  { value: "SHOP_NOW", label: "Comprar Agora" },
  { value: "SIGN_UP", label: "Cadastre-se" },
  { value: "SUBSCRIBE", label: "Assinar" },
  { value: "CONTACT_US", label: "Fale Conosco" },
  { value: "DOWNLOAD", label: "Baixar" },
  { value: "GET_OFFER", label: "Obter Oferta" },
  { value: "BOOK_TRAVEL", label: "Reservar" },
  { value: "WHATSAPP_MESSAGE", label: "WhatsApp" },
];

const DEFAULT_URL_TAGS =
  "utm_source={{site_source_name}}&utm_medium=paid&utm_campaign={{campaign.name}}&utm_content={{ad.name}}&utm_term={{adset.name}}";

interface CampaignMeta {
  campaign_id: string;
  adset_id: string;
  ad_id: string;
  creative_id: string;
  account_id: string;
  original_image_hash: string;
  original_objective: string;
}

export default function EditCampaignPage() {
  const router = useRouter();
  const { id } = useParams<{ id: string }>();
  const { accountId } = useAccount();

  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);
  const [initialLoading, setInitialLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Meta IDs from the loaded campaign
  const [campaignMeta, setCampaignMeta] = useState<CampaignMeta | null>(null);

  // Step 1: Campaign state
  const [campaignData, setCampaignData] = useState({
    name: "",
    objective: "OUTCOME_TRAFFIC",
    daily_budget: "",
    status: "PAUSED",
  });

  // Step 2: Ad Set state
  const [adSetData, setAdSetData] = useState({
    name: "",
    optimization_goal: "LINK_CLICKS",
    billing_event: "IMPRESSIONS",
    status: "PAUSED",
  });

  // Instagram accounts
  const [instagramAccounts, setInstagramAccounts] = useState<
    Array<{ id: string; username: string; profile_pic?: string }>
  >([]);
  const [instagramAccountId, setInstagramAccountId] = useState("");

  // Step 3: Ad & Creative state
  const [adData, setAdData] = useState({
    name: "",
    title: "",
    body: "",
    link: "",
    status: "PAUSED",
  });
  const [callToAction, setCallToAction] = useState("LEARN_MORE");
  const [urlTags, setUrlTags] = useState(DEFAULT_URL_TAGS);
  const [mediaFile, setMediaFile] = useState<File | null>(null);
  const [mediaPreview, setMediaPreview] = useState<string | null>(null);

  // Track original creative values to detect changes
  const [originalCreative, setOriginalCreative] = useState({
    title: "",
    body: "",
    link: "",
    call_to_action: "LEARN_MORE",
    instagram_actor_id: "",
  });

  // Fetch Instagram accounts
  const fetchInstagramAccounts = useCallback(
    async (acctId: string) => {
      if (!acctId) return;
      try {
        const res = await fetch(
          `/api/instagram-accounts?account_id=${encodeURIComponent(acctId)}`
        );
        const data = await res.json();
        if (data.instagram_accounts && data.instagram_accounts.length > 0) {
          setInstagramAccounts(data.instagram_accounts);
        }
      } catch {
        // Instagram accounts fetch failed
      }
    },
    []
  );

  // Load campaign data
  useEffect(() => {
    if (!id) return;

    async function loadCampaign() {
      try {
        const res = await fetch(`/api/campaigns/${id}`);
        if (!res.ok) throw new Error("Falha ao carregar campanha");

        const data = await res.json();
        const { campaign, adset, ad, creative } = data;

        if (!campaign) throw new Error("Campanha não encontrada");

        const acctId = String(campaign.account_id || accountId || "");

        // Set campaign meta IDs
        setCampaignMeta({
          campaign_id: String(campaign.id),
          adset_id: adset ? String(adset.id) : "",
          ad_id: ad ? String(ad.id) : "",
          creative_id: (creative?.creative || creative)?.id || "",
          account_id: acctId,
          original_image_hash: "",
          original_objective: String(campaign.objective || ""),
        });

        // Pre-fill campaign data
        const budgetCents = campaign.daily_budget
          ? parseInt(String(campaign.daily_budget))
          : 0;
        setCampaignData({
          name: String(campaign.name || ""),
          objective: String(campaign.objective || "OUTCOME_TRAFFIC"),
          daily_budget: budgetCents > 0 ? (budgetCents / 100).toFixed(2) : "",
          status: String(campaign.status || "PAUSED"),
        });

        // Pre-fill ad set data
        if (adset) {
          setAdSetData({
            name: String(adset.name || ""),
            optimization_goal: String(
              adset.optimization_goal || "LINK_CLICKS"
            ),
            billing_event: String(adset.billing_event || "IMPRESSIONS"),
            status: String(adset.status || "PAUSED"),
          });
        }

        // Pre-fill ad data
        if (ad) {
          setAdData((prev) => ({
            ...prev,
            name: String(ad.name || ""),
            status: String(ad.status || "PAUSED"),
          }));
          if (ad.url_tags) {
            setUrlTags(String(ad.url_tags));
          }
        }

        // Pre-fill creative data from object_story_spec
        // getCreativeDetails returns { creative: {actual data}, ads, metrics }
        if (creative) {
          const creativeObj = creative.creative || creative;
          const spec = creativeObj.object_story_spec || {};
          const linkData = spec.link_data || {};

          const creativeTitle = linkData.name || creativeObj.title || "";
          const creativeBody =
            linkData.message || creativeObj.body || "";
          const creativeLink = linkData.link || "";
          const creativeCta =
            linkData.call_to_action?.type || "LEARN_MORE";
          const creativeIgId = spec.instagram_actor_id || "";
          const creativeImageHash = linkData.image_hash || "";

          setAdData((prev) => ({
            ...prev,
            title: creativeTitle,
            body: creativeBody,
            link: creativeLink,
          }));
          setCallToAction(creativeCta);

          if (creativeIgId) {
            setInstagramAccountId(creativeIgId);
          }

          // Set image preview from creative
          const imageUrl =
            creativeObj.image_url ||
            creativeObj.thumbnail_url ||
            linkData.picture;
          if (imageUrl) {
            setMediaPreview(imageUrl);
          }

          // Store original image hash
          setCampaignMeta((prev) =>
            prev ? { ...prev, original_image_hash: creativeImageHash } : prev
          );

          // Store original creative values
          setOriginalCreative({
            title: creativeTitle,
            body: creativeBody,
            link: creativeLink,
            call_to_action: creativeCta,
            instagram_actor_id: creativeIgId,
          });
        }

        // Fetch Instagram accounts for the ad account
        if (acctId) {
          fetchInstagramAccounts(acctId);
        }

        setInitialLoading(false);
      } catch (err: unknown) {
        const message =
          err instanceof Error ? err.message : "Erro ao carregar campanha";
        setLoadError(message);
        setInitialLoading(false);
      }
    }

    loadCampaign();
  }, [id, accountId, fetchInstagramAccounts]);

  const handleMediaChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      setMediaFile(file);
      setMediaPreview(URL.createObjectURL(file));
    }
  };

  const handleNext = () => {
    if (step < 3) setStep(step + 1);
  };

  const handleBack = () => {
    if (step > 1) setStep(step - 1);
    else router.push("/campaigns");
  };

  const hasCreativeChanged = () => {
    return (
      adData.title !== originalCreative.title ||
      adData.body !== originalCreative.body ||
      adData.link !== originalCreative.link ||
      callToAction !== originalCreative.call_to_action ||
      instagramAccountId !== originalCreative.instagram_actor_id ||
      mediaFile !== null
    );
  };

  const handleSubmit = async () => {
    if (!campaignMeta) return;
    setLoading(true);
    setError(null);

    try {
      let imageHash = campaignMeta.original_image_hash;

      // Upload new image if provided
      if (mediaFile) {
        const formData = new FormData();
        formData.append("filename", mediaFile);
        formData.append(
          "account_id",
          campaignMeta.account_id || accountId || ""
        );

        const mediaRes = await fetch("/api/media", {
          method: "POST",
          body: formData,
        });
        const mediaResult = await mediaRes.json();
        if (mediaResult.error) throw new Error(mediaResult.error);

        if (
          mediaResult.images &&
          Object.values(mediaResult.images).length > 0
        ) {
          const firstImage = Object.values(mediaResult.images)[0] as {
            hash: string;
          };
          imageHash = firstImage.hash;
        }
      }

      // Build update payload
      const payload: Record<string, unknown> = {
        account_id: campaignMeta.account_id || accountId,
        campaign: {
          name: campaignData.name,
          status: campaignData.status,
          daily_budget: campaignData.daily_budget
            ? String(Math.round(parseFloat(campaignData.daily_budget) * 100))
            : undefined,
        },
      };

      if (campaignMeta.adset_id) {
        payload.adset = {
          adset_id: campaignMeta.adset_id,
          name: adSetData.name,
          optimization_goal: adSetData.optimization_goal,
        };
      }

      if (campaignMeta.ad_id) {
        payload.ad = {
          ad_id: campaignMeta.ad_id,
          name: adData.name,
          url_tags: urlTags || undefined,
        };
      }

      // Only include creative update if something changed
      if (hasCreativeChanged()) {
        payload.creative = {
          changed: true,
          name: `${adData.name} - Creative`,
          title: adData.title,
          body: adData.body,
          image_hash: imageHash,
          link: adData.link,
          call_to_action: callToAction,
          instagram_actor_id: instagramAccountId || undefined,
        };
      }

      const res = await fetch(`/api/campaigns/${campaignMeta.campaign_id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const result = await res.json();
      if (result.error) throw new Error(result.error);

      router.push("/campaigns");
      router.refresh();
    } catch (err: unknown) {
      const message =
        err instanceof Error
          ? err.message
          : "Erro desconhecido ao atualizar campanha";
      setError(message);
      setLoading(false);
    }
  };

  const isStep1Valid = campaignData.name.trim() !== "";
  const isStep2Valid =
    adSetData.name.trim() !== "" && instagramAccountId !== "";
  const isStep3Valid =
    adData.name.trim() !== "" && adData.link.trim() !== "";

  if (initialLoading) {
    return (
      <div className="max-w-4xl mx-auto flex items-center justify-center py-24">
        <div className="text-center space-y-3">
          <Loader2 className="h-8 w-8 animate-spin mx-auto text-muted-foreground" />
          <p className="text-sm text-muted-foreground">
            Carregando campanha...
          </p>
        </div>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="max-w-4xl mx-auto space-y-6 pb-12">
        <div className="flex items-center gap-4">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => router.push("/campaigns")}
          >
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <h1 className="text-2xl font-bold">Editar Campanha</h1>
        </div>
        <Card>
          <CardContent className="py-12 text-center">
            <AlertCircle className="h-10 w-10 text-destructive mx-auto mb-3" />
            <p className="text-sm text-destructive font-medium">{loadError}</p>
            <p className="text-xs text-muted-foreground mt-2">
              Verifique se a campanha possui conjunto de anúncios e anúncios
              criados.
            </p>
            <Button
              variant="outline"
              className="mt-4"
              onClick={() => router.push("/campaigns")}
            >
              Voltar para Campanhas
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <TooltipProvider>
      <div className="max-w-4xl mx-auto space-y-6 pb-12">
        <div className="flex items-center gap-4">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => router.push("/campaigns")}
          >
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div>
            <h1 className="text-2xl font-bold">Editar Campanha</h1>
            <p className="text-muted-foreground text-sm">
              Atualize os dados da campanha no Meta Ads
            </p>
          </div>
        </div>

        {/* Progress Steps */}
        <div className="flex items-center justify-between relative mb-8">
          <div className="absolute left-0 top-1/2 -translate-y-1/2 w-full h-1 bg-muted rounded" />
          <div
            className="absolute left-0 top-1/2 -translate-y-1/2 h-1 bg-primary rounded transition-all duration-300"
            style={{ width: `${((step - 1) / 2) * 100}%` }}
          />

          {["Campanha", "Conjunto de Anúncios", "Anúncio & Criativo"].map(
            (label, i) => {
              const stepNum = i + 1;
              const isActive = step === stepNum;
              const isPast = step > stepNum;

              return (
                <div
                  key={label}
                  className="relative flex flex-col items-center gap-2"
                >
                  <div
                    className={`w-8 h-8 rounded-full flex items-center justify-center font-bold text-sm transition-colors border-2
                ${
                  isActive
                    ? "bg-primary text-primary-foreground border-primary"
                    : isPast
                      ? "bg-primary text-primary-foreground border-primary"
                      : "bg-background text-muted-foreground border-muted"
                }
              `}
                  >
                    {isPast ? <CheckCircle2 className="w-5 h-5" /> : stepNum}
                  </div>
                  <span
                    className={`text-xs font-medium ${isActive ? "text-foreground" : "text-muted-foreground"}`}
                  >
                    {label}
                  </span>
                </div>
              );
            }
          )}
        </div>

        {error && (
          <div className="bg-destructive/15 text-destructive p-4 rounded-md text-sm border border-destructive/20 font-medium">
            {error}
          </div>
        )}

        {/* Forms */}
        <Card className="border shadow-sm">
          <CardHeader>
            <CardTitle>
              {step === 1 && "Detalhes da Campanha"}
              {step === 2 && "Conjunto de Anúncios"}
              {step === 3 && "Anúncio & Criativo"}
            </CardTitle>
            <CardDescription>
              {step === 1 && "Edite o nome, orçamento e status"}
              {step === 2 && "Edite a otimização e conta do Instagram"}
              {step === 3 && "Edite o criativo do anúncio"}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* STEP 1 */}
            {step === 1 && (
              <div className="space-y-4 animate-in fade-in slide-in-from-bottom-4 duration-500">
                <div className="space-y-2">
                  <label className="text-sm font-medium">
                    Nome da Campanha *
                  </label>
                  <Input
                    placeholder="Ex: Campanha de Vendas - Verão"
                    value={campaignData.name}
                    onChange={(e) =>
                      setCampaignData({
                        ...campaignData,
                        name: e.target.value,
                      })
                    }
                  />
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <label className="text-sm font-medium flex items-center gap-1.5">
                      Objetivo
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Lock className="h-3.5 w-3.5 text-muted-foreground" />
                        </TooltipTrigger>
                        <TooltipContent className="max-w-[240px] text-xs">
                          Não é possível alterar o objetivo após a criação da
                          campanha (limitação da Meta).
                        </TooltipContent>
                      </Tooltip>
                    </label>
                    <Select value={campaignData.objective} disabled>
                      <SelectTrigger className="opacity-60">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {OBJECTIVES.map((obj) => (
                          <SelectItem key={obj.value} value={obj.value}>
                            {obj.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-2">
                    <label className="text-sm font-medium">
                      Orçamento Diário (em R$)
                    </label>
                    <Input
                      type="number"
                      placeholder="Ex: 50.00"
                      value={campaignData.daily_budget}
                      onChange={(e) =>
                        setCampaignData({
                          ...campaignData,
                          daily_budget: e.target.value,
                        })
                      }
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium">Status</label>
                  <Select
                    value={campaignData.status}
                    onValueChange={(v) =>
                      setCampaignData({ ...campaignData, status: v })
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="PAUSED">Pausada</SelectItem>
                      <SelectItem value="ACTIVE">Ativa</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            )}

            {/* STEP 2 */}
            {step === 2 && (
              <div className="space-y-4 animate-in fade-in slide-in-from-bottom-4 duration-500">
                <div className="space-y-2">
                  <label className="text-sm font-medium">
                    Nome do Conjunto de Anúncios *
                  </label>
                  <Input
                    placeholder="Ex: Público Aberto - Brasil"
                    value={adSetData.name}
                    onChange={(e) =>
                      setAdSetData({ ...adSetData, name: e.target.value })
                    }
                  />
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <label className="text-sm font-medium">
                      Meta de Otimização
                    </label>
                    <Select
                      value={adSetData.optimization_goal}
                      onValueChange={(v) =>
                        setAdSetData({
                          ...adSetData,
                          optimization_goal: v,
                        })
                      }
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {OPTIMIZATION_GOALS.map((goal) => (
                          <SelectItem key={goal.value} value={goal.value}>
                            {goal.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-2">
                    <label className="text-sm font-medium">
                      Conta do Instagram *
                    </label>
                    {instagramAccounts.length > 0 ? (
                      <Select
                        value={instagramAccountId}
                        onValueChange={setInstagramAccountId}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Selecione a conta" />
                        </SelectTrigger>
                        <SelectContent>
                          {instagramAccounts.map((acc) => (
                            <SelectItem key={acc.id} value={acc.id}>
                              @{acc.username}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    ) : (
                      <div className="text-xs text-destructive pt-2 flex items-center gap-1.5">
                        <AlertCircle className="h-3.5 w-3.5 flex-shrink-0" />
                        Nenhuma conta Instagram vinculada a esta conta de
                        anúncios. É obrigatório vincular uma conta.
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* STEP 3 */}
            {step === 3 && (
              <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
                <div className="space-y-2">
                  <label className="text-sm font-medium">
                    Nome do Anúncio *
                  </label>
                  <Input
                    placeholder="Ex: AD 01 - Vídeo Depoimento"
                    value={adData.name}
                    onChange={(e) =>
                      setAdData({ ...adData, name: e.target.value })
                    }
                  />
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="space-y-4">
                    <div className="space-y-2">
                      <label className="text-sm font-medium">
                        Destino: Site (URL) *
                      </label>
                      <Input
                        type="url"
                        placeholder="https://seusite.com.br/oferta"
                        value={adData.link}
                        onChange={(e) =>
                          setAdData({ ...adData, link: e.target.value })
                        }
                      />
                      <p className="text-xs text-muted-foreground">
                        URL da página de destino do anúncio
                      </p>
                    </div>

                    <div className="space-y-2">
                      <label className="text-sm font-medium">
                        Botão de Ação (CTA)
                      </label>
                      <Select
                        value={callToAction}
                        onValueChange={setCallToAction}
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {CTA_OPTIONS.map((cta) => (
                            <SelectItem key={cta.value} value={cta.value}>
                              {cta.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="space-y-2">
                      <label className="text-sm font-medium">
                        Título Curto
                      </label>
                      <Input
                        placeholder="Compre agora e economize 50%"
                        value={adData.title}
                        onChange={(e) =>
                          setAdData({ ...adData, title: e.target.value })
                        }
                      />
                    </div>

                    <div className="space-y-2">
                      <label className="text-sm font-medium">
                        Texto Principal (Copy)
                      </label>
                      <Textarea
                        placeholder="Escreva a copy principal do seu anúncio..."
                        className="resize-none h-32"
                        value={adData.body}
                        onChange={(
                          e: React.ChangeEvent<HTMLTextAreaElement>
                        ) => setAdData({ ...adData, body: e.target.value })}
                      />
                    </div>
                  </div>

                  <div className="space-y-4">
                    <div className="space-y-2">
                      <label className="text-sm font-medium">
                        Mídia (Imagem)
                      </label>

                      <div
                        className={`
                        border-2 border-dashed rounded-lg p-6 flex flex-col items-center justify-center text-center
                        transition-colors relative overflow-hidden h-48 bg-muted/20
                        ${mediaPreview ? "border-primary/50 bg-primary/5" : "border-muted-foreground/20 hover:border-primary/50"}
                      `}
                      >
                        {mediaPreview ? (
                          <div className="absolute inset-0 w-full h-full">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                              src={mediaPreview}
                              alt="Preview"
                              className="w-full h-full object-contain"
                            />
                            <div className="absolute inset-0 bg-black/40 flex items-center justify-center opacity-0 hover:opacity-100 transition-opacity">
                              <Button
                                variant="secondary"
                                size="sm"
                                className="pointer-events-none"
                              >
                                Trocar Imagem
                              </Button>
                            </div>
                          </div>
                        ) : (
                          <>
                            <ImageIcon className="w-10 h-10 text-muted-foreground mb-4" />
                            <p className="text-sm font-medium mb-1">
                              Arraste uma imagem ou clique para selecionar
                            </p>
                            <p className="text-xs text-muted-foreground">
                              JPG, PNG (Máx 8MB)
                            </p>
                          </>
                        )}

                        <input
                          type="file"
                          accept="image/*"
                          className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                          onChange={handleMediaChange}
                        />
                      </div>
                      {!mediaFile && mediaPreview && (
                        <p className="text-xs text-muted-foreground">
                          Imagem atual do criativo. Selecione uma nova para
                          substituir.
                        </p>
                      )}
                    </div>

                    <div className="space-y-2">
                      <label className="text-sm font-medium">
                        Parâmetros de URL (UTM)
                      </label>
                      <Textarea
                        placeholder="utm_source={{site_source_name}}&utm_medium=paid..."
                        className="resize-none h-20 font-mono text-xs"
                        value={urlTags}
                        onChange={(
                          e: React.ChangeEvent<HTMLTextAreaElement>
                        ) => setUrlTags(e.target.value)}
                      />
                      <p className="text-xs text-muted-foreground">
                        Variáveis da Meta: {"{{campaign.name}}"},
                        {"{{adset.name}}"}, {"{{ad.name}}"},
                        {"{{site_source_name}}"}, {"{{placement}}"}
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Footer Controls */}
        <div className="flex items-center justify-end gap-3 pt-4">
          <Button variant="outline" onClick={handleBack} disabled={loading}>
            {step === 1 ? "Cancelar" : "Voltar"}
          </Button>

          {step < 3 ? (
            <Button
              onClick={handleNext}
              disabled={
                (step === 1 && !isStep1Valid) || (step === 2 && !isStep2Valid)
              }
            >
              Avançar
              <ChevronRight className="w-4 h-4 ml-1" />
            </Button>
          ) : (
            <Button
              onClick={handleSubmit}
              disabled={loading || !isStep3Valid}
            >
              {loading ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Salvando Alterações...
                </>
              ) : (
                <>
                  <CheckCircle2 className="w-4 h-4 mr-2" />
                  Salvar Alterações
                </>
              )}
            </Button>
          )}
        </div>
      </div>
    </TooltipProvider>
  );
}
