"use client";
import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Eye, RotateCcw, Loader2 } from "lucide-react";
import type { EmailSuggestion } from "@/lib/email-templates/types";

const SLOT_LABEL: Record<number, string> = { 1: "Best-seller", 2: "Sem-giro", 3: "Novidade" };

export function HistoryTable({ workspaceId }: { workspaceId: string }) {
  const [items, setItems] = useState<EmailSuggestion[]>([]);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState<string>("");
  const [slot, setSlot] = useState<string>("");
  const [previewHtml, setPreviewHtml] = useState<string | null>(null);
  const [reactivating, setReactivating] = useState<EmailSuggestion | null>(null);

  useEffect(() => {
    setLoading(true);
    const params = new URLSearchParams({ days: "30" });
    if (status) params.set("status", status);
    if (slot) params.set("slot", slot);
    fetch(`/api/crm/email-templates/history?${params}`, {
      headers: { "x-workspace-id": workspaceId },
    })
      .then((r) => r.json())
      .then((d) => setItems(d.suggestions ?? []))
      .finally(() => setLoading(false));
  }, [status, slot, workspaceId]);

  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <Select value={status} onValueChange={(v) => setStatus(v === "all" ? "" : v)}>
          <SelectTrigger className="w-40">
            <SelectValue placeholder="Estado" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos</SelectItem>
            <SelectItem value="pending">Pending</SelectItem>
            <SelectItem value="selected">Selected</SelectItem>
            <SelectItem value="sent">Sent</SelectItem>
          </SelectContent>
        </Select>
        <Select value={slot} onValueChange={(v) => setSlot(v === "all" ? "" : v)}>
          <SelectTrigger className="w-40">
            <SelectValue placeholder="Slot" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos</SelectItem>
            <SelectItem value="1">1 — Best-seller</SelectItem>
            <SelectItem value="2">2 — Sem-giro</SelectItem>
            <SelectItem value="3">3 — Novidade</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Data</TableHead>
            <TableHead>Slot</TableHead>
            <TableHead>Produto</TableHead>
            <TableHead>Estado</TableHead>
            <TableHead>Disparado em</TableHead>
            <TableHead className="text-right">Ações</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {loading && (
            <TableRow>
              <TableCell colSpan={6}>Carregando...</TableCell>
            </TableRow>
          )}
          {!loading && items.length === 0 && (
            <TableRow>
              <TableCell colSpan={6} className="text-muted-foreground">
                Sem histórico
              </TableCell>
            </TableRow>
          )}
          {items.map((s) => (
            <TableRow key={s.id}>
              <TableCell>{s.generated_for_date}</TableCell>
              <TableCell>{SLOT_LABEL[s.slot]}</TableCell>
              <TableCell className="max-w-xs truncate">
                {s.product_snapshot.name}
                {s.coupon_code && (
                  <span className="ml-2 text-[10px] font-mono text-emerald-600 dark:text-emerald-400">
                    🎟 {s.coupon_code}
                  </span>
                )}
              </TableCell>
              <TableCell>
                <Badge variant={s.status === "sent" ? "default" : "secondary"}>
                  {s.status}
                </Badge>
              </TableCell>
              <TableCell>
                {s.sent_at ? new Date(s.sent_at).toLocaleString("pt-BR") : "—"}
              </TableCell>
              <TableCell className="text-right">
                <div className="flex items-center justify-end gap-1">
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 px-2 text-xs gap-1"
                    onClick={() => setPreviewHtml(s.rendered_html)}
                    title="Pré-visualizar"
                  >
                    <Eye className="w-3 h-3" />
                    Preview
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 px-2 text-xs gap-1"
                    onClick={() => setReactivating(s)}
                    title="Reativar com cupom + countdown novos"
                  >
                    <RotateCcw className="w-3 h-3" />
                    Reativar
                  </Button>
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      <Sheet open={previewHtml !== null} onOpenChange={(o) => !o && setPreviewHtml(null)}>
        <SheetContent side="right" className="w-full sm:max-w-2xl p-0">
          <SheetTitle className="sr-only">Preview do email histórico</SheetTitle>
          {previewHtml && (
            <iframe
              srcDoc={previewHtml}
              sandbox=""
              title="Preview histórico"
              className="w-full h-full border-0"
            />
          )}
        </SheetContent>
      </Sheet>

      <ReactivateDialog
        suggestion={reactivating}
        workspaceId={workspaceId}
        onClose={() => setReactivating(null)}
      />
    </div>
  );
}

function ReactivateDialog({
  suggestion,
  workspaceId,
  onClose,
}: {
  suggestion: EmailSuggestion | null;
  workspaceId: string;
  onClose: () => void;
}) {
  const [hours, setHours] = useState(48);
  const [discountPct, setDiscountPct] = useState<number>(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (suggestion) {
      setHours(48);
      setDiscountPct(suggestion.coupon_discount_percent ?? 10);
      setError(null);
      setLoading(false);
    }
  }, [suggestion]);

  if (!suggestion) return null;
  const hadCoupon = !!suggestion.coupon_code;

  const submit = async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await fetch(
        `/api/crm/email-templates/${suggestion.id}/reactivate`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-workspace-id": workspaceId,
          },
          body: JSON.stringify({
            coupon_hours: hours,
            coupon_discount_percent: hadCoupon ? discountPct : undefined,
          }),
        }
      );
      const d = await r.json();
      if (!r.ok || !d.draft?.id) {
        throw new Error(d.error ?? "Falha ao reativar");
      }
      window.location.href = `/crm/email-templates/editor/${d.draft.id}`;
    } catch (err) {
      setError((err as Error).message);
      setLoading(false);
    }
  };

  return (
    <Dialog open={!!suggestion} onOpenChange={(o) => !o && !loading && onClose()}>
      <DialogContent className="max-w-md">
        <DialogTitle className="flex items-center gap-2">
          <RotateCcw className="w-4 h-4" />
          Reativar email
        </DialogTitle>
        <p className="text-xs text-muted-foreground -mt-2">
          Cria um novo draft com o produto e a copy desse email histórico.
          {hadCoupon
            ? " Cupom e countdown serão regerados — código novo e prazo novo."
            : " Sem cupom, sem countdown."}
        </p>

        <div className="border rounded-md p-3 bg-muted/30 space-y-1">
          <div className="text-xs font-medium truncate">
            {suggestion.product_snapshot.name}
          </div>
          <div className="text-[10px] text-muted-foreground">
            {SLOT_LABEL[suggestion.slot]} · gerado em {suggestion.generated_for_date}
          </div>
        </div>

        {hadCoupon && (
          <div className="space-y-3 pt-1">
            <div className="space-y-1">
              <Label className="text-xs">% off do novo cupom</Label>
              <Input
                type="number"
                value={discountPct}
                onChange={(e) => setDiscountPct(parseFloat(e.target.value) || 0)}
                disabled={loading}
                className="h-8 text-xs"
              />
              <p className="text-[10px] text-muted-foreground">
                Original era {suggestion.coupon_discount_percent ?? 10}% off.
              </p>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Termina em (horas)</Label>
              <Input
                type="number"
                value={hours}
                onChange={(e) => setHours(parseFloat(e.target.value) || 0)}
                disabled={loading}
                className="h-8 text-xs"
              />
              <div className="grid grid-cols-5 gap-1 pt-1">
                {[6, 24, 48, 72, 168].map((h) => (
                  <Button
                    key={h}
                    size="sm"
                    variant={hours === h ? "default" : "outline"}
                    className="h-7 text-[11px]"
                    disabled={loading}
                    onClick={() => setHours(h)}
                  >
                    {h < 168 ? `${h}h` : "7d"}
                  </Button>
                ))}
              </div>
            </div>
          </div>
        )}

        {error && (
          <div className="text-xs text-destructive p-2 border border-destructive/30 rounded bg-destructive/5">
            {error}
          </div>
        )}

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" size="sm" onClick={onClose} disabled={loading}>
            Cancelar
          </Button>
          <Button size="sm" onClick={submit} disabled={loading} className="gap-1.5">
            {loading ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <RotateCcw className="w-3.5 h-3.5" />
            )}
            {loading ? "Reativando..." : "Criar draft + abrir editor"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
