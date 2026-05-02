"use client";
import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import type { TemplateData } from "@/lib/email-templates/editor/schema";
import { ProductPicker, type PickedProduct } from "./product-picker";
import { Trash2, Ticket, X } from "lucide-react";

interface Props {
  data: TemplateData;
  workspaceId: string;
  layoutId?: string;
  onChange: (next: TemplateData) => void;
}

export function TemplateModeEditor({ data, workspaceId, onChange }: Props) {
  const setCopy = (patch: Partial<TemplateData["copy"]>) => {
    onChange({ ...data, copy: { ...data.copy, ...patch } });
  };
  const setProduct = (p: PickedProduct) => {
    onChange({
      ...data,
      product: {
        vnda_id: p.vnda_id,
        name: p.name,
        price: p.price,
        old_price: p.old_price,
        image_url: p.image_url,
        url: p.url,
      },
      // Auto-retarget the CTA if it was empty or pointing to brand homepage.
      copy: {
        ...data.copy,
        cta_url:
          !data.copy.cta_url || /bulking\.com\.br\/?$/i.test(data.copy.cta_url)
            ? p.url
            : data.copy.cta_url,
      },
    });
  };
  const replaceRelated = (idx: number, p: PickedProduct) => {
    const next = [...data.related];
    next[idx] = {
      vnda_id: p.vnda_id,
      name: p.name,
      price: p.price,
      old_price: p.old_price,
      image_url: p.image_url,
      url: p.url,
    };
    onChange({ ...data, related: next });
  };
  const removeRelated = (idx: number) => {
    onChange({ ...data, related: data.related.filter((_, i) => i !== idx) });
  };
  const addRelated = (p: PickedProduct) => {
    onChange({
      ...data,
      related: [
        ...data.related,
        {
          vnda_id: p.vnda_id,
          name: p.name,
          price: p.price,
          old_price: p.old_price,
          image_url: p.image_url,
          url: p.url,
        },
      ],
    });
  };

  const removeCoupon = () => onChange({ ...data, coupon: undefined });
  const addCoupon = () => {
    onChange({
      ...data,
      coupon: {
        code: `EMAIL-${Math.random().toString(36).slice(2, 7).toUpperCase()}`,
        discount_percent: 10,
        expires_at: new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString(),
      },
    });
  };

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
          Copy
        </div>
        <Field label="Eyebrow / hook">
          <Input
            value={data.copy.hook ?? ""}
            onChange={(e) => setCopy({ hook: e.target.value })}
          />
        </Field>
        <Field label="Headline">
          <Textarea
            rows={2}
            value={data.copy.headline}
            onChange={(e) => setCopy({ headline: e.target.value })}
          />
        </Field>
        <Field label="Lead / parágrafo">
          <Textarea
            rows={3}
            value={data.copy.lead}
            onChange={(e) => setCopy({ lead: e.target.value })}
          />
        </Field>
        <Field label="Texto do botão (CTA)">
          <Input
            value={data.copy.cta_text}
            onChange={(e) => setCopy({ cta_text: e.target.value })}
          />
        </Field>
        <Field label="URL do botão (CTA)">
          <Input
            value={data.copy.cta_url}
            onChange={(e) => setCopy({ cta_url: e.target.value })}
          />
        </Field>
      </div>

      <div className="space-y-2 border-t pt-5 -mx-1 px-1">
        <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
          Produto principal
        </div>
        <div className="flex items-center gap-2 border rounded-md p-2 bg-muted/30">
          <img
            src={data.product.image_url}
            alt={data.product.name}
            className="w-9 h-12 object-cover shrink-0"
          />
          <div className="min-w-0 flex-1">
            <div className="text-xs truncate">{data.product.name}</div>
            <div className="text-[10px] text-muted-foreground">
              R$ {data.product.price.toFixed(2)}
            </div>
          </div>
        </div>
        <ProductPicker
          workspaceId={workspaceId}
          label="Trocar produto"
          autoLoadInitial
          onPick={setProduct}
        />
      </div>

      <div className="space-y-2 border-t pt-5 -mx-1 px-1">
        <div className="flex items-center justify-between">
          <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
            Produtos relacionados ({data.related.length})
          </div>
        </div>
        <div className="text-[11px] text-muted-foreground">
          Layouts em grade (3×3, numbered) usam até 9. Outros usam 3.
        </div>
        <div className="space-y-1.5">
          {data.related.map((p, idx) => (
            <RelatedSlot
              key={`${idx}-${p.image_url}`}
              product={p}
              workspaceId={workspaceId}
              onReplace={(np) => replaceRelated(idx, np)}
              onRemove={() => removeRelated(idx)}
            />
          ))}
        </div>
        {data.related.length < 9 && (
          <ProductPicker
            workspaceId={workspaceId}
            label="Adicionar produto relacionado"
            autoLoadInitial
            onPick={addRelated}
          />
        )}
      </div>

      <div className="space-y-2 border-t pt-5 -mx-1 px-1">
        <div className="flex items-center justify-between">
          <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
            Cupom + countdown
          </div>
          {data.coupon ? (
            <Button size="sm" variant="ghost" className="h-7 text-xs gap-1.5" onClick={removeCoupon}>
              <X className="w-3 h-3" /> Remover
            </Button>
          ) : (
            <Button size="sm" variant="outline" className="h-7 text-xs gap-1.5" onClick={addCoupon}>
              <Ticket className="w-3 h-3" /> Adicionar
            </Button>
          )}
        </div>
        {data.coupon && (
          <CouponEditor
            coupon={data.coupon}
            onChange={(next) => onChange({ ...data, coupon: next })}
          />
        )}
      </div>
    </div>
  );
}

function CouponEditor({
  coupon,
  onChange,
}: {
  coupon: NonNullable<TemplateData["coupon"]>;
  onChange: (next: TemplateData["coupon"]) => void;
}) {
  const expiresDate = new Date(coupon.expires_at);
  const remainingHours = Math.max(0, Math.round((expiresDate.getTime() - Date.now()) / 3600000));
  const setHoursFromNow = (h: number) => {
    onChange({ ...coupon, expires_at: new Date(Date.now() + h * 3600000).toISOString() });
  };
  const localValue = (() => {
    const d = expiresDate;
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  })();

  return (
    <div className="space-y-2">
      <Field label="Código">
        <Input value={coupon.code} onChange={(e) => onChange({ ...coupon, code: e.target.value })} />
      </Field>
      <Field label="% de desconto">
        <Input
          type="number"
          value={coupon.discount_percent}
          onChange={(e) =>
            onChange({ ...coupon, discount_percent: parseFloat(e.target.value) || 0 })
          }
        />
      </Field>
      <Field label={`Termina em ${remainingHours}h`}>
        <div className="flex items-center gap-1.5">
          <Input
            type="datetime-local"
            value={localValue}
            onChange={(e) => {
              const d = new Date(e.target.value);
              if (!Number.isNaN(d.getTime())) onChange({ ...coupon, expires_at: d.toISOString() });
            }}
          />
        </div>
      </Field>
      <div className="grid grid-cols-5 gap-1">
        {[1, 6, 24, 48, 72].map((h) => (
          <Button
            key={h}
            size="sm"
            variant="outline"
            className="h-7 text-xs"
            onClick={() => setHoursFromNow(h)}
          >
            {h}h
          </Button>
        ))}
      </div>
    </div>
  );
}

function RelatedSlot({
  product,
  workspaceId,
  onReplace,
  onRemove,
}: {
  product: { name: string; price: number; image_url: string };
  workspaceId: string;
  onReplace: (p: PickedProduct) => void;
  onRemove: () => void;
}) {
  const [editing, setEditing] = useState(false);
  return (
    <div className="border rounded-md p-2 space-y-2">
      <div className="flex items-center gap-2">
        <img
          src={product.image_url}
          alt={product.name}
          className="w-8 h-10 object-cover shrink-0"
        />
        <div className="min-w-0 flex-1">
          <div className="text-xs truncate">{product.name}</div>
          <div className="text-[10px] text-muted-foreground">R$ {product.price.toFixed(2)}</div>
        </div>
        <Button
          size="sm"
          variant="ghost"
          className="h-7 px-2 text-[11px]"
          onClick={() => setEditing((v) => !v)}
        >
          {editing ? "Fechar" : "Trocar"}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="h-7 w-7 p-0 text-destructive hover:text-destructive"
          onClick={onRemove}
        >
          <Trash2 className="w-3 h-3" />
        </Button>
      </div>
      {editing && (
        <ProductPicker
          workspaceId={workspaceId}
          autoLoadInitial
          onPick={(p) => {
            onReplace(p);
            setEditing(false);
          }}
        />
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}
