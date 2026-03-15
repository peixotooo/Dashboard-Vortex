"use client";

import React, { useState, useRef, useCallback } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Loader2,
  ChevronLeft,
  ChevronRight,
  Plus,
  Trash2,
  Upload,
  Image as ImageIcon,
  Video,
  FileText,
  Link,
  MessageSquare,
  Phone,
  CheckCircle2,
  Clock,
  AlertCircle,
  Eye,
} from "lucide-react";
import { useWorkspace } from "@/lib/workspace-context";
import { GalleryPicker, type MediaItem } from "@/components/gallery-picker";

// --- Types ---

type HeaderType = "NONE" | "TEXT" | "IMAGE" | "VIDEO" | "DOCUMENT";
type ButtonType = "URL" | "QUICK_REPLY" | "PHONE_NUMBER";

interface TemplateButton {
  type: ButtonType;
  text: string;
  url?: string;
  urlExample?: string;
  phoneNumber?: string;
  addUtm: boolean;
}

interface TemplateFormState {
  name: string;
  category: "MARKETING" | "UTILITY";
  language: string;
  headerType: HeaderType;
  headerText: string;
  headerMediaUrl: string;
  headerMediaFilename: string;
  bodyText: string;
  bodyExamples: Record<string, string>;
  footerText: string;
  buttons: TemplateButton[];
}

interface TemplateCreateDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated?: () => void;
}

// --- Constants ---

const LANGUAGES = [
  { value: "pt_BR", label: "Portugues (BR)" },
  { value: "en_US", label: "Ingles (US)" },
  { value: "es", label: "Espanhol" },
  { value: "en", label: "Ingles" },
];

const STEPS = [
  { label: "Info", icon: FileText },
  { label: "Header", icon: ImageIcon },
  { label: "Corpo", icon: MessageSquare },
  { label: "Botoes", icon: Link },
  { label: "Revisar", icon: Eye },
];

const MEDIA_LIMITS: Record<string, { accept: string; maxBytes: number; label: string }> = {
  IMAGE: { accept: "image/jpeg,image/png", maxBytes: 5 * 1024 * 1024, label: "JPEG ou PNG, max 5MB" },
  VIDEO: { accept: "video/mp4", maxBytes: 16 * 1024 * 1024, label: "MP4, max 16MB" },
  DOCUMENT: { accept: "application/pdf", maxBytes: 100 * 1024 * 1024, label: "PDF, max 100MB" },
};

const INITIAL_STATE: TemplateFormState = {
  name: "",
  category: "MARKETING",
  language: "pt_BR",
  headerType: "NONE",
  headerText: "",
  headerMediaUrl: "",
  headerMediaFilename: "",
  bodyText: "",
  bodyExamples: {},
  footerText: "",
  buttons: [],
};

// --- Helpers ---

function slugify(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "")
    .slice(0, 512);
}

function extractVars(text: string): string[] {
  const matches = text.match(/\{\{(\d+)\}\}/g);
  return matches ? [...new Set(matches)].sort() : [];
}

function buildUtmUrl(baseUrl: string, templateName: string): string {
  if (baseUrl.includes("utm_source")) return baseUrl;
  const sep = baseUrl.includes("?") ? "&" : "?";
  return `${baseUrl}${sep}utm_source=whatsapp&utm_medium=wa_template&utm_campaign=${templateName}`;
}

// --- Component ---

export function TemplateCreateDialog({ open, onOpenChange, onCreated }: TemplateCreateDialogProps) {
  const { workspace } = useWorkspace();
  const workspaceId = workspace?.id || "";

  const [step, setStep] = useState(0);
  const [form, setForm] = useState<TemplateFormState>({ ...INITIAL_STATE });
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState("");
  const [uploading, setUploading] = useState(false);
  const [galleryOpen, setGalleryOpen] = useState(false);

  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const slug = slugify(form.name);
  const bodyVars = extractVars(form.bodyText);

  const wsHeaders = useCallback(
    () => ({ "Content-Type": "application/json", "x-workspace-id": workspaceId }),
    [workspaceId]
  );

  // Reset on close
  const handleOpenChange = (open: boolean) => {
    if (!open) {
      setStep(0);
      setForm({ ...INITIAL_STATE });
      setSubmitting(false);
      setSubmitted(false);
      setError("");
    }
    onOpenChange(open);
  };

  // --- Media upload ---
  const handleFileUpload = async (file: File) => {
    const limits = MEDIA_LIMITS[form.headerType];
    if (!limits) return;

    if (file.size > limits.maxBytes) {
      setError(`Arquivo excede o limite: ${limits.label}`);
      return;
    }

    setUploading(true);
    setError("");
    try {
      const res = await fetch("/api/media/upload-url", {
        method: "POST",
        headers: wsHeaders(),
        body: JSON.stringify({ filename: file.name, mime_type: file.type }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Erro ao gerar URL de upload");
      }
      const { signedUrl, publicUrl } = await res.json();

      await fetch(signedUrl, {
        method: "PUT",
        headers: { "Content-Type": file.type },
        body: file,
      });

      setForm((prev) => ({ ...prev, headerMediaUrl: publicUrl, headerMediaFilename: file.name }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro no upload");
    } finally {
      setUploading(false);
    }
  };

  const handleGallerySelect = (items: MediaItem[]) => {
    if (items.length > 0) {
      setForm((prev) => ({
        ...prev,
        headerMediaUrl: items[0].image_url,
        headerMediaFilename: items[0].filename,
      }));
    }
  };

  // --- Insert variable at cursor ---
  const insertVariable = () => {
    const nextNum = bodyVars.length > 0
      ? Math.max(...bodyVars.map((v) => parseInt(v.replace(/\D/g, "")))) + 1
      : 1;
    const variable = `{{${nextNum}}}`;
    const el = bodyRef.current;
    if (el) {
      const start = el.selectionStart;
      const end = el.selectionEnd;
      const newText = form.bodyText.slice(0, start) + variable + form.bodyText.slice(end);
      setForm((prev) => ({ ...prev, bodyText: newText }));
      setTimeout(() => {
        el.focus();
        el.setSelectionRange(start + variable.length, start + variable.length);
      }, 0);
    } else {
      setForm((prev) => ({ ...prev, bodyText: prev.bodyText + variable }));
    }
  };

  // --- Add button ---
  const addButton = (type: ButtonType) => {
    if (form.buttons.length >= 10) return;
    setForm((prev) => ({
      ...prev,
      buttons: [...prev.buttons, { type, text: "", addUtm: type === "URL" }],
    }));
  };

  const updateButton = (index: number, updates: Partial<TemplateButton>) => {
    setForm((prev) => ({
      ...prev,
      buttons: prev.buttons.map((b, i) => (i === index ? { ...b, ...updates } : b)),
    }));
  };

  const removeButton = (index: number) => {
    setForm((prev) => ({
      ...prev,
      buttons: prev.buttons.filter((_, i) => i !== index),
    }));
  };

  // --- Build Meta payload ---
  const buildComponents = (): Record<string, unknown>[] => {
    const components: Record<string, unknown>[] = [];

    // HEADER
    if (form.headerType === "TEXT" && form.headerText.trim()) {
      const comp: Record<string, unknown> = { type: "HEADER", format: "TEXT", text: form.headerText };
      if (form.headerText.includes("{{1}}")) {
        comp.example = { header_text: ["Exemplo"] };
      }
      components.push(comp);
    } else if (["IMAGE", "VIDEO", "DOCUMENT"].includes(form.headerType) && form.headerMediaUrl) {
      components.push({
        type: "HEADER",
        format: form.headerType,
        example: { header_url: [form.headerMediaUrl] },
      });
    }

    // BODY
    const bodyComp: Record<string, unknown> = { type: "BODY", text: form.bodyText };
    if (bodyVars.length > 0) {
      bodyComp.example = {
        body_text: [bodyVars.map((v) => form.bodyExamples[v] || "exemplo")],
      };
    }
    components.push(bodyComp);

    // FOOTER
    if (form.footerText.trim()) {
      components.push({ type: "FOOTER", text: form.footerText });
    }

    // BUTTONS
    if (form.buttons.length > 0) {
      components.push({
        type: "BUTTONS",
        buttons: form.buttons.map((b) => {
          if (b.type === "URL") {
            const finalUrl = b.addUtm && b.url ? buildUtmUrl(b.url, slug) : b.url || "";
            const btn: Record<string, unknown> = { type: "URL", text: b.text, url: finalUrl };
            if (finalUrl.includes("{{1}}") && b.urlExample) {
              btn.example = [b.urlExample];
            }
            return btn;
          }
          if (b.type === "PHONE_NUMBER") {
            return { type: "PHONE_NUMBER", text: b.text, phone_number: b.phoneNumber || "" };
          }
          return { type: "QUICK_REPLY", text: b.text };
        }),
      });
    }

    return components;
  };

  // --- Submit ---
  const handleSubmit = async () => {
    setSubmitting(true);
    setError("");
    try {
      const res = await fetch("/api/crm/whatsapp/templates/manage", {
        method: "POST",
        headers: wsHeaders(),
        body: JSON.stringify({
          name: slug,
          language: form.language,
          category: form.category,
          components: buildComponents(),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Erro ao criar template");
      setSubmitted(true);
      onCreated?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro desconhecido");
    } finally {
      setSubmitting(false);
    }
  };

  // --- Validation per step ---
  const canAdvance = (): boolean => {
    switch (step) {
      case 0: return slug.length >= 3 && form.bodyText.length === 0 ? true : slug.length >= 3;
      case 1: {
        if (form.headerType === "NONE") return true;
        if (form.headerType === "TEXT") return form.headerText.trim().length > 0 && form.headerText.length <= 60;
        return form.headerMediaUrl.length > 0;
      }
      case 2: return form.bodyText.trim().length > 0 && form.bodyText.length <= 1024 &&
        bodyVars.every((v) => (form.bodyExamples[v] || "").trim().length > 0);
      case 3: return form.buttons.every((b) => {
        if (!b.text.trim()) return false;
        if (b.type === "URL" && !b.url?.trim()) return false;
        if (b.type === "PHONE_NUMBER" && !b.phoneNumber?.trim()) return false;
        return true;
      });
      default: return true;
    }
  };

  // --- Render steps ---

  const renderStep0 = () => (
    <div className="space-y-4">
      <div>
        <Label>Nome do template</Label>
        <Input
          placeholder="Ex: promo_verao_2024"
          value={form.name}
          onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))}
          maxLength={512}
        />
        {form.name && (
          <p className="text-xs text-muted-foreground mt-1">
            Slug: <code className="bg-muted px-1 rounded">{slug || "..."}</code>
          </p>
        )}
      </div>

      <div>
        <Label>Categoria</Label>
        <Select
          value={form.category}
          onValueChange={(v) => setForm((prev) => ({ ...prev, category: v as "MARKETING" | "UTILITY" }))}
        >
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="MARKETING">Marketing</SelectItem>
            <SelectItem value="UTILITY">Utilidade</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div>
        <Label>Idioma</Label>
        <Select
          value={form.language}
          onValueChange={(v) => setForm((prev) => ({ ...prev, language: v }))}
        >
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            {LANGUAGES.map((l) => (
              <SelectItem key={l.value} value={l.value}>{l.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  );

  const renderStep1 = () => (
    <div className="space-y-4">
      <div>
        <Label>Tipo de header</Label>
        <Select
          value={form.headerType}
          onValueChange={(v) =>
            setForm((prev) => ({
              ...prev,
              headerType: v as HeaderType,
              headerText: "",
              headerMediaUrl: "",
              headerMediaFilename: "",
            }))
          }
        >
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="NONE">Nenhum</SelectItem>
            <SelectItem value="TEXT">Texto</SelectItem>
            <SelectItem value="IMAGE">Imagem</SelectItem>
            <SelectItem value="VIDEO">Video</SelectItem>
            <SelectItem value="DOCUMENT">Documento</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {form.headerType === "TEXT" && (
        <div>
          <Label>Texto do header (max 60 chars)</Label>
          <Input
            value={form.headerText}
            onChange={(e) => setForm((prev) => ({ ...prev, headerText: e.target.value }))}
            maxLength={60}
            placeholder="Ex: Oferta especial para voce!"
          />
          <p className="text-xs text-muted-foreground mt-1">{form.headerText.length}/60</p>
        </div>
      )}

      {["IMAGE", "VIDEO", "DOCUMENT"].includes(form.headerType) && (
        <div className="space-y-3">
          <p className="text-xs text-muted-foreground">{MEDIA_LIMITS[form.headerType]?.label}</p>

          {form.headerMediaUrl ? (
            <div className="border rounded-lg p-3 space-y-2">
              {form.headerType === "IMAGE" && (
                <img src={form.headerMediaUrl} alt="" className="max-h-40 rounded object-contain" />
              )}
              {form.headerType === "VIDEO" && (
                <video src={form.headerMediaUrl} className="max-h-40 rounded" controls muted preload="metadata" />
              )}
              {form.headerType === "DOCUMENT" && (
                <div className="flex items-center gap-2 text-sm">
                  <FileText className="h-5 w-5 text-muted-foreground" />
                  <span className="truncate">{form.headerMediaFilename}</span>
                </div>
              )}
              <Button
                variant="outline"
                size="sm"
                onClick={() => setForm((prev) => ({ ...prev, headerMediaUrl: "", headerMediaFilename: "" }))}
              >
                <Trash2 className="h-3.5 w-3.5 mr-1" /> Remover
              </Button>
            </div>
          ) : (
            <div className="flex gap-2">
              {form.headerType === "IMAGE" && (
                <Button variant="outline" size="sm" onClick={() => setGalleryOpen(true)}>
                  <ImageIcon className="h-4 w-4 mr-1" /> Escolher da galeria
                </Button>
              )}
              <Button
                variant="outline"
                size="sm"
                onClick={() => fileRef.current?.click()}
                disabled={uploading}
              >
                {uploading ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Upload className="h-4 w-4 mr-1" />}
                Fazer upload
              </Button>
              <input
                ref={fileRef}
                type="file"
                className="hidden"
                accept={MEDIA_LIMITS[form.headerType]?.accept}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) handleFileUpload(file);
                  e.target.value = "";
                }}
              />
            </div>
          )}
        </div>
      )}
    </div>
  );

  const renderStep2 = () => (
    <div className="space-y-4">
      <div>
        <div className="flex items-center justify-between">
          <Label>Corpo da mensagem (max 1024 chars)</Label>
          <Button variant="ghost" size="sm" onClick={insertVariable} className="h-7 text-xs">
            <Plus className="h-3 w-3 mr-1" /> Inserir variavel
          </Button>
        </div>
        <Textarea
          ref={bodyRef}
          value={form.bodyText}
          onChange={(e) => setForm((prev) => ({ ...prev, bodyText: e.target.value }))}
          maxLength={1024}
          rows={5}
          placeholder="Ola {{1}}, temos uma oferta especial para voce! Aproveite {{2}} de desconto."
        />
        <p className="text-xs text-muted-foreground mt-1">{form.bodyText.length}/1024</p>
      </div>

      {bodyVars.length > 0 && (
        <div className="space-y-2">
          <Label className="text-xs">Exemplos das variaveis (obrigatorio para revisao da Meta)</Label>
          {bodyVars.map((v) => (
            <div key={v} className="flex items-center gap-2">
              <Badge variant="secondary" className="shrink-0">{v}</Badge>
              <Input
                value={form.bodyExamples[v] || ""}
                onChange={(e) =>
                  setForm((prev) => ({
                    ...prev,
                    bodyExamples: { ...prev.bodyExamples, [v]: e.target.value },
                  }))
                }
                placeholder={`Exemplo para ${v}`}
                className="h-8 text-sm"
              />
            </div>
          ))}
        </div>
      )}

      <div>
        <Label>Rodape (opcional, max 60 chars)</Label>
        <Input
          value={form.footerText}
          onChange={(e) => setForm((prev) => ({ ...prev, footerText: e.target.value }))}
          maxLength={60}
          placeholder="Ex: Responda SAIR para nao receber mais"
        />
        {form.footerText && (
          <p className="text-xs text-muted-foreground mt-1">{form.footerText.length}/60</p>
        )}
      </div>
    </div>
  );

  const renderStep3 = () => (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <Label>Botoes (opcional)</Label>
        <p className="text-xs text-muted-foreground">{form.buttons.length}/10</p>
      </div>

      {form.buttons.length < 10 && (
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => addButton("URL")} disabled={form.buttons.filter((b) => b.type === "URL").length >= 2}>
            <Link className="h-3.5 w-3.5 mr-1" /> URL
          </Button>
          <Button variant="outline" size="sm" onClick={() => addButton("QUICK_REPLY")}>
            <MessageSquare className="h-3.5 w-3.5 mr-1" /> Resposta Rapida
          </Button>
          <Button variant="outline" size="sm" onClick={() => addButton("PHONE_NUMBER")} disabled={form.buttons.some((b) => b.type === "PHONE_NUMBER")}>
            <Phone className="h-3.5 w-3.5 mr-1" /> Telefone
          </Button>
        </div>
      )}

      {form.buttons.map((btn, i) => (
        <div key={i} className="border rounded-lg p-3 space-y-2">
          <div className="flex items-center justify-between">
            <Badge variant="outline" className="text-xs">
              {btn.type === "URL" ? "URL" : btn.type === "QUICK_REPLY" ? "Resposta Rapida" : "Telefone"}
            </Badge>
            <Button variant="ghost" size="sm" className="h-6 w-6 p-0 text-destructive" onClick={() => removeButton(i)}>
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>

          <Input
            value={btn.text}
            onChange={(e) => updateButton(i, { text: e.target.value })}
            placeholder="Texto do botao"
            maxLength={btn.type === "QUICK_REPLY" ? 25 : 25}
            className="h-8 text-sm"
          />

          {btn.type === "URL" && (
            <div className="space-y-2">
              <Input
                value={btn.url || ""}
                onChange={(e) => updateButton(i, { url: e.target.value })}
                placeholder="https://seusite.com/pagina"
                className="h-8 text-sm"
              />
              <label className="flex items-center gap-2 text-xs cursor-pointer">
                <input
                  type="checkbox"
                  checked={btn.addUtm}
                  onChange={(e) => updateButton(i, { addUtm: e.target.checked })}
                  className="rounded"
                />
                Adicionar UTMs automaticos
              </label>
              {btn.url && (
                <p className="text-[11px] text-muted-foreground break-all bg-muted/50 rounded px-2 py-1">
                  {btn.addUtm ? buildUtmUrl(btn.url, slug) : btn.url}
                </p>
              )}
              {btn.url?.includes("{{1}}") && (
                <Input
                  value={btn.urlExample || ""}
                  onChange={(e) => updateButton(i, { urlExample: e.target.value })}
                  placeholder="Exemplo para {{1}} na URL"
                  className="h-8 text-sm"
                />
              )}
            </div>
          )}

          {btn.type === "PHONE_NUMBER" && (
            <Input
              value={btn.phoneNumber || ""}
              onChange={(e) => updateButton(i, { phoneNumber: e.target.value })}
              placeholder="+5511999998888"
              className="h-8 text-sm"
            />
          )}
        </div>
      ))}

      {form.buttons.length === 0 && (
        <p className="text-sm text-muted-foreground text-center py-4">
          Nenhum botao adicionado. Botoes sao opcionais.
        </p>
      )}
    </div>
  );

  const renderStep4 = () => {
    if (submitted) {
      return (
        <div className="text-center space-y-3 py-6">
          <div className="mx-auto w-12 h-12 rounded-full bg-amber-500/10 flex items-center justify-center">
            <Clock className="h-6 w-6 text-amber-500" />
          </div>
          <h3 className="font-semibold text-lg">Template enviado para revisao</h3>
          <p className="text-sm text-muted-foreground max-w-sm mx-auto">
            O template <code className="bg-muted px-1 rounded">{slug}</code> foi criado e esta aguardando
            aprovacao da Meta. Isso pode levar ate 24h.
          </p>
          <Badge variant="secondary" className="gap-1">
            <Clock className="h-3 w-3" /> PENDING
          </Badge>
        </div>
      );
    }

    return (
      <div className="space-y-4">
        {/* Phone mockup preview */}
        <div className="mx-auto max-w-xs border-2 rounded-2xl overflow-hidden bg-[#e5ddd5]">
          <div className="bg-[#075e54] text-white text-center py-2 text-xs font-medium">
            Preview
          </div>
          <div className="p-3 space-y-1">
            <div className="bg-white rounded-lg shadow-sm overflow-hidden max-w-[85%]">
              {/* Header preview */}
              {form.headerType === "IMAGE" && form.headerMediaUrl && (
                <img src={form.headerMediaUrl} alt="" className="w-full h-32 object-cover" />
              )}
              {form.headerType === "VIDEO" && form.headerMediaUrl && (
                <div className="w-full h-32 bg-gray-800 flex items-center justify-center">
                  <Video className="h-8 w-8 text-white/60" />
                </div>
              )}
              {form.headerType === "DOCUMENT" && form.headerMediaUrl && (
                <div className="w-full h-16 bg-gray-100 flex items-center justify-center gap-2 text-xs text-gray-500">
                  <FileText className="h-5 w-5" /> {form.headerMediaFilename}
                </div>
              )}
              {form.headerType === "TEXT" && form.headerText && (
                <p className="px-2 pt-2 text-sm font-semibold">{form.headerText}</p>
              )}

              {/* Body */}
              <p className="px-2 py-1.5 text-sm whitespace-pre-wrap">{form.bodyText || "..."}</p>

              {/* Footer */}
              {form.footerText && (
                <p className="px-2 pb-1.5 text-[11px] text-gray-400">{form.footerText}</p>
              )}

              {/* Buttons */}
              {form.buttons.length > 0 && (
                <div className="border-t">
                  {form.buttons.map((b, i) => (
                    <div key={i} className="text-center py-1.5 text-sm text-[#00a5f4] border-b last:border-b-0">
                      {b.text || "Botao"}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Summary */}
        <div className="space-y-2 text-sm">
          <div className="flex justify-between">
            <span className="text-muted-foreground">Nome</span>
            <code className="bg-muted px-1.5 rounded text-xs">{slug}</code>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Categoria</span>
            <Badge variant="outline">{form.category}</Badge>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Idioma</span>
            <span>{LANGUAGES.find((l) => l.value === form.language)?.label}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Header</span>
            <span>{form.headerType === "NONE" ? "Nenhum" : form.headerType}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Botoes</span>
            <span>{form.buttons.length}</span>
          </div>
        </div>

        <div className="bg-amber-500/10 border border-amber-500/20 rounded-lg p-3 text-xs text-amber-700">
          <AlertCircle className="h-3.5 w-3.5 inline mr-1" />
          O template sera enviado para revisao da Meta. Pode levar ate 24h para aprovacao.
        </div>
      </div>
    );
  };

  const renderCurrentStep = () => {
    switch (step) {
      case 0: return renderStep0();
      case 1: return renderStep1();
      case 2: return renderStep2();
      case 3: return renderStep3();
      case 4: return renderStep4();
      default: return null;
    }
  };

  return (
    <>
      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent className="max-w-lg max-h-[85vh] flex flex-col">
          <DialogHeader>
            <DialogTitle>Criar Template WhatsApp</DialogTitle>
            <DialogDescription>
              {submitted ? "Template criado com sucesso" : `Etapa ${step + 1} de ${STEPS.length}: ${STEPS[step].label}`}
            </DialogDescription>
          </DialogHeader>

          {/* Step indicators */}
          {!submitted && (
            <div className="flex items-center gap-1 justify-center">
              {STEPS.map((s, i) => (
                <div
                  key={i}
                  className={`h-1.5 rounded-full transition-all ${
                    i === step ? "w-8 bg-primary" : i < step ? "w-6 bg-primary/40" : "w-6 bg-muted"
                  }`}
                />
              ))}
            </div>
          )}

          {/* Error */}
          {error && (
            <div className="bg-destructive/10 border border-destructive/20 rounded-lg px-3 py-2 text-sm text-destructive">
              {error}
            </div>
          )}

          {/* Content */}
          <div className="flex-1 overflow-y-auto px-1">
            {renderCurrentStep()}
          </div>

          {/* Navigation */}
          <div className="flex items-center justify-between pt-3 border-t">
            {submitted ? (
              <div className="ml-auto">
                <Button onClick={() => handleOpenChange(false)}>Fechar</Button>
              </div>
            ) : (
              <>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setStep((s) => s - 1)}
                  disabled={step === 0}
                >
                  <ChevronLeft className="h-4 w-4 mr-1" /> Voltar
                </Button>

                {step < STEPS.length - 1 ? (
                  <Button
                    size="sm"
                    onClick={() => { setError(""); setStep((s) => s + 1); }}
                    disabled={!canAdvance()}
                  >
                    Proximo <ChevronRight className="h-4 w-4 ml-1" />
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    onClick={handleSubmit}
                    disabled={submitting || !canAdvance()}
                  >
                    {submitting ? (
                      <><Loader2 className="h-4 w-4 animate-spin mr-1" /> Criando...</>
                    ) : (
                      <><CheckCircle2 className="h-4 w-4 mr-1" /> Criar Template</>
                    )}
                  </Button>
                )}
              </>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Gallery picker for image header */}
      {workspaceId && (
        <GalleryPicker
          open={galleryOpen}
          onOpenChange={setGalleryOpen}
          workspaceId={workspaceId}
          onSelect={handleGallerySelect}
        />
      )}
    </>
  );
}
