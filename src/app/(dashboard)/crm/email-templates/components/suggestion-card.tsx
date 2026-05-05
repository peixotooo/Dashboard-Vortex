"use client";
import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { Eye, Copy, Check, Send, Pencil, Loader2, Zap } from "lucide-react";
import type { EmailSuggestion } from "@/lib/email-templates/types";
import { SentModal } from "./sent-modal";
import { SuggestionDispatchDialog } from "./suggestion-dispatch-dialog";

const SLOT_LABEL: Record<number, string> = {
  1: "Best-seller",
  2: "Sem-giro",
  3: "Novidade",
};

export function SuggestionCard({
  suggestion,
  onChanged,
  workspaceId,
}: {
  suggestion: EmailSuggestion;
  onChanged: () => void;
  workspaceId: string;
}) {
  const [copying, setCopying] = useState(false);
  const [copied, setCopied] = useState(false);
  const [sentOpen, setSentOpen] = useState(false);
  const [opening, setOpening] = useState(false);
  const [dispatchOpen, setDispatchOpen] = useState(false);

  async function openInEditor() {
    if (opening) return;
    setOpening(true);
    try {
      const r = await fetch(`/api/crm/email-templates/${suggestion.id}/to-draft`, {
        method: "POST",
        headers: { "x-workspace-id": workspaceId },
      });
      const d = await r.json();
      if (d.draft?.id) {
        window.location.href = `/crm/email-templates/editor/${d.draft.id}`;
      } else {
        alert(d.error ?? "Falha ao abrir no editor");
        setOpening(false);
      }
    } catch (err) {
      alert(`Falha ao abrir no editor: ${(err as Error).message}`);
      setOpening(false);
    }
  }

  async function copyHtml() {
    setCopying(true);
    try {
      await navigator.clipboard.writeText(suggestion.rendered_html);
      await fetch(`/api/crm/email-templates/${suggestion.id}/select`, {
        method: "POST",
        headers: { "x-workspace-id": workspaceId },
      });
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
      onChanged();
    } finally {
      setCopying(false);
    }
  }

  const segLabel =
    (suggestion.target_segment_payload as { display_label?: string })?.display_label ?? "—";
  const segSize =
    (suggestion.target_segment_payload as { estimated_size?: number })?.estimated_size ?? null;

  return (
    <Card className="p-4 flex flex-col gap-3">
      <div className="flex items-start justify-between gap-3">
        <div className="flex gap-3 flex-1 min-w-0">
          <img
            src={suggestion.product_snapshot.image_url}
            alt={suggestion.product_snapshot.name}
            className="w-20 h-24 object-cover rounded"
          />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1 flex-wrap">
              <Badge variant="outline">
                Slot {suggestion.slot} · {SLOT_LABEL[suggestion.slot]}
              </Badge>
              {suggestion.status === "selected" && (
                <Badge variant="secondary">Copiado {suggestion.selected_count}×</Badge>
              )}
              {suggestion.status === "sent" && <Badge>Disparado</Badge>}
            </div>
            <div className="font-semibold truncate">{suggestion.product_snapshot.name}</div>
            <div className="text-sm text-muted-foreground">
              R$ {suggestion.product_snapshot.price.toFixed(2)}
            </div>
            <div className="text-xs text-muted-foreground mt-1">
              {segLabel}
              {segSize != null && ` · ≈ ${segSize.toLocaleString("pt-BR")} contatos`}
            </div>
            <div className="text-xs text-muted-foreground">
              Horários sugeridos:{" "}
              {suggestion.recommended_hours
                .map((h) => String(h).padStart(2, "0") + ":00")
                .join(" · ")}
            </div>
            {suggestion.coupon_code && (
              <div className="text-xs text-emerald-500 mt-1 font-mono">
                🎟 {suggestion.coupon_code} · {suggestion.coupon_discount_percent}% off
                {suggestion.coupon_expires_at &&
                  ` · até ${new Date(suggestion.coupon_expires_at).toLocaleString("pt-BR")}`}
              </div>
            )}
          </div>
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        <Sheet>
          <SheetTrigger asChild>
            <Button variant="outline" size="sm">
              <Eye className="w-4 h-4 mr-1" /> Preview
            </Button>
          </SheetTrigger>
          <SheetContent side="right" className="w-full sm:max-w-2xl p-0">
            <iframe
              srcDoc={suggestion.rendered_html}
              className="w-full h-full border-0"
              sandbox=""
              title={`Preview ${suggestion.id}`}
            />
          </SheetContent>
        </Sheet>
        <Button size="sm" variant="outline" onClick={openInEditor} disabled={opening}>
          {opening ? (
            <Loader2 className="w-4 h-4 mr-1 animate-spin" />
          ) : (
            <Pencil className="w-4 h-4 mr-1" />
          )}
          {opening ? "Abrindo..." : "Editar"}
        </Button>
        <Button size="sm" variant="outline" onClick={copyHtml} disabled={copying}>
          {copied ? <Check className="w-4 h-4 mr-1" /> : <Copy className="w-4 h-4 mr-1" />}
          {copied ? "Copiado!" : "Copiar HTML"}
        </Button>
        <Button
          size="sm"
          onClick={() => setDispatchOpen(true)}
          className="gap-1.5"
        >
          <Zap className="w-4 h-4" /> Disparar
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setSentOpen(true)}>
          <Send className="w-4 h-4 mr-1" /> Marcar disparado
        </Button>
      </div>
      <SentModal
        open={sentOpen}
        onClose={() => setSentOpen(false)}
        suggestion={suggestion}
        workspaceId={workspaceId}
        onDone={() => {
          setSentOpen(false);
          onChanged();
        }}
      />
      <SuggestionDispatchDialog
        suggestion={dispatchOpen ? suggestion : null}
        workspaceId={workspaceId}
        onClose={() => {
          setDispatchOpen(false);
          onChanged();
        }}
      />
    </Card>
  );
}
