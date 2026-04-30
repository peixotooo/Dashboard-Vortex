"use client";
import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
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
import type { EmailSuggestion } from "@/lib/email-templates/types";

const SLOT_LABEL: Record<number, string> = { 1: "Best-seller", 2: "Sem-giro", 3: "Novidade" };

export function HistoryTable({ workspaceId }: { workspaceId: string }) {
  const [items, setItems] = useState<EmailSuggestion[]>([]);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState<string>("");
  const [slot, setSlot] = useState<string>("");

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
          </TableRow>
        </TableHeader>
        <TableBody>
          {loading && (
            <TableRow>
              <TableCell colSpan={5}>Carregando...</TableCell>
            </TableRow>
          )}
          {!loading && items.length === 0 && (
            <TableRow>
              <TableCell colSpan={5} className="text-muted-foreground">
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
              </TableCell>
              <TableCell>
                <Badge variant={s.status === "sent" ? "default" : "secondary"}>
                  {s.status}
                </Badge>
              </TableCell>
              <TableCell>
                {s.sent_at ? new Date(s.sent_at).toLocaleString("pt-BR") : "—"}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
