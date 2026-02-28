"use client";

import React, { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { ChevronRight, ArrowLeft, CheckCircle2, Loader2, Image as ImageIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
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

const DEFAULT_URL_TAGS = "utm_source={{site_source_name}}&utm_medium=paid&utm_campaign={{campaign.name}}&utm_content={{ad.name}}&utm_term={{adset.name}}";

export default function NewCampaignWizard() {
    const router = useRouter();
    const { accountId } = useAccount();

    const [step, setStep] = useState(1);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

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
    const [instagramAccounts, setInstagramAccounts] = useState<Array<{ id: string; username: string; profile_pic?: string }>>([]);
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

    // Fetch Instagram accounts when accountId is available
    const fetchInstagramAccounts = useCallback(async () => {
        if (!accountId) return;
        try {
            const res = await fetch(`/api/instagram-accounts?account_id=${encodeURIComponent(accountId)}`);
            const data = await res.json();
            if (data.instagram_accounts && data.instagram_accounts.length > 0) {
                setInstagramAccounts(data.instagram_accounts);
                setInstagramAccountId(data.instagram_accounts[0].id);
            }
        } catch {
            // Non-critical — Instagram account is optional
        }
    }, [accountId]);

    useEffect(() => {
        fetchInstagramAccounts();
    }, [fetchInstagramAccounts]);

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

    const handleSubmit = async () => {
        if (!accountId) return;
        setLoading(true);
        setError(null);

        try {
            // 1. Create Campaign
            const campaignRes = await fetch("/api/campaigns", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    action: "create",
                    account_id: accountId,
                    name: campaignData.name,
                    objective: campaignData.objective,
                    status: campaignData.status,
                    special_ad_categories: [],
                }),
            });
            const campaignResult = await campaignRes.json();
            if (campaignResult.error) throw new Error(campaignResult.error);
            const newCampaignId = campaignResult.id;

            // 2. Create Ad Set
            const adSetRes = await fetch("/api/adsets", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    campaign_id: newCampaignId,
                    name: adSetData.name,
                    optimization_goal: adSetData.optimization_goal,
                    billing_event: "IMPRESSIONS",
                    status: adSetData.status,
                    daily_budget: campaignData.daily_budget
                        ? Math.round(parseFloat(campaignData.daily_budget) * 100)
                        : 5000,
                }),
            });
            const adSetResult = await adSetRes.json();
            if (adSetResult.error) throw new Error(adSetResult.error);
            const newAdSetId = adSetResult.id;

            let imageHash = null;

            // 3. Upload Media (if provided)
            if (mediaFile) {
                const formData = new FormData();
                formData.append("filename", mediaFile);
                formData.append("account_id", accountId);

                const mediaRes = await fetch("/api/media", {
                    method: "POST",
                    body: formData,
                });
                const mediaResult = await mediaRes.json();
                if (mediaResult.error) throw new Error(mediaResult.error);

                // Facebook API returns images -> hash
                if (mediaResult.images && Object.values(mediaResult.images).length > 0) {
                    const firstImage = Object.values(mediaResult.images)[0] as { hash: string };
                    imageHash = firstImage.hash;
                }
            }

            // 4. Create Creative
            const creativePayload: Record<string, unknown> = {
                action: "create",
                account_id: accountId,
                name: `${adData.name} - Creative`,
                title: adData.title,
                body: adData.body,
                image_hash: imageHash,
                link: adData.link,
                call_to_action: callToAction,
            };
            if (instagramAccountId) {
                creativePayload.instagram_actor_id = instagramAccountId;
            }
            const creativeRes = await fetch("/api/creatives", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(creativePayload),
            });
            const creativeResult = await creativeRes.json();
            if (creativeResult.error) throw new Error(creativeResult.error);
            const newCreativeId = creativeResult.id;

            // 5. Create Ad
            const adRes = await fetch("/api/ads", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    adset_id: newAdSetId,
                    name: adData.name,
                    status: adData.status,
                    creative: { creative_id: newCreativeId },
                    url_tags: urlTags || undefined,
                }),
            });
            const adResult = await adRes.json();
            if (adResult.error) throw new Error(adResult.error);

            // Success
            router.push("/campaigns");
            router.refresh();

        } catch (err: any) {
            setError(err.message || "Erro desconhecido ao criar campanha");
            setLoading(false);
        }
    };

    const isStep1Valid = campaignData.name.trim() !== "";
    const isStep2Valid = adSetData.name.trim() !== "";
    const isStep3Valid = adData.name.trim() !== "" && adData.link.trim() !== "" && mediaFile !== null;

    return (
        <div className="max-w-4xl mx-auto space-y-6 pb-12">
            <div className="flex items-center gap-4">
                <Button variant="ghost" size="icon" onClick={() => router.push("/campaigns")}>
                    <ArrowLeft className="h-5 w-5" />
                </Button>
                <div>
                    <h1 className="text-2xl font-bold">Criar Nova Campanha</h1>
                    <p className="text-muted-foreground text-sm">Estruturação completa no padrão Meta Ads</p>
                </div>
            </div>

            {/* Progress Steps */}
            <div className="flex items-center justify-between relative mb-8">
                <div className="absolute left-0 top-1/2 -translate-y-1/2 w-full h-1 bg-muted rounded" />
                <div
                    className="absolute left-0 top-1/2 -translate-y-1/2 h-1 bg-primary rounded transition-all duration-300"
                    style={{ width: `${((step - 1) / 2) * 100}%` }}
                />

                {["Campanha", "Conjunto de Anúncios", "Anúncio & Criativo"].map((label, i) => {
                    const stepNum = i + 1;
                    const isActive = step === stepNum;
                    const isPast = step > stepNum;

                    return (
                        <div key={label} className="relative flex flex-col items-center gap-2">
                            <div className={`w-8 h-8 rounded-full flex items-center justify-center font-bold text-sm transition-colors border-2
                ${isActive ? "bg-primary text-primary-foreground border-primary" :
                                    isPast ? "bg-primary text-primary-foreground border-primary" :
                                        "bg-background text-muted-foreground border-muted"}
              `}>
                                {isPast ? <CheckCircle2 className="w-5 h-5" /> : stepNum}
                            </div>
                            <span className={`text-xs font-medium ${isActive ? "text-foreground" : "text-muted-foreground"}`}>
                                {label}
                            </span>
                        </div>
                    );
                })}
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
                        {step === 1 && "Configure o objetivo e orçamento geral"}
                        {step === 2 && "Defina a otimização e o direcionamento"}
                        {step === 3 && "Crie o aspecto visual do anúncio"}
                    </CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">

                    {/* STEP 1 */}
                    {step === 1 && (
                        <div className="space-y-4 animate-in fade-in slide-in-from-bottom-4 duration-500">
                            <div className="space-y-2">
                                <label className="text-sm font-medium">Nome da Campanha *</label>
                                <Input
                                    placeholder="Ex: Campanha de Vendas - Verão"
                                    value={campaignData.name}
                                    onChange={(e) => setCampaignData({ ...campaignData, name: e.target.value })}
                                />
                            </div>

                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div className="space-y-2">
                                    <label className="text-sm font-medium">Objetivo</label>
                                    <Select
                                        value={campaignData.objective}
                                        onValueChange={(v) => setCampaignData({ ...campaignData, objective: v })}
                                    >
                                        <SelectTrigger><SelectValue /></SelectTrigger>
                                        <SelectContent>
                                            {OBJECTIVES.map(obj => (
                                                <SelectItem key={obj.value} value={obj.value}>{obj.label}</SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                </div>

                                <div className="space-y-2">
                                    <label className="text-sm font-medium">Orçamento Diário (Opcional, em R$)</label>
                                    <Input
                                        type="number"
                                        placeholder="Ex: 50.00"
                                        value={campaignData.daily_budget}
                                        onChange={(e) => setCampaignData({ ...campaignData, daily_budget: e.target.value })}
                                    />
                                </div>
                            </div>

                            <div className="space-y-2">
                                <label className="text-sm font-medium">Status Inicial</label>
                                <Select
                                    value={campaignData.status}
                                    onValueChange={(v) => setCampaignData({ ...campaignData, status: v })}
                                >
                                    <SelectTrigger><SelectValue /></SelectTrigger>
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
                                <label className="text-sm font-medium">Nome do Conjunto de Anúncios *</label>
                                <Input
                                    placeholder="Ex: Público Aberto - Brasil"
                                    value={adSetData.name}
                                    onChange={(e) => setAdSetData({ ...adSetData, name: e.target.value })}
                                />
                            </div>

                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div className="space-y-2">
                                    <label className="text-sm font-medium">Meta de Otimização</label>
                                    <Select
                                        value={adSetData.optimization_goal}
                                        onValueChange={(v) => setAdSetData({ ...adSetData, optimization_goal: v })}
                                    >
                                        <SelectTrigger><SelectValue /></SelectTrigger>
                                        <SelectContent>
                                            {OPTIMIZATION_GOALS.map(goal => (
                                                <SelectItem key={goal.value} value={goal.value}>{goal.label}</SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                </div>

                                <div className="space-y-2">
                                    <label className="text-sm font-medium">Conta do Instagram</label>
                                    {instagramAccounts.length > 0 ? (
                                        <Select
                                            value={instagramAccountId}
                                            onValueChange={setInstagramAccountId}
                                        >
                                            <SelectTrigger><SelectValue placeholder="Selecione a conta" /></SelectTrigger>
                                            <SelectContent>
                                                {instagramAccounts.map(acc => (
                                                    <SelectItem key={acc.id} value={acc.id}>@{acc.username}</SelectItem>
                                                ))}
                                            </SelectContent>
                                        </Select>
                                    ) : (
                                        <p className="text-xs text-muted-foreground pt-2">Nenhuma conta Instagram vinculada a esta conta de anúncios.</p>
                                    )}
                                </div>
                            </div>
                        </div>
                    )}

                    {/* STEP 3 */}
                    {step === 3 && (
                        <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
                            <div className="space-y-2">
                                <label className="text-sm font-medium">Nome do Anúncio *</label>
                                <Input
                                    placeholder="Ex: AD 01 - Vídeo Depoimento"
                                    value={adData.name}
                                    onChange={(e) => setAdData({ ...adData, name: e.target.value })}
                                />
                            </div>

                            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                <div className="space-y-4">
                                    <div className="space-y-2">
                                        <label className="text-sm font-medium">Destino: Site (URL) *</label>
                                        <Input
                                            type="url"
                                            placeholder="https://seusite.com.br/oferta"
                                            value={adData.link}
                                            onChange={(e) => setAdData({ ...adData, link: e.target.value })}
                                        />
                                        <p className="text-xs text-muted-foreground">URL da página de destino do anúncio</p>
                                    </div>

                                    <div className="space-y-2">
                                        <label className="text-sm font-medium">Botão de Ação (CTA)</label>
                                        <Select
                                            value={callToAction}
                                            onValueChange={setCallToAction}
                                        >
                                            <SelectTrigger><SelectValue /></SelectTrigger>
                                            <SelectContent>
                                                {CTA_OPTIONS.map(cta => (
                                                    <SelectItem key={cta.value} value={cta.value}>{cta.label}</SelectItem>
                                                ))}
                                            </SelectContent>
                                        </Select>
                                    </div>

                                    <div className="space-y-2">
                                        <label className="text-sm font-medium">Título Curto</label>
                                        <Input
                                            placeholder="Compre agora e economize 50%"
                                            value={adData.title}
                                            onChange={(e) => setAdData({ ...adData, title: e.target.value })}
                                        />
                                    </div>

                                    <div className="space-y-2">
                                        <label className="text-sm font-medium">Texto Principal (Copy)</label>
                                        <Textarea
                                            placeholder="Escreva a copy principal do seu anúncio..."
                                            className="resize-none h-32"
                                            value={adData.body}
                                            onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setAdData({ ...adData, body: e.target.value })}
                                        />
                                    </div>
                                </div>

                                <div className="space-y-4">
                                    <div className="space-y-2">
                                        <label className="text-sm font-medium">Upload de Mídia (Imagem) *</label>

                                        <div className={`
                        border-2 border-dashed rounded-lg p-6 flex flex-col items-center justify-center text-center
                        transition-colors relative overflow-hidden h-48 bg-muted/20
                        ${mediaPreview ? 'border-primary/50 bg-primary/5' : 'border-muted-foreground/20 hover:border-primary/50'}
                      `}>
                                            {mediaPreview ? (
                                                <div className="absolute inset-0 w-full h-full">
                                                    {/* eslint-disable-next-line @next/next/no-img-element */}
                                                    <img
                                                        src={mediaPreview}
                                                        alt="Preview"
                                                        className="w-full h-full object-contain"
                                                    />
                                                    <div className="absolute inset-0 bg-black/40 flex items-center justify-center opacity-0 hover:opacity-100 transition-opacity">
                                                        <Button variant="secondary" size="sm" className="pointer-events-none">Trocar Imagem</Button>
                                                    </div>
                                                </div>
                                            ) : (
                                                <>
                                                    <ImageIcon className="w-10 h-10 text-muted-foreground mb-4" />
                                                    <p className="text-sm font-medium mb-1">Arraste uma imagem ou clique para selecionar</p>
                                                    <p className="text-xs text-muted-foreground">JPG, PNG (Máx 8MB)</p>
                                                </>
                                            )}

                                            <input
                                                type="file"
                                                accept="image/*"
                                                className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                                                onChange={handleMediaChange}
                                            />
                                        </div>
                                    </div>

                                    <div className="space-y-2">
                                        <label className="text-sm font-medium">Parâmetros de URL (UTM)</label>
                                        <Textarea
                                            placeholder="utm_source={{site_source_name}}&utm_medium=paid..."
                                            className="resize-none h-20 font-mono text-xs"
                                            value={urlTags}
                                            onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setUrlTags(e.target.value)}
                                        />
                                        <p className="text-xs text-muted-foreground">
                                            Variáveis da Meta: {"{{campaign.name}}"}, {"{{adset.name}}"}, {"{{ad.name}}"}, {"{{site_source_name}}"}, {"{{placement}}"}
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
                    <Button onClick={handleNext} disabled={(step === 1 && !isStep1Valid) || (step === 2 && !isStep2Valid)}>
                        Avançar
                        <ChevronRight className="w-4 h-4 ml-1" />
                    </Button>
                ) : (
                    <Button onClick={handleSubmit} disabled={loading || !isStep3Valid}>
                        {loading ? (
                            <>
                                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                                Criando e Publicando...
                            </>
                        ) : (
                            <>
                                <CheckCircle2 className="w-4 h-4 mr-2" />
                                Criar Campanha Completa
                            </>
                        )}
                    </Button>
                )}
            </div>
        </div>
    );
}
