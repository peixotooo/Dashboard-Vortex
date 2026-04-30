# Email Templates Generator — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cron diário gera 3 sugestões de email marketing por workspace, cruzando VNDA × GA4 × CRM, e entrega HTML email-safe pronto para copiar+colar em sistema externo de email-mkt. UI em `/(dashboard)/crm/email-templates`.

**Architecture:** Espelha o padrão validado de `src/lib/coupons/*` — orchestrator único, libs puras isoladas (`picker`, `segments`, `hours`, `copy`, `coupon`, `countdown`, `audit`), 3 templates HTML em `src/lib/email-templates/templates/*` (best-seller / sem-giro / novidade). 3 tabelas Supabase (`email_template_settings`, `email_template_suggestions`, `email_template_audit`). API segue `api-auth.ts`. Countdown PNG self-hosted via `@vercel/og`.

**Tech Stack:** Next.js 16 (App Router) + Supabase + TypeScript + Tailwind + shadcn + `@vercel/og` + Resend (já configurado, não usado no MVP) + OpenRouter (hook futuro). Sem framework de testes — smoke verification via `npx tsx scripts/*.ts` + `npx tsc --noEmit`. Reutiliza `src/lib/vnda-api.ts`, `src/lib/ga4-api.ts`, `src/lib/coupons/vnda-coupons.ts`, `src/lib/crm-rfm.ts`, `src/lib/agent/llm-provider.ts`.

---

## File Structure

```
supabase/
  migration-066-email-templates.sql                       # CREATE (3 tables)

src/lib/email-templates/
  types.ts                                                 # CREATE — shared types
  settings.ts                                              # CREATE — get/upsert settings
  segments.ts                                              # CREATE — RFM resolver
  hours.ts                                                 # CREATE — top-3 GA4 hours
  picker.ts                                                # CREATE — slot pickers
  copy.ts                                                  # CREATE — copy provider (template + llm hook)
  coupon.ts                                                # CREATE — wraps createFullCoupon
  countdown.ts                                             # CREATE — signed URL builder
  audit.ts                                                 # CREATE — audit logger
  orchestrator.ts                                          # CREATE — daily entrypoint
  templates/
    shared.ts                                              # CREATE — header, footer, design tokens
    bestseller.ts                                          # CREATE — slot 1 render
    slowmoving.ts                                          # CREATE — slot 2 render (cupom + countdown)
    newarrival.ts                                          # CREATE — slot 3 render

src/app/api/
  cron/email-templates-refresh/route.ts                    # CREATE — cron 06:00 BRT
  email-countdown.png/route.ts                             # CREATE — public PNG endpoint
  crm/email-templates/
    active/route.ts                                        # CREATE — GET sugestões hoje
    history/route.ts                                       # CREATE — GET 30d
    settings/route.ts                                      # CREATE — GET/PUT settings
    [id]/route.ts                                          # CREATE — GET 1 sugestão
    [id]/select/route.ts                                   # CREATE — POST mark selected
    [id]/sent/route.ts                                     # CREATE — POST mark sent

src/app/(dashboard)/crm/email-templates/
  page.tsx                                                 # CREATE — main page (Hoje + Histórico tabs)
  components/
    suggestion-card.tsx                                    # CREATE
    sent-modal.tsx                                         # CREATE
    history-table.tsx                                      # CREATE
    settings-drawer.tsx                                    # CREATE

src/app/(dashboard)/crm/page.tsx                           # MODIFY — add link to email-templates
vercel.json                                                # MODIFY — add cron entry

scripts/
  test-email-templates-libs.ts                             # CREATE — smoke verification
  test-email-templates-orchestrator.ts                     # CREATE — e2e dry-run
```

**Boundaries enforced:**
- `orchestrator.ts` é o único com side-effects (DB writes, VNDA calls). Outras libs são puras.
- `audit.ts` centraliza inserts em `email_template_audit`.
- Templates retornam `string` HTML; orchestrator persiste em `rendered_html`.

---

## Phase 0 — Database & Types Foundation

### Task 1: Create migration 066 — `email_templates` tables

**Files:**
- Create: `supabase/migration-066-email-templates.sql`

- [ ] **Step 1: Write the migration SQL**

```sql
-- supabase/migration-066-email-templates.sql

-- 1. Settings per workspace ---------------------------------------------------
create table if not exists email_template_settings (
  workspace_id uuid primary key references workspaces(id) on delete cascade,
  enabled boolean not null default false,
  bestseller_lookback_days int not null default 7,
  slowmoving_lookback_days int not null default 30,
  newarrival_lookback_days int not null default 14,
  min_stock_bestseller int not null default 5,
  slowmoving_max_sales int not null default 3,
  slowmoving_discount_percent numeric not null default 10,
  slowmoving_coupon_validity_hours int not null default 48,
  copy_provider text not null default 'template'
    check (copy_provider in ('template','llm')),
  llm_agent_slug text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 2. Suggestions (3 per workspace per day) -----------------------------------
create table if not exists email_template_suggestions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  generated_for_date date not null,
  slot smallint not null check (slot in (1,2,3)),

  vnda_product_id text not null,
  product_snapshot jsonb not null,

  target_segment_type text not null
    check (target_segment_type in ('rfm','attribute')),
  target_segment_payload jsonb not null,

  copy jsonb not null,
  copy_provider text not null,
  rendered_html text not null,

  recommended_hours int[] not null,
  hours_score jsonb,

  coupon_code text,
  coupon_vnda_promotion_id bigint,
  coupon_vnda_coupon_id bigint,
  coupon_expires_at timestamptz,
  coupon_discount_percent numeric,

  status text not null default 'pending'
    check (status in ('pending','selected','sent')),
  selected_at timestamptz,
  selected_count int not null default 0,
  sent_at timestamptz,
  sent_hour_chosen int check (sent_hour_chosen between 0 and 23),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique(workspace_id, generated_for_date, slot)
);

create index if not exists email_template_suggestions_ws_date_idx
  on email_template_suggestions(workspace_id, generated_for_date desc);
create index if not exists email_template_suggestions_ws_status_idx
  on email_template_suggestions(workspace_id, status, generated_for_date desc);

-- 3. Audit log ---------------------------------------------------------------
create table if not exists email_template_audit (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  suggestion_id uuid references email_template_suggestions(id) on delete cascade,
  event text not null,
  payload jsonb,
  created_at timestamptz not null default now()
);

create index if not exists email_template_audit_ws_idx
  on email_template_audit(workspace_id, created_at desc);
create index if not exists email_template_audit_suggestion_idx
  on email_template_audit(suggestion_id);
```

- [ ] **Step 2: Apply migration to Supabase**

Run via Supabase SQL editor (matching existing project workflow — migrations are applied manually):
```bash
# Manually paste supabase/migration-066-email-templates.sql in the SQL editor and execute.
# Verify with:
psql "$SUPABASE_DB_URL" -c "\dt email_template_*"
```
Expected output: 3 tables listed.

- [ ] **Step 3: Commit**

```bash
git add supabase/migration-066-email-templates.sql
git commit -m "feat(email-templates): migration 066 — settings/suggestions/audit tables"
```

---

### Task 2: Create `types.ts` — shared TypeScript types

**Files:**
- Create: `src/lib/email-templates/types.ts`

- [ ] **Step 1: Write the types file**

```ts
// src/lib/email-templates/types.ts

export type Slot = 1 | 2 | 3;

export type CopyProvider = "template" | "llm";

export type SuggestionStatus = "pending" | "selected" | "sent";

export type SegmentType = "rfm" | "attribute";

export interface ResolvedSegment {
  type: SegmentType;
  payload: { rfm_classes?: string[]; [k: string]: unknown };
  estimated_size: number;
  display_label: string;
}

export interface ProductSnapshot {
  vnda_id: string;
  name: string;
  price: number;
  old_price?: number;
  image_url: string;
  url: string;
  description?: string;
  tags?: string[];
}

export interface CopyOutput {
  subject: string;
  headline: string;
  lead: string;
  cta_text: string;
  cta_url: string;
}

export interface CopyInput {
  slot: Slot;
  product: ProductSnapshot;
  segment: ResolvedSegment;
  coupon?: { code: string; discount_percent: number; expires_at: Date };
  workspace_id: string;
}

export interface CopyProviderImpl {
  generate(input: CopyInput): Promise<CopyOutput>;
}

export interface HoursPick {
  recommended_hours: number[]; // length 3, values 0..23
  hours_score: Record<string, number>;
}

export interface EmailTemplateSettings {
  workspace_id: string;
  enabled: boolean;
  bestseller_lookback_days: number;
  slowmoving_lookback_days: number;
  newarrival_lookback_days: number;
  min_stock_bestseller: number;
  slowmoving_max_sales: number;
  slowmoving_discount_percent: number;
  slowmoving_coupon_validity_hours: number;
  copy_provider: CopyProvider;
  llm_agent_slug: string | null;
}

export interface EmailSuggestion {
  id: string;
  workspace_id: string;
  generated_for_date: string;
  slot: Slot;
  vnda_product_id: string;
  product_snapshot: ProductSnapshot;
  target_segment_type: SegmentType;
  target_segment_payload: Record<string, unknown>;
  copy: CopyOutput;
  copy_provider: CopyProvider;
  rendered_html: string;
  recommended_hours: number[];
  hours_score: Record<string, number> | null;
  coupon_code: string | null;
  coupon_vnda_promotion_id: number | null;
  coupon_vnda_coupon_id: number | null;
  coupon_expires_at: string | null;
  coupon_discount_percent: number | null;
  status: SuggestionStatus;
  selected_at: string | null;
  selected_count: number;
  sent_at: string | null;
  sent_hour_chosen: number | null;
  created_at: string;
  updated_at: string;
}

export interface TemplateRenderContext {
  product: ProductSnapshot;
  copy: CopyOutput;
  coupon?: { code: string; discount_percent: number; expires_at: Date; countdown_url: string };
  workspace: { name: string; logo_url?: string };
}
```

- [ ] **Step 2: Type-check**

```bash
npx tsc --noEmit
```
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/email-templates/types.ts
git commit -m "feat(email-templates): shared types"
```

---

### Task 3: Create `settings.ts` — get/upsert settings

**Files:**
- Create: `src/lib/email-templates/settings.ts`

- [ ] **Step 1: Write settings.ts**

```ts
// src/lib/email-templates/settings.ts
import { createAdminClient } from "@/lib/supabase-admin";
import type { EmailTemplateSettings } from "./types";

const DEFAULTS: Omit<EmailTemplateSettings, "workspace_id"> = {
  enabled: false,
  bestseller_lookback_days: 7,
  slowmoving_lookback_days: 30,
  newarrival_lookback_days: 14,
  min_stock_bestseller: 5,
  slowmoving_max_sales: 3,
  slowmoving_discount_percent: 10,
  slowmoving_coupon_validity_hours: 48,
  copy_provider: "template",
  llm_agent_slug: null,
};

export function getDefaults(workspace_id: string): EmailTemplateSettings {
  return { workspace_id, ...DEFAULTS };
}

export async function getSettings(
  workspace_id: string
): Promise<EmailTemplateSettings> {
  const supabase = createAdminClient();
  const { data } = await supabase
    .from("email_template_settings")
    .select("*")
    .eq("workspace_id", workspace_id)
    .maybeSingle();
  if (!data) return getDefaults(workspace_id);
  return data as EmailTemplateSettings;
}

export async function upsertSettings(
  patch: Partial<EmailTemplateSettings> & { workspace_id: string }
): Promise<EmailTemplateSettings> {
  // Enforce ranges
  if (patch.slowmoving_discount_percent !== undefined) {
    if (patch.slowmoving_discount_percent < 5 || patch.slowmoving_discount_percent > 20) {
      throw new Error("slowmoving_discount_percent must be between 5 and 20");
    }
  }
  if (patch.slowmoving_coupon_validity_hours !== undefined) {
    if (patch.slowmoving_coupon_validity_hours < 12 || patch.slowmoving_coupon_validity_hours > 168) {
      throw new Error("slowmoving_coupon_validity_hours must be between 12 and 168");
    }
  }

  const supabase = createAdminClient();
  const merged = { ...getDefaults(patch.workspace_id), ...patch, updated_at: new Date().toISOString() };
  const { data, error } = await supabase
    .from("email_template_settings")
    .upsert(merged, { onConflict: "workspace_id" })
    .select()
    .single();
  if (error) throw error;
  return data as EmailTemplateSettings;
}

export async function listEnabledWorkspaces(): Promise<string[]> {
  const supabase = createAdminClient();
  const { data } = await supabase
    .from("email_template_settings")
    .select("workspace_id")
    .eq("enabled", true);
  return (data ?? []).map((r) => r.workspace_id as string);
}
```

- [ ] **Step 2: Type-check**

```bash
npx tsc --noEmit
```
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/email-templates/settings.ts
git commit -m "feat(email-templates): settings get/upsert with default values"
```

---

## Phase 1 — Pure Libs

### Task 4: Create `audit.ts` — event logger

**Files:**
- Create: `src/lib/email-templates/audit.ts`

- [ ] **Step 1: Write audit.ts**

```ts
// src/lib/email-templates/audit.ts
import { createAdminClient } from "@/lib/supabase-admin";

export type AuditEvent =
  | "generated"
  | "skipped_no_product"
  | "skipped_no_ga4"
  | "skipped_no_vnda"
  | "copy_failed"
  | "coupon_created"
  | "coupon_failed"
  | "render_failed"
  | "selected"
  | "sent";

export async function logAudit(args: {
  workspace_id: string;
  suggestion_id?: string | null;
  event: AuditEvent;
  payload?: Record<string, unknown>;
}): Promise<void> {
  const supabase = createAdminClient();
  await supabase.from("email_template_audit").insert({
    workspace_id: args.workspace_id,
    suggestion_id: args.suggestion_id ?? null,
    event: args.event,
    payload: args.payload ?? null,
  });
}

export async function listRecentAudit(workspace_id: string, hours = 24) {
  const since = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
  const supabase = createAdminClient();
  const { data } = await supabase
    .from("email_template_audit")
    .select("*")
    .eq("workspace_id", workspace_id)
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(200);
  return data ?? [];
}
```

- [ ] **Step 2: Type-check + commit**

```bash
npx tsc --noEmit
git add src/lib/email-templates/audit.ts
git commit -m "feat(email-templates): audit logger"
```

---

### Task 5: Create `hours.ts` — top-3 horários via GA4

**Files:**
- Create: `src/lib/email-templates/hours.ts`

- [ ] **Step 1: Read the existing GA4 lib to confirm API**

```bash
grep -E "export (async )?function" src/lib/ga4-api.ts | head -20
```

Expected: confirms `runReport` or `getHourlyTraffic`-style export. Use whichever is available (e.g., `runReport({ workspace_id, dimensions: ["hour"], metrics: ["sessions","conversions"], date_range_days: 14 })`).

- [ ] **Step 2: Write hours.ts**

```ts
// src/lib/email-templates/hours.ts
import { runGa4Report } from "@/lib/ga4-api";
import type { HoursPick } from "./types";

const FALLBACK: HoursPick = {
  recommended_hours: [9, 14, 20],
  hours_score: { "9": 0, "14": 0, "20": 0 },
};

const MIN_SESSIONS_PER_HOUR = 30; // dev signal threshold

export async function pickTopHours(
  workspace_id: string,
  lookback_days = 14
): Promise<HoursPick> {
  let rows: Array<{ hour: string; sessions: number; conversions: number }> = [];
  try {
    const report = await runGa4Report({
      workspace_id,
      dimensions: ["hour"],
      metrics: ["sessions", "conversions"],
      date_range_days: lookback_days,
    });
    rows = (report?.rows ?? []).map((r: any) => ({
      hour: String(r.dimensions?.hour ?? "").padStart(2, "0"),
      sessions: Number(r.metrics?.sessions ?? 0),
      conversions: Number(r.metrics?.conversions ?? 0),
    }));
  } catch {
    return FALLBACK;
  }
  if (rows.length === 0) return FALLBACK;

  // Aggregate by hour-of-day (rows can already be per hour but defensively sum)
  const buckets: Record<number, { s: number; c: number }> = {};
  for (let h = 0; h < 24; h++) buckets[h] = { s: 0, c: 0 };
  for (const r of rows) {
    const h = parseInt(r.hour, 10);
    if (Number.isNaN(h) || h < 0 || h > 23) continue;
    buckets[h].s += r.sessions;
    buckets[h].c += r.conversions;
  }

  const scored = Object.entries(buckets).map(([h, v]) => {
    const conv_rate = v.s > 0 ? v.c / v.s : 0;
    const significant = v.s >= MIN_SESSIONS_PER_HOUR ? 1 : 0.85;
    return { hour: parseInt(h, 10), score: conv_rate * significant, sessions: v.s };
  });

  // Sort desc by score
  scored.sort((a, b) => b.score - a.score || b.sessions - a.sessions);

  // Pick with dispersion: ≥3h gap between picks
  const picks: number[] = [];
  for (const s of scored) {
    if (picks.length >= 3) break;
    if (picks.every((p) => Math.abs(p - s.hour) >= 3)) {
      picks.push(s.hour);
    }
  }

  if (picks.length < 3) return FALLBACK;

  picks.sort((a, b) => a - b);
  const score: Record<string, number> = {};
  for (const h of picks) {
    const found = scored.find((s) => s.hour === h);
    score[String(h)] = Number((found?.score ?? 0).toFixed(4));
  }
  return { recommended_hours: picks, hours_score: score };
}
```

> **NOTE:** If `runGa4Report` does not exist with that signature in `src/lib/ga4-api.ts`, adapt the call to the actual exported function. Look at the imports of `src/app/(dashboard)/ga4/page.tsx` for the canonical client-side fetch and write a small server-side equivalent in this file. Do NOT change the exported API of `hours.ts`.

- [ ] **Step 3: Type-check + commit**

```bash
npx tsc --noEmit
git add src/lib/email-templates/hours.ts
git commit -m "feat(email-templates): top-3 dispersed hours from GA4 hourly"
```

---

### Task 6: Create `segments.ts` — RFM resolver

**Files:**
- Create: `src/lib/email-templates/segments.ts`

- [ ] **Step 1: Read CRM RFM lib to confirm API**

```bash
grep -E "export" src/lib/crm-rfm.ts | head -10
```

Confirm function name to query RFM count by class (e.g., `countByRfmClass(workspace_id, classes[])`). If absent, write a helper inline using `createAdminClient` against the existing CRM table (look at `src/app/api/crm/cohort/route.ts` for the table name and rfm class column).

- [ ] **Step 2: Write segments.ts**

```ts
// src/lib/email-templates/segments.ts
import { createAdminClient } from "@/lib/supabase-admin";
import type { Slot, ResolvedSegment } from "./types";

const RFM_BY_SLOT: Record<Slot, string[]> = {
  1: ["champions", "loyal"],
  2: ["loyal", "potential"],
  3: ["new", "champions"],
};

const LABELS: Record<Slot, string> = {
  1: "Champions + Loyal (top compradores)",
  2: "Loyal + Potential (compradores recorrentes)",
  3: "New + Champions (novos + top)",
};

async function countContactsByRfm(
  workspace_id: string,
  classes: string[]
): Promise<number> {
  const supabase = createAdminClient();
  // Adjust table/column names to match crm-rfm.ts schema (look at migration-027/028)
  const { count } = await supabase
    .from("crm_contacts")
    .select("id", { count: "exact", head: true })
    .eq("workspace_id", workspace_id)
    .in("rfm_class", classes);
  return count ?? 0;
}

export async function resolveSegmentForSlot(
  workspace_id: string,
  slot: Slot
): Promise<ResolvedSegment> {
  const classes = RFM_BY_SLOT[slot];
  const size = await countContactsByRfm(workspace_id, classes);
  return {
    type: "rfm",
    payload: { rfm_classes: classes },
    estimated_size: size,
    display_label: LABELS[slot],
  };
}
```

> **NOTE:** Confirm `crm_contacts` and `rfm_class` against the actual schema (it may be `crm_customers`/`rfm_segment`). Run `grep -E "rfm_class|rfm_segment" src/lib/crm-rfm.ts src/lib/crm-compute.ts` and adjust.

- [ ] **Step 3: Type-check + commit**

```bash
npx tsc --noEmit
git add src/lib/email-templates/segments.ts
git commit -m "feat(email-templates): RFM segment resolver per slot"
```

---

### Task 7: Create `picker.ts` — slot product pickers

**Files:**
- Create: `src/lib/email-templates/picker.ts`

- [ ] **Step 1: Read VNDA helpers to confirm API**

```bash
grep -E "export (async )?function" src/lib/vnda-api.ts | head -20
```

Confirm: function to list products (with stock + created_at + tags) and get product details by id. The library already scopes per workspace via `getVndaConfigForWorkspace`.

- [ ] **Step 2: Write picker.ts**

```ts
// src/lib/email-templates/picker.ts
import { createAdminClient } from "@/lib/supabase-admin";
import { getVndaConfigForWorkspace } from "@/lib/coupons/vnda-coupons";
import { searchVndaProducts } from "@/lib/vnda-api";
import { runGa4Report } from "@/lib/ga4-api";
import type { Slot, ProductSnapshot, EmailTemplateSettings } from "./types";

interface PickResult {
  product: ProductSnapshot | null;
  reason?: "no_ga4" | "no_vnda" | "no_candidate" | "all_recently_used";
}

async function recentlyUsedProductIds(
  workspace_id: string,
  slot: Slot,
  days: number
): Promise<Set<string>> {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  const supabase = createAdminClient();
  const { data } = await supabase
    .from("email_template_suggestions")
    .select("vnda_product_id")
    .eq("workspace_id", workspace_id)
    .eq("slot", slot)
    .gte("generated_for_date", since.slice(0, 10));
  return new Set((data ?? []).map((r) => r.vnda_product_id as string));
}

function toSnapshot(p: any): ProductSnapshot {
  return {
    vnda_id: String(p.id ?? p.vnda_id ?? ""),
    name: p.name ?? "",
    price: Number(p.price ?? p.sale_price ?? 0),
    old_price: p.old_price ? Number(p.old_price) : undefined,
    image_url: p.images?.[0]?.url ?? p.image_url ?? "",
    url: p.url ?? `https://www.bulking.com.br/produto/${p.slug ?? p.id}`,
    description: p.description ?? "",
    tags: Array.isArray(p.tags) ? p.tags.map(String) : [],
  };
}

export async function pickBestseller(
  workspace_id: string,
  settings: EmailTemplateSettings
): Promise<PickResult> {
  const vndaConfig = await getVndaConfigForWorkspace(workspace_id);
  if (!vndaConfig) return { product: null, reason: "no_vnda" };

  let topIds: string[] = [];
  try {
    const report = await runGa4Report({
      workspace_id,
      dimensions: ["item_id"],
      metrics: ["purchase_revenue", "add_to_carts"],
      date_range_days: settings.bestseller_lookback_days,
      order_by: { metric: "purchase_revenue", desc: true },
      limit: 30,
    });
    topIds = (report?.rows ?? []).map((r: any) => String(r.dimensions?.item_id ?? ""));
  } catch {
    return { product: null, reason: "no_ga4" };
  }

  if (topIds.length === 0) return { product: null, reason: "no_candidate" };

  const used = await recentlyUsedProductIds(workspace_id, 1, 7);

  for (const id of topIds) {
    if (used.has(id)) continue;
    const products = await searchVndaProducts(vndaConfig, { ids: [id] });
    const p = products?.[0];
    if (!p) continue;
    if (!p.available) continue;
    const stock = Number(p.stock ?? 0);
    if (stock < settings.min_stock_bestseller) continue;
    return { product: toSnapshot(p) };
  }
  return { product: null, reason: "no_candidate" };
}

export async function pickSlowmoving(
  workspace_id: string,
  settings: EmailTemplateSettings
): Promise<PickResult> {
  const vndaConfig = await getVndaConfigForWorkspace(workspace_id);
  if (!vndaConfig) return { product: null, reason: "no_vnda" };

  // 1. Candidates: stock > 10 + age >= 30d
  const ageCutoff = new Date(
    Date.now() - settings.slowmoving_lookback_days * 24 * 60 * 60 * 1000
  ).toISOString();
  const candidates = await searchVndaProducts(vndaConfig, {
    min_stock: 11,
    created_before: ageCutoff,
  });
  if (!candidates || candidates.length === 0) return { product: null, reason: "no_candidate" };

  // 2. Get sales for these products from GA4
  const idList = candidates.map((p) => String(p.id));
  let salesById: Record<string, number> = {};
  try {
    const report = await runGa4Report({
      workspace_id,
      dimensions: ["item_id"],
      metrics: ["item_purchase_quantity"],
      filter: { item_id_in: idList },
      date_range_days: settings.slowmoving_lookback_days,
    });
    for (const r of report?.rows ?? []) {
      salesById[String(r.dimensions?.item_id)] = Number(r.metrics?.item_purchase_quantity ?? 0);
    }
  } catch {
    // GA4 missing → score everything with sales=0 (slowmoving by definition)
    salesById = {};
  }

  const used = await recentlyUsedProductIds(workspace_id, 2, 14);

  // 3. Score = stock / (sales + 1), filter used
  const scored = candidates
    .filter((p) => !used.has(String(p.id)))
    .map((p) => {
      const stock = Number(p.stock ?? 0);
      const sales = salesById[String(p.id)] ?? 0;
      return { p, score: stock / (sales + 1), sales };
    })
    .filter((x) => x.sales <= settings.slowmoving_max_sales)
    .sort((a, b) => b.score - a.score);

  if (scored.length === 0) return { product: null, reason: "no_candidate" };
  return { product: toSnapshot(scored[0].p) };
}

export async function pickNewarrival(
  workspace_id: string,
  settings: EmailTemplateSettings
): Promise<PickResult> {
  const vndaConfig = await getVndaConfigForWorkspace(workspace_id);
  if (!vndaConfig) return { product: null, reason: "no_vnda" };

  const since = new Date(
    Date.now() - settings.newarrival_lookback_days * 24 * 60 * 60 * 1000
  ).toISOString();
  const candidates = await searchVndaProducts(vndaConfig, {
    created_after: since,
    available: true,
    min_stock: 1,
  });
  if (!candidates || candidates.length === 0) return { product: null, reason: "no_candidate" };

  const used = await recentlyUsedProductIds(workspace_id, 3, 14);

  const sorted = candidates
    .filter((p) => !used.has(String(p.id)))
    .sort((a: any, b: any) => {
      const ad = new Date(a.created_at ?? 0).getTime();
      const bd = new Date(b.created_at ?? 0).getTime();
      return bd - ad;
    });
  if (sorted.length === 0) return { product: null, reason: "all_recently_used" };
  return { product: toSnapshot(sorted[0]) };
}
```

> **NOTE:** `searchVndaProducts` filter parameters (`min_stock`, `created_before`, `ids`, etc.) must match the actual signature in `src/lib/vnda-api.ts`. Per the project memory, do **NOT** pass `tags` to VNDA search — fetch all and filter locally if tag filters are needed (not needed in MVP). If filter params are not supported, fetch a broad list and filter in TypeScript.

- [ ] **Step 3: Type-check + commit**

```bash
npx tsc --noEmit
git add src/lib/email-templates/picker.ts
git commit -m "feat(email-templates): pickers for bestseller/slowmoving/newarrival slots"
```

---

### Task 8: Create `coupon.ts` — VNDA coupon wrapper

**Files:**
- Create: `src/lib/email-templates/coupon.ts`

- [ ] **Step 1: Read createFullCoupon signature**

```bash
grep -A 30 "export async function createFullCoupon" src/lib/coupons/vnda-coupons.ts
```

Confirm exact arg shape.

- [ ] **Step 2: Write coupon.ts**

```ts
// src/lib/email-templates/coupon.ts
import {
  createFullCoupon,
  getVndaConfigForWorkspace,
} from "@/lib/coupons/vnda-coupons";
import type { ProductSnapshot } from "./types";

const BASE32 = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // omit ambiguous chars

function randomBase32(len: number): string {
  let out = "";
  for (let i = 0; i < len; i++) {
    out += BASE32[Math.floor(Math.random() * BASE32.length)];
  }
  return out;
}

export interface CreatedCoupon {
  code: string;
  vnda_promotion_id: number;
  vnda_coupon_id: number;
  expires_at: Date;
  discount_percent: number;
}

export async function createSlowmovingCoupon(args: {
  workspace_id: string;
  product: ProductSnapshot;
  discount_percent: number;
  validity_hours: number;
}): Promise<CreatedCoupon> {
  const config = await getVndaConfigForWorkspace(args.workspace_id);
  if (!config) throw new Error("VNDA config missing for workspace");

  const code = `EMAIL-SLOWMOV-${randomBase32(5)}`;
  const expires_at = new Date(Date.now() + args.validity_hours * 60 * 60 * 1000);

  const result = await createFullCoupon(config, {
    code,
    discount_percent: args.discount_percent,
    expires_at,
    product_id: args.product.vnda_id,
    starts_at: new Date(),
    cumulative: false,
    description: `Email Templates · slot 2 · ${args.product.name}`,
  });

  return {
    code,
    vnda_promotion_id: result.promotion_id,
    vnda_coupon_id: result.coupon_id,
    expires_at,
    discount_percent: args.discount_percent,
  };
}
```

> **NOTE:** Adjust `createFullCoupon` arg names to match the real signature found in step 1. Remove fields not supported. The intent is: "code, X% off, expires in N hours, scoped to this product".

- [ ] **Step 3: Type-check + commit**

```bash
npx tsc --noEmit
git add src/lib/email-templates/coupon.ts
git commit -m "feat(email-templates): slowmoving coupon wrapper around createFullCoupon"
```

---

### Task 9: Create `countdown.ts` — signed URL builder

**Files:**
- Create: `src/lib/email-templates/countdown.ts`

- [ ] **Step 1: Write countdown.ts**

```ts
// src/lib/email-templates/countdown.ts
import { createHmac, timingSafeEqual } from "crypto";

function getSecret(): string {
  const s = process.env.EMAIL_COUNTDOWN_SECRET;
  if (!s) throw new Error("EMAIL_COUNTDOWN_SECRET is not set");
  return s;
}

export function sign(expiresIso: string): string {
  return createHmac("sha256", getSecret()).update(expiresIso).digest("hex");
}

export function verify(expiresIso: string, sig: string): boolean {
  try {
    const expected = sign(expiresIso);
    const a = Buffer.from(expected, "hex");
    const b = Buffer.from(sig, "hex");
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

export function buildCountdownUrl(args: {
  base_url: string; // e.g. https://app.vortex.bulking.com.br
  expires_at: Date;
}): string {
  const expiresIso = args.expires_at.toISOString();
  const sig = sign(expiresIso);
  const url = new URL("/api/email-countdown.png", args.base_url);
  url.searchParams.set("expires", expiresIso);
  url.searchParams.set("sig", sig);
  return url.toString();
}
```

- [ ] **Step 2: Type-check + commit**

```bash
npx tsc --noEmit
git add src/lib/email-templates/countdown.ts
git commit -m "feat(email-templates): HMAC-signed countdown URL builder"
```

---

### Task 10: Create `copy.ts` — template-based copy provider

**Files:**
- Create: `src/lib/email-templates/copy.ts`

- [ ] **Step 1: Write copy.ts (template-based default + llm hook)**

```ts
// src/lib/email-templates/copy.ts
import type {
  CopyInput,
  CopyOutput,
  CopyProviderImpl,
  CopyProvider,
} from "./types";

// ---- Template-based (DEFAULT) -------------------------------------------

const SUBJECT_BANK: Record<1 | 2 | 3, string[]> = {
  1: [
    "{name} — o mais vestido da semana.",
    "Top 1 da semana: {name}.",
    "{name} liderou. Veja por quê.",
  ],
  2: [
    "Última chance pra vestir {name}.",
    "{name} — ainda dá tempo.",
    "Estoque acabando: {name}.",
  ],
  3: [
    "{name} — acabou de chegar.",
    "Nova fase, nova peça: {name}.",
    "Lançamento: {name}.",
  ],
};

const HEADLINE_BANK: Record<1 | 2 | 3, string[]> = {
  1: ["O mais vestido da semana.", "Quem treina, escolheu essa.", "Top 1 — e dá pra ver por quê."],
  2: ["Última chance.", "Tá indo embora.", "Antes que acabe."],
  3: ["Acabou de chegar.", "Nova peça. Mesmo trabalho.", "Pronto pra vestir."],
};

const CTA_BANK: Record<1 | 2 | 3, string> = {
  1: "Ver na loja",
  2: "Aproveitar agora",
  3: "Conferir lançamento",
};

const LEAD_BANK: Record<1 | 2 | 3, (input: CopyInput) => string> = {
  1: ({ product }) =>
    `${product.name} foi a peça mais vendida dos últimos dias. Caimento pra quem treina, design feito pra durar. Vista o trabalho.`,
  2: ({ product, coupon }) =>
    coupon
      ? `Estoque acabando em ${product.name}. Use o cupom ${coupon.code} e leve com ${coupon.discount_percent}% off — só por ${Math.round(
          (coupon.expires_at.getTime() - Date.now()) / 36e5
        )} horas.`
      : `Estoque acabando em ${product.name}. Última chance pra vestir essa.`,
  3: ({ product }) =>
    `${product.name} acabou de chegar. Mesma intenção de sempre: design autoral, caimento pensado, qualidade que dura.`,
};

function pickRotated<T>(arr: T[], salt: number): T {
  return arr[salt % arr.length];
}

function dayOfYear(d = new Date()): number {
  const start = Date.UTC(d.getUTCFullYear(), 0, 0);
  const ms = d.getTime() - start;
  return Math.floor(ms / 86400000);
}

class TemplateProvider implements CopyProviderImpl {
  async generate(input: CopyInput): Promise<CopyOutput> {
    const salt = dayOfYear() + input.slot;
    const subjectTpl = pickRotated(SUBJECT_BANK[input.slot], salt);
    const headline = pickRotated(HEADLINE_BANK[input.slot], salt);
    const lead = LEAD_BANK[input.slot](input);
    const cta_text = CTA_BANK[input.slot];
    return {
      subject: subjectTpl.replace("{name}", input.product.name),
      headline,
      lead,
      cta_text,
      cta_url: input.product.url,
    };
  }
}

// ---- LLM hook (default falls back to template if it fails) --------------

class LlmProvider implements CopyProviderImpl {
  constructor(private agent_slug: string) {}
  async generate(input: CopyInput): Promise<CopyOutput> {
    // Lazy import so type-only consumers don't pull SDKs
    const { runAgent } = await import("@/lib/agent/team-agents");
    const prompt = buildLlmPrompt(input);
    const out = await runAgent({
      slug: this.agent_slug,
      complexity: "basic",
      prompt,
      workspace_id: input.workspace_id,
      response_format: "json",
    });
    return parseLlmJson(out, input);
  }
}

function buildLlmPrompt(input: CopyInput): string {
  const slotLabel = { 1: "best-seller", 2: "estoque acabando (com cupom)", 3: "lançamento" }[input.slot];
  const couponPart = input.coupon
    ? `Cupom ${input.coupon.code}, ${input.coupon.discount_percent}% off, válido até ${input.coupon.expires_at.toISOString()}.`
    : "";
  return `Brand: Bulking (Hero+Creator, voz determinada e direta, paleta preto/verde, NUNCA usar "mega promo", "campeão", "guerreiro", urgência falsa).
Tipo: email marketing — slot ${input.slot} (${slotLabel}).
Produto: ${input.product.name} — R$ ${input.product.price.toFixed(2)}.
Segmento alvo: ${input.segment.display_label}.
${couponPart}

Retorne APENAS JSON válido com as chaves: subject, headline, lead, cta_text. Sem markdown, sem comentários.
Limites: subject ≤ 60 chars, headline ≤ 50 chars, lead 2-3 frases, cta_text ≤ 24 chars.`;
}

function parseLlmJson(raw: string, input: CopyInput): CopyOutput {
  const cleaned = raw.trim().replace(/^```json\s*|\s*```$/g, "");
  const parsed = JSON.parse(cleaned);
  return {
    subject: String(parsed.subject ?? "").slice(0, 80),
    headline: String(parsed.headline ?? "").slice(0, 60),
    lead: String(parsed.lead ?? ""),
    cta_text: String(parsed.cta_text ?? "Ver"),
    cta_url: input.product.url,
  };
}

// ---- Public API --------------------------------------------------------

export async function generateCopy(
  input: CopyInput,
  provider: CopyProvider,
  llm_agent_slug: string | null
): Promise<{ output: CopyOutput; provider_used: CopyProvider }> {
  if (provider === "llm" && llm_agent_slug) {
    try {
      const out = await new LlmProvider(llm_agent_slug).generate(input);
      return { output: out, provider_used: "llm" };
    } catch {
      // Fallback automático
    }
  }
  const out = await new TemplateProvider().generate(input);
  return { output: out, provider_used: "template" };
}
```

> **NOTE:** Confirm `runAgent` signature in `src/lib/agent/team-agents.ts`. If the actual export is different (e.g., `dispatchAgent` or `callTeamAgent`), update the import and call site only — keep `generateCopy` API stable.

- [ ] **Step 2: Type-check + commit**

```bash
npx tsc --noEmit
git add src/lib/email-templates/copy.ts
git commit -m "feat(email-templates): copy provider — template default + llm hook"
```

---

## Phase 2 — HTML Templates

### Task 11: Create `templates/shared.ts` — header/footer/tokens

**Files:**
- Create: `src/lib/email-templates/templates/shared.ts`

- [ ] **Step 1: Write shared.ts**

```ts
// src/lib/email-templates/templates/shared.ts

export const TOKENS = {
  bg: "#000000",
  bgSurface: "#0A0A0A",
  text: "#FFFFFF",
  textMuted: "#D9D9D9",
  textSecondary: "#707070",
  accent: "#49E472",
  accentDark: "#3BC45E",
  border: "#383838",
  fontHead: "'Kanit', Arial, Helvetica, sans-serif",
  fontBody: "'Inter', Arial, Helvetica, sans-serif",
};

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function htmlOpen(args: { subject: string; preview: string }): string {
  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="color-scheme" content="light dark" />
<meta name="supported-color-schemes" content="light dark" />
<title>${escapeHtml(args.subject)}</title>
<link href="https://fonts.googleapis.com/css2?family=Kanit:wght@400;600;700;800&family=Inter:wght@400;600&display=swap" rel="stylesheet" />
<style>
  body { margin:0; padding:0; background:${TOKENS.bg}; }
  table { border-collapse:collapse; }
  img { border:0; outline:none; text-decoration:none; display:block; }
  a { color:${TOKENS.accent}; }
  @media (max-width: 599px) {
    .h1 { font-size: 28px !important; }
    .lead { font-size: 16px !important; }
    .container { width: 100% !important; }
    .pad { padding: 16px !important; }
  }
</style>
</head>
<body style="margin:0;padding:0;background:${TOKENS.bg};">
<div style="display:none;max-height:0;overflow:hidden;color:${TOKENS.bg};">${escapeHtml(args.preview)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${TOKENS.bg};">
  <tr><td align="center">
  <table role="presentation" class="container" width="600" cellpadding="0" cellspacing="0" style="width:600px;max-width:600px;background:${TOKENS.bg};">`;
}

export function htmlClose(): string {
  return `</table></td></tr></table></body></html>`;
}

export function header(): string {
  return `
<tr><td align="center" class="pad" style="padding:32px 24px 16px;">
  <span style="display:inline-block;font-family:${TOKENS.fontHead};font-weight:800;font-size:28px;letter-spacing:0.05em;color:${TOKENS.text};">BULKING</span>
</td></tr>`;
}

export function hero(args: { image_url: string; alt: string; badge?: string }): string {
  const badge = args.badge
    ? `<div style="position:relative;"><span style="position:absolute;top:16px;left:16px;background:${TOKENS.accent};color:${TOKENS.bg};font-family:${TOKENS.fontHead};font-weight:700;font-size:12px;letter-spacing:0.1em;padding:6px 12px;text-transform:uppercase;">${escapeHtml(args.badge)}</span></div>`
    : "";
  return `
<tr><td style="padding:0;">
  ${badge}
  <img src="${args.image_url}" alt="${escapeHtml(args.alt)}" width="600" height="800" style="width:100%;max-width:600px;height:auto;display:block;object-fit:cover;" />
</td></tr>`;
}

export function headlineBlock(text: string): string {
  return `
<tr><td class="pad" style="padding:32px 24px 8px;">
  <h1 class="h1" style="margin:0;font-family:${TOKENS.fontHead};font-weight:800;font-size:32px;line-height:1.2;color:${TOKENS.text};letter-spacing:-0.01em;">${escapeHtml(text)}</h1>
</td></tr>`;
}

export function leadBlock(text: string): string {
  return `
<tr><td class="pad" style="padding:8px 24px 24px;">
  <p class="lead" style="margin:0;font-family:${TOKENS.fontBody};font-weight:400;font-size:16px;line-height:1.5;color:${TOKENS.textMuted};">${escapeHtml(text)}</p>
</td></tr>`;
}

export function ctaBlock(args: { text: string; url: string }): string {
  return `
<tr><td class="pad" align="left" style="padding:8px 24px 32px;">
  <a href="${args.url}" target="_blank" style="display:inline-block;background:${TOKENS.accent};color:${TOKENS.bg};font-family:${TOKENS.fontHead};font-weight:600;font-size:14px;letter-spacing:0.1em;text-transform:uppercase;text-decoration:none;padding:16px 32px;">${escapeHtml(args.text)}</a>
</td></tr>`;
}

export function productMetaBlock(args: { name: string; price: number; old_price?: number }): string {
  const oldPrice = args.old_price
    ? `<span style="font-family:${TOKENS.fontBody};font-weight:400;font-size:14px;color:${TOKENS.textSecondary};text-decoration:line-through;margin-right:8px;">R$ ${args.old_price.toFixed(2)}</span>`
    : "";
  return `
<tr><td class="pad" style="padding:8px 24px 24px;">
  <div style="font-family:${TOKENS.fontHead};font-weight:600;font-size:18px;color:${TOKENS.text};margin-bottom:4px;">${escapeHtml(args.name)}</div>
  <div>${oldPrice}<span style="font-family:${TOKENS.fontHead};font-weight:700;font-size:20px;color:${TOKENS.accent};">R$ ${args.price.toFixed(2)}</span></div>
</td></tr>`;
}

export function couponBlock(args: {
  code: string;
  discount_percent: number;
  product_name: string;
  countdown_url: string;
}): string {
  return `
<tr><td class="pad" style="padding:8px 24px 24px;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:2px solid ${TOKENS.accent};background:${TOKENS.bgSurface};">
    <tr><td align="center" style="padding:20px 16px;">
      <div style="font-family:${TOKENS.fontHead};font-weight:600;font-size:11px;letter-spacing:0.2em;color:${TOKENS.textSecondary};text-transform:uppercase;margin-bottom:8px;">Cupom Exclusivo</div>
      <div style="font-family:'Courier New', monospace;font-size:22px;letter-spacing:0.1em;color:${TOKENS.text};background:${TOKENS.bg};padding:12px 20px;display:inline-block;border:1px dashed ${TOKENS.border};">${escapeHtml(args.code)}</div>
      <div style="font-family:${TOKENS.fontBody};font-size:14px;color:${TOKENS.textMuted};margin-top:12px;">${args.discount_percent}% off em ${escapeHtml(args.product_name)}</div>
    </td></tr>
  </table>
</td></tr>
<tr><td class="pad" align="center" style="padding:0 24px 24px;">
  <div style="font-family:${TOKENS.fontHead};font-weight:600;font-size:10px;letter-spacing:0.2em;color:${TOKENS.textSecondary};text-transform:uppercase;margin-bottom:8px;">Termina em</div>
  <img src="${args.countdown_url}" alt="Cronômetro" width="600" height="120" style="width:100%;max-width:600px;height:auto;display:block;" />
</td></tr>`;
}

export function footer(): string {
  return `
<tr><td class="pad" style="padding:32px 24px;border-top:1px solid ${TOKENS.border};">
  <div style="font-family:${TOKENS.fontHead};font-weight:700;font-size:14px;letter-spacing:0.1em;color:${TOKENS.accent};text-transform:uppercase;margin-bottom:12px;">Respect the Hustle.</div>
  <div style="font-family:${TOKENS.fontBody};font-size:12px;color:${TOKENS.textSecondary};line-height:1.6;">
    Bulking · <a href="https://www.bulking.com.br" style="color:${TOKENS.textSecondary};text-decoration:underline;">bulking.com.br</a>
    <br />
    Você está recebendo este email porque é cliente Bulking. <a href="{{UNSUBSCRIBE_URL}}" style="color:${TOKENS.textSecondary};text-decoration:underline;">Descadastrar</a>.
  </div>
</td></tr>`;
}
```

- [ ] **Step 2: Type-check + commit**

```bash
npx tsc --noEmit
git add src/lib/email-templates/templates/shared.ts
git commit -m "feat(email-templates): shared blocks — header/hero/cta/coupon/footer (Bulking brand)"
```

---

### Task 12: Create `templates/bestseller.ts` — slot 1 render

**Files:**
- Create: `src/lib/email-templates/templates/bestseller.ts`

- [ ] **Step 1: Write bestseller.ts**

```ts
// src/lib/email-templates/templates/bestseller.ts
import {
  ctaBlock,
  footer,
  header,
  headlineBlock,
  hero,
  htmlClose,
  htmlOpen,
  leadBlock,
  productMetaBlock,
} from "./shared";
import type { TemplateRenderContext } from "../types";

export function renderBestseller(ctx: TemplateRenderContext): string {
  return [
    htmlOpen({ subject: ctx.copy.subject, preview: ctx.copy.lead }),
    header(),
    hero({ image_url: ctx.product.image_url, alt: ctx.product.name, badge: "TOP 1 DA SEMANA" }),
    headlineBlock(ctx.copy.headline),
    leadBlock(ctx.copy.lead),
    productMetaBlock({ name: ctx.product.name, price: ctx.product.price, old_price: ctx.product.old_price }),
    ctaBlock({ text: ctx.copy.cta_text, url: ctx.copy.cta_url }),
    footer(),
    htmlClose(),
  ].join("\n");
}
```

- [ ] **Step 2: Type-check + commit**

```bash
npx tsc --noEmit
git add src/lib/email-templates/templates/bestseller.ts
git commit -m "feat(email-templates): bestseller template (slot 1)"
```

---

### Task 13: Create `templates/slowmoving.ts` — slot 2 render

**Files:**
- Create: `src/lib/email-templates/templates/slowmoving.ts`

- [ ] **Step 1: Write slowmoving.ts**

```ts
// src/lib/email-templates/templates/slowmoving.ts
import {
  couponBlock,
  ctaBlock,
  footer,
  header,
  headlineBlock,
  hero,
  htmlClose,
  htmlOpen,
  leadBlock,
  productMetaBlock,
} from "./shared";
import type { TemplateRenderContext } from "../types";

export function renderSlowmoving(ctx: TemplateRenderContext): string {
  if (!ctx.coupon) {
    throw new Error("renderSlowmoving requires ctx.coupon");
  }
  return [
    htmlOpen({ subject: ctx.copy.subject, preview: ctx.copy.lead }),
    header(),
    hero({ image_url: ctx.product.image_url, alt: ctx.product.name, badge: "ÚLTIMAS PEÇAS" }),
    headlineBlock(ctx.copy.headline),
    leadBlock(ctx.copy.lead),
    couponBlock({
      code: ctx.coupon.code,
      discount_percent: ctx.coupon.discount_percent,
      product_name: ctx.product.name,
      countdown_url: ctx.coupon.countdown_url,
    }),
    productMetaBlock({ name: ctx.product.name, price: ctx.product.price, old_price: ctx.product.old_price }),
    ctaBlock({ text: ctx.copy.cta_text, url: ctx.copy.cta_url }),
    footer(),
    htmlClose(),
  ].join("\n");
}
```

- [ ] **Step 2: Type-check + commit**

```bash
npx tsc --noEmit
git add src/lib/email-templates/templates/slowmoving.ts
git commit -m "feat(email-templates): slowmoving template (slot 2 with coupon + countdown)"
```

---

### Task 14: Create `templates/newarrival.ts` — slot 3 render

**Files:**
- Create: `src/lib/email-templates/templates/newarrival.ts`

- [ ] **Step 1: Write newarrival.ts**

```ts
// src/lib/email-templates/templates/newarrival.ts
import {
  ctaBlock,
  footer,
  header,
  headlineBlock,
  hero,
  htmlClose,
  htmlOpen,
  leadBlock,
  productMetaBlock,
} from "./shared";
import type { TemplateRenderContext } from "../types";

export function renderNewarrival(ctx: TemplateRenderContext): string {
  return [
    htmlOpen({ subject: ctx.copy.subject, preview: ctx.copy.lead }),
    header(),
    hero({ image_url: ctx.product.image_url, alt: ctx.product.name, badge: "ACABOU DE CHEGAR" }),
    headlineBlock(ctx.copy.headline),
    leadBlock(ctx.copy.lead),
    productMetaBlock({ name: ctx.product.name, price: ctx.product.price, old_price: ctx.product.old_price }),
    ctaBlock({ text: ctx.copy.cta_text, url: ctx.copy.cta_url }),
    footer(),
    htmlClose(),
  ].join("\n");
}
```

- [ ] **Step 2: Type-check + commit**

```bash
npx tsc --noEmit
git add src/lib/email-templates/templates/newarrival.ts
git commit -m "feat(email-templates): newarrival template (slot 3)"
```

---

## Phase 3 — Orchestrator + Cron

### Task 15: Create `orchestrator.ts` — daily entrypoint

**Files:**
- Create: `src/lib/email-templates/orchestrator.ts`

- [ ] **Step 1: Write orchestrator.ts**

```ts
// src/lib/email-templates/orchestrator.ts
import { createAdminClient } from "@/lib/supabase-admin";
import { logAudit } from "./audit";
import { getSettings } from "./settings";
import { resolveSegmentForSlot } from "./segments";
import { pickTopHours } from "./hours";
import { pickBestseller, pickNewarrival, pickSlowmoving } from "./picker";
import { generateCopy } from "./copy";
import { createSlowmovingCoupon } from "./coupon";
import { buildCountdownUrl } from "./countdown";
import { renderBestseller } from "./templates/bestseller";
import { renderSlowmoving } from "./templates/slowmoving";
import { renderNewarrival } from "./templates/newarrival";
import type { Slot, ProductSnapshot, EmailTemplateSettings } from "./types";

interface SlotResult {
  slot: Slot;
  ok: boolean;
  reason?: string;
  suggestion_id?: string;
}

const APP_BASE_URL = process.env.NEXT_PUBLIC_APP_URL ?? process.env.APP_URL ?? "https://app.bulking.com.br";

function todayBrt(): string {
  const now = new Date();
  // BRT = UTC-3 (Brazil does not observe DST since 2019)
  const brt = new Date(now.getTime() - 3 * 60 * 60 * 1000);
  return brt.toISOString().slice(0, 10);
}

async function generateSlotBestseller(
  workspace_id: string,
  settings: EmailTemplateSettings,
  date: string,
  hours: { recommended_hours: number[]; hours_score: Record<string, number> }
): Promise<SlotResult> {
  const pick = await pickBestseller(workspace_id, settings);
  if (!pick.product) {
    await logAudit({ workspace_id, event: "skipped_no_product", payload: { slot: 1, reason: pick.reason } });
    return { slot: 1, ok: false, reason: pick.reason };
  }
  return persistSuggestion({
    workspace_id, settings, date, slot: 1, product: pick.product, hours,
    render: (ctx) => renderBestseller(ctx),
  });
}

async function generateSlotSlowmoving(
  workspace_id: string,
  settings: EmailTemplateSettings,
  date: string,
  hours: { recommended_hours: number[]; hours_score: Record<string, number> }
): Promise<SlotResult> {
  const pick = await pickSlowmoving(workspace_id, settings);
  if (!pick.product) {
    await logAudit({ workspace_id, event: "skipped_no_product", payload: { slot: 2, reason: pick.reason } });
    return { slot: 2, ok: false, reason: pick.reason };
  }

  let coupon;
  try {
    coupon = await createSlowmovingCoupon({
      workspace_id,
      product: pick.product,
      discount_percent: settings.slowmoving_discount_percent,
      validity_hours: settings.slowmoving_coupon_validity_hours,
    });
    await logAudit({ workspace_id, event: "coupon_created", payload: { code: coupon.code, slot: 2 } });
  } catch (err) {
    await logAudit({
      workspace_id,
      event: "coupon_failed",
      payload: { slot: 2, error: String((err as Error).message) },
    });
    return { slot: 2, ok: false, reason: "coupon_failed" };
  }

  const countdown_url = buildCountdownUrl({
    base_url: APP_BASE_URL,
    expires_at: coupon.expires_at,
  });

  return persistSuggestion({
    workspace_id, settings, date, slot: 2, product: pick.product, hours,
    coupon: { ...coupon, countdown_url },
    render: (ctx) => renderSlowmoving(ctx),
  });
}

async function generateSlotNewarrival(
  workspace_id: string,
  settings: EmailTemplateSettings,
  date: string,
  hours: { recommended_hours: number[]; hours_score: Record<string, number> }
): Promise<SlotResult> {
  const pick = await pickNewarrival(workspace_id, settings);
  if (!pick.product) {
    await logAudit({ workspace_id, event: "skipped_no_product", payload: { slot: 3, reason: pick.reason } });
    return { slot: 3, ok: false, reason: pick.reason };
  }
  return persistSuggestion({
    workspace_id, settings, date, slot: 3, product: pick.product, hours,
    render: (ctx) => renderNewarrival(ctx),
  });
}

async function persistSuggestion(args: {
  workspace_id: string;
  settings: EmailTemplateSettings;
  date: string;
  slot: Slot;
  product: ProductSnapshot;
  hours: { recommended_hours: number[]; hours_score: Record<string, number> };
  coupon?: {
    code: string;
    vnda_promotion_id: number;
    vnda_coupon_id: number;
    expires_at: Date;
    discount_percent: number;
    countdown_url: string;
  };
  render: (ctx: any) => string;
}): Promise<SlotResult> {
  const { workspace_id, settings, date, slot, product, hours, coupon, render } = args;
  const segment = await resolveSegmentForSlot(workspace_id, slot);

  const { output: copy, provider_used } = await generateCopy(
    {
      slot,
      product,
      segment,
      coupon: coupon
        ? { code: coupon.code, discount_percent: coupon.discount_percent, expires_at: coupon.expires_at }
        : undefined,
      workspace_id,
    },
    settings.copy_provider,
    settings.llm_agent_slug
  );

  let rendered_html: string;
  try {
    rendered_html = render({
      product,
      copy,
      coupon: coupon
        ? {
            code: coupon.code,
            discount_percent: coupon.discount_percent,
            expires_at: coupon.expires_at,
            countdown_url: coupon.countdown_url,
          }
        : undefined,
      workspace: { name: "Bulking" },
    });
  } catch (err) {
    await logAudit({
      workspace_id,
      event: "render_failed",
      payload: { slot, error: String((err as Error).message) },
    });
    return { slot, ok: false, reason: "render_failed" };
  }

  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("email_template_suggestions")
    .upsert(
      {
        workspace_id,
        generated_for_date: date,
        slot,
        vnda_product_id: product.vnda_id,
        product_snapshot: product,
        target_segment_type: segment.type,
        target_segment_payload: { ...segment.payload, estimated_size: segment.estimated_size, display_label: segment.display_label },
        copy,
        copy_provider: provider_used,
        rendered_html,
        recommended_hours: hours.recommended_hours,
        hours_score: hours.hours_score,
        coupon_code: coupon?.code ?? null,
        coupon_vnda_promotion_id: coupon?.vnda_promotion_id ?? null,
        coupon_vnda_coupon_id: coupon?.vnda_coupon_id ?? null,
        coupon_expires_at: coupon?.expires_at?.toISOString() ?? null,
        coupon_discount_percent: coupon?.discount_percent ?? null,
        status: "pending",
        updated_at: new Date().toISOString(),
      },
      { onConflict: "workspace_id,generated_for_date,slot" }
    )
    .select("id")
    .single();

  if (error) {
    await logAudit({ workspace_id, event: "render_failed", payload: { slot, db_error: error.message } });
    return { slot, ok: false, reason: "db_error" };
  }

  await logAudit({
    workspace_id,
    suggestion_id: data.id as string,
    event: "generated",
    payload: { slot, copy_provider: provider_used, has_coupon: !!coupon },
  });
  return { slot, ok: true, suggestion_id: data.id as string };
}

export async function generateForWorkspace(workspace_id: string): Promise<{
  workspace_id: string;
  date: string;
  results: SlotResult[];
}> {
  const settings = await getSettings(workspace_id);
  if (!settings.enabled) {
    return { workspace_id, date: todayBrt(), results: [] };
  }
  const date = todayBrt();
  const hours = await pickTopHours(workspace_id, 14);

  const results = await Promise.all([
    generateSlotBestseller(workspace_id, settings, date, hours),
    generateSlotSlowmoving(workspace_id, settings, date, hours),
    generateSlotNewarrival(workspace_id, settings, date, hours),
  ]);

  return { workspace_id, date, results };
}
```

- [ ] **Step 2: Type-check + commit**

```bash
npx tsc --noEmit
git add src/lib/email-templates/orchestrator.ts
git commit -m "feat(email-templates): orchestrator — generate 3 slots per workspace per day"
```

---

### Task 16: Create cron route `email-templates-refresh`

**Files:**
- Create: `src/app/api/cron/email-templates-refresh/route.ts`

- [ ] **Step 1: Write the cron route**

```ts
// src/app/api/cron/email-templates-refresh/route.ts
import { NextRequest, NextResponse } from "next/server";
import { generateForWorkspace } from "@/lib/email-templates/orchestrator";
import { listEnabledWorkspaces } from "@/lib/email-templates/settings";

export const maxDuration = 300;

export async function POST(req: NextRequest) {
  return handle(req);
}

export async function GET(req: NextRequest) {
  return handle(req);
}

async function handle(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization") ?? "";
  if (!cronSecret || auth !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const workspaces = await listEnabledWorkspaces();
  const summaries: any[] = [];

  // Sequential to avoid hammering external APIs (VNDA + GA4) across many workspaces at once.
  // Within a workspace, slots run in parallel (orchestrator's Promise.all).
  for (const workspace_id of workspaces) {
    try {
      const out = await generateForWorkspace(workspace_id);
      summaries.push({
        workspace_id,
        date: out.date,
        slots_filled: out.results.filter((r) => r.ok).map((r) => r.slot),
        slots_skipped: out.results.filter((r) => !r.ok).map((r) => ({ slot: r.slot, reason: r.reason })),
      });
    } catch (err) {
      summaries.push({
        workspace_id,
        error: String((err as Error).message),
      });
    }
  }

  return NextResponse.json({ ok: true, processed: workspaces.length, summaries });
}
```

- [ ] **Step 2: Type-check + commit**

```bash
npx tsc --noEmit
git add src/app/api/cron/email-templates-refresh/route.ts
git commit -m "feat(email-templates): cron endpoint /api/cron/email-templates-refresh"
```

---

### Task 17: Add cron to `vercel.json`

**Files:**
- Modify: `vercel.json`

- [ ] **Step 1: Read current vercel.json**

```bash
cat vercel.json | head -60
```

- [ ] **Step 2: Add the cron entry inside the `crons` array**

Add this object to the existing `crons` array in `vercel.json` (alphabetical-by-path or end of array — match project convention):

```json
{
  "path": "/api/cron/email-templates-refresh",
  "schedule": "0 9 * * *"
}
```

> `0 9 * * *` UTC = 06:00 BRT (Brazil is UTC-3, no DST). Vercel only triggers via GET; the route handles both GET and POST.

- [ ] **Step 3: Validate JSON**

```bash
node -e "JSON.parse(require('fs').readFileSync('vercel.json','utf8')); console.log('ok')"
```
Expected: `ok`

- [ ] **Step 4: Commit**

```bash
git add vercel.json
git commit -m "feat(email-templates): cron schedule 06:00 BRT (0 9 UTC)"
```

---

## Phase 4 — Public APIs (CRM)

### Task 18: Create API `GET /api/crm/email-templates/active`

**Files:**
- Create: `src/app/api/crm/email-templates/active/route.ts`

- [ ] **Step 1: Read api-auth pattern**

```bash
head -40 src/app/api/crm/cohort/route.ts
```

Confirm how to get `workspace_id` from `api-auth.ts` (e.g., `requireWorkspace(req)` or similar).

- [ ] **Step 2: Write active/route.ts**

```ts
// src/app/api/crm/email-templates/active/route.ts
import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase-admin";
import { requireWorkspace } from "@/lib/api-auth";

export async function GET(req: NextRequest) {
  const auth = await requireWorkspace(req);
  if ("error" in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const today = new Date();
  const brt = new Date(today.getTime() - 3 * 60 * 60 * 1000).toISOString().slice(0, 10);

  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("email_template_suggestions")
    .select("*")
    .eq("workspace_id", auth.workspace_id)
    .eq("generated_for_date", brt)
    .order("slot", { ascending: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ date: brt, suggestions: data ?? [] });
}
```

> **NOTE:** Adjust `requireWorkspace`'s actual export name and return shape based on the real `src/lib/api-auth.ts`. If it returns `{ workspaceId, ... } | { error, status }`, normalize to that.

- [ ] **Step 3: Type-check + commit**

```bash
npx tsc --noEmit
git add src/app/api/crm/email-templates/active/route.ts
git commit -m "feat(email-templates): GET /api/crm/email-templates/active"
```

---

### Task 19: Create API `GET /api/crm/email-templates/history`

**Files:**
- Create: `src/app/api/crm/email-templates/history/route.ts`

- [ ] **Step 1: Write history/route.ts**

```ts
// src/app/api/crm/email-templates/history/route.ts
import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase-admin";
import { requireWorkspace } from "@/lib/api-auth";

export async function GET(req: NextRequest) {
  const auth = await requireWorkspace(req);
  if ("error" in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const { searchParams } = new URL(req.url);
  const days = Math.min(Math.max(parseInt(searchParams.get("days") ?? "30", 10) || 30, 1), 90);
  const status = searchParams.get("status"); // pending|selected|sent|null
  const slotParam = searchParams.get("slot"); // 1|2|3|null
  const slot = slotParam ? parseInt(slotParam, 10) : null;

  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const todayBrt = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString().slice(0, 10);

  const supabase = createAdminClient();
  let q = supabase
    .from("email_template_suggestions")
    .select("*", { count: "exact" })
    .eq("workspace_id", auth.workspace_id)
    .gte("generated_for_date", since)
    .lt("generated_for_date", todayBrt) // History excludes today
    .order("generated_for_date", { ascending: false })
    .order("slot", { ascending: true });

  if (status === "pending" || status === "selected" || status === "sent") {
    q = q.eq("status", status);
  }
  if (slot === 1 || slot === 2 || slot === 3) {
    q = q.eq("slot", slot);
  }

  const { data, count, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ suggestions: data ?? [], total: count ?? 0 });
}
```

- [ ] **Step 2: Type-check + commit**

```bash
npx tsc --noEmit
git add src/app/api/crm/email-templates/history/route.ts
git commit -m "feat(email-templates): GET /api/crm/email-templates/history"
```

---

### Task 20: Create API `GET /api/crm/email-templates/[id]`

**Files:**
- Create: `src/app/api/crm/email-templates/[id]/route.ts`

- [ ] **Step 1: Write [id]/route.ts**

```ts
// src/app/api/crm/email-templates/[id]/route.ts
import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase-admin";
import { requireWorkspace } from "@/lib/api-auth";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireWorkspace(req);
  if ("error" in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const { id } = await params;

  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("email_template_suggestions")
    .select("*")
    .eq("workspace_id", auth.workspace_id)
    .eq("id", id)
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json(data);
}
```

- [ ] **Step 2: Type-check + commit**

```bash
npx tsc --noEmit
git add src/app/api/crm/email-templates/[id]/route.ts
git commit -m "feat(email-templates): GET /api/crm/email-templates/[id]"
```

---

### Task 21: Create API `POST /api/crm/email-templates/[id]/select`

**Files:**
- Create: `src/app/api/crm/email-templates/[id]/select/route.ts`

- [ ] **Step 1: Write select/route.ts**

```ts
// src/app/api/crm/email-templates/[id]/select/route.ts
import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase-admin";
import { requireWorkspace } from "@/lib/api-auth";
import { logAudit } from "@/lib/email-templates/audit";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireWorkspace(req);
  if ("error" in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const { id } = await params;

  const supabase = createAdminClient();
  const { data: existing } = await supabase
    .from("email_template_suggestions")
    .select("id, status, selected_count, selected_at")
    .eq("workspace_id", auth.workspace_id)
    .eq("id", id)
    .maybeSingle();

  if (!existing) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const now = new Date().toISOString();
  const newCount = (existing.selected_count ?? 0) + 1;
  const newStatus = existing.status === "sent" ? "sent" : "selected";

  const { data, error } = await supabase
    .from("email_template_suggestions")
    .update({
      status: newStatus,
      selected_count: newCount,
      selected_at: existing.selected_at ?? now,
      updated_at: now,
    })
    .eq("id", id)
    .eq("workspace_id", auth.workspace_id)
    .select("id, selected_at, selected_count, status")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await logAudit({
    workspace_id: auth.workspace_id,
    suggestion_id: id,
    event: "selected",
    payload: { count: newCount },
  });

  return NextResponse.json({ ok: true, ...data });
}
```

- [ ] **Step 2: Type-check + commit**

```bash
npx tsc --noEmit
git add src/app/api/crm/email-templates/[id]/select/route.ts
git commit -m "feat(email-templates): POST /api/crm/email-templates/[id]/select"
```

---

### Task 22: Create API `POST /api/crm/email-templates/[id]/sent`

**Files:**
- Create: `src/app/api/crm/email-templates/[id]/sent/route.ts`

- [ ] **Step 1: Write sent/route.ts**

```ts
// src/app/api/crm/email-templates/[id]/sent/route.ts
import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase-admin";
import { requireWorkspace } from "@/lib/api-auth";
import { logAudit } from "@/lib/email-templates/audit";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireWorkspace(req);
  if ("error" in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const { id } = await params;

  const body = await req.json().catch(() => ({}));
  const sent_at = body.sent_at ? new Date(body.sent_at) : new Date();
  if (Number.isNaN(sent_at.getTime())) {
    return NextResponse.json({ error: "invalid_sent_at" }, { status: 400 });
  }
  const hour_chosen = body.hour_chosen != null ? Number(body.hour_chosen) : null;
  if (hour_chosen != null && (hour_chosen < 0 || hour_chosen > 23 || !Number.isInteger(hour_chosen))) {
    return NextResponse.json({ error: "invalid_hour_chosen" }, { status: 400 });
  }

  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("email_template_suggestions")
    .update({
      status: "sent",
      sent_at: sent_at.toISOString(),
      sent_hour_chosen: hour_chosen,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .eq("workspace_id", auth.workspace_id)
    .select("id, sent_at, sent_hour_chosen, status")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await logAudit({
    workspace_id: auth.workspace_id,
    suggestion_id: id,
    event: "sent",
    payload: { hour_chosen },
  });

  return NextResponse.json({ ok: true, ...data });
}
```

- [ ] **Step 2: Type-check + commit**

```bash
npx tsc --noEmit
git add src/app/api/crm/email-templates/[id]/sent/route.ts
git commit -m "feat(email-templates): POST /api/crm/email-templates/[id]/sent"
```

---

### Task 23: Create API `GET/PUT /api/crm/email-templates/settings`

**Files:**
- Create: `src/app/api/crm/email-templates/settings/route.ts`

- [ ] **Step 1: Write settings/route.ts**

```ts
// src/app/api/crm/email-templates/settings/route.ts
import { NextRequest, NextResponse } from "next/server";
import { requireWorkspace } from "@/lib/api-auth";
import { getSettings, upsertSettings } from "@/lib/email-templates/settings";

export async function GET(req: NextRequest) {
  const auth = await requireWorkspace(req);
  if ("error" in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const settings = await getSettings(auth.workspace_id);
  return NextResponse.json(settings);
}

export async function PUT(req: NextRequest) {
  const auth = await requireWorkspace(req);
  if ("error" in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const body = await req.json().catch(() => ({}));
  try {
    const updated = await upsertSettings({ ...body, workspace_id: auth.workspace_id });
    return NextResponse.json(updated);
  } catch (err) {
    return NextResponse.json({ error: String((err as Error).message) }, { status: 400 });
  }
}
```

- [ ] **Step 2: Type-check + commit**

```bash
npx tsc --noEmit
git add src/app/api/crm/email-templates/settings/route.ts
git commit -m "feat(email-templates): GET/PUT /api/crm/email-templates/settings"
```

---

## Phase 5 — Countdown PNG endpoint

### Task 24: Create `/api/email-countdown.png` route

**Files:**
- Create: `src/app/api/email-countdown.png/route.ts`

- [ ] **Step 1: Verify next/og availability**

```bash
node -e "console.log(require('next/og'))"
```
Expected: `[Object: ...]` showing `ImageResponse` etc.

- [ ] **Step 2: Write the route**

```ts
// src/app/api/email-countdown.png/route.ts
import { ImageResponse } from "next/og";
import { NextRequest } from "next/server";
import { verify } from "@/lib/email-templates/countdown";

export const runtime = "edge";
export const dynamic = "force-dynamic";

const ACCENT = "#49E472";
const BG = "#000000";
const MUTED = "#707070";

function fmt(ms: number): string {
  if (ms <= 0) return "ENCERRADO";
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const expires = searchParams.get("expires") ?? "";
  const sig = searchParams.get("sig") ?? "";

  if (!expires || !sig || !verify(expires, sig)) {
    return new Response("invalid signature", { status: 400 });
  }

  const expDate = new Date(expires);
  if (Number.isNaN(expDate.getTime())) {
    return new Response("invalid expires", { status: 400 });
  }
  const remaining = expDate.getTime() - Date.now();
  const text = fmt(remaining);
  const isExpired = remaining <= 0;

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          background: BG,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontFamily: "Arial, Helvetica, sans-serif",
        }}
      >
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 8,
          }}
        >
          <div
            style={{
              fontSize: 12,
              letterSpacing: 4,
              color: MUTED,
              textTransform: "uppercase",
            }}
          >
            {isExpired ? "Status" : "Termina em"}
          </div>
          <div
            style={{
              fontSize: 64,
              fontWeight: 800,
              color: isExpired ? MUTED : ACCENT,
              letterSpacing: 4,
              fontVariantNumeric: "tabular-nums",
            }}
          >
            {text}
          </div>
        </div>
      </div>
    ),
    {
      width: 600,
      height: 120,
      headers: {
        "Cache-Control": "no-store, no-cache, must-revalidate",
        "Content-Type": "image/png",
      },
    }
  );
}
```

- [ ] **Step 3: Type-check + commit**

```bash
npx tsc --noEmit
git add src/app/api/email-countdown.png/route.ts
git commit -m "feat(email-templates): /api/email-countdown.png — HMAC-validated dynamic PNG"
```

---

## Phase 6 — UI

### Task 25: Add CRM sidebar link

**Files:**
- Modify: `src/app/(dashboard)/crm/page.tsx` (or whichever file renders the CRM sub-nav)

- [ ] **Step 1: Locate where CRM sub-pages are linked**

```bash
grep -rE "crm/cashback|crm/whatsapp" src/app/\(dashboard\)/ 2>/dev/null | head -5
```

- [ ] **Step 2: Add link to "Email Templates"**

In the file that renders the CRM nav, add an entry:

```tsx
{ label: "Email Templates", href: "/crm/email-templates", icon: Mail }
```

(Match the existing pattern — exact code depends on the file. If CRM uses a `<Tabs>` component, add a `<TabsTrigger value="email-templates">`. If it uses a plain `<nav>` with `<Link>`s, add a `<Link href="/crm/email-templates">`.)

- [ ] **Step 3: Type-check + commit**

```bash
npx tsc --noEmit
git add src/app/\(dashboard\)/crm/page.tsx
git commit -m "feat(email-templates): add CRM nav link to email-templates"
```

---

### Task 26: Create `<SuggestionCard>`

**Files:**
- Create: `src/app/(dashboard)/crm/email-templates/components/suggestion-card.tsx`

- [ ] **Step 1: Write suggestion-card.tsx**

```tsx
"use client";
import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { Eye, Copy, Check, Send } from "lucide-react";
import type { EmailSuggestion } from "@/lib/email-templates/types";
import { SentModal } from "./sent-modal";

const SLOT_LABEL: Record<number, string> = {
  1: "Best-seller",
  2: "Sem-giro",
  3: "Novidade",
};

export function SuggestionCard({
  suggestion,
  onChanged,
}: {
  suggestion: EmailSuggestion;
  onChanged: () => void;
}) {
  const [copying, setCopying] = useState(false);
  const [copied, setCopied] = useState(false);
  const [sentOpen, setSentOpen] = useState(false);

  async function copyHtml() {
    setCopying(true);
    try {
      await navigator.clipboard.writeText(suggestion.rendered_html);
      await fetch(`/api/crm/email-templates/${suggestion.id}/select`, { method: "POST" });
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
      onChanged();
    } finally {
      setCopying(false);
    }
  }

  const segLabel = (suggestion.target_segment_payload as any)?.display_label ?? "—";
  const segSize = (suggestion.target_segment_payload as any)?.estimated_size ?? null;

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
            <div className="flex items-center gap-2 mb-1">
              <Badge variant="outline">Slot {suggestion.slot} · {SLOT_LABEL[suggestion.slot]}</Badge>
              {suggestion.status === "selected" && <Badge variant="secondary">Copiado {suggestion.selected_count}×</Badge>}
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
              Horários sugeridos: {suggestion.recommended_hours.map((h) => String(h).padStart(2, "0") + ":00").join(" · ")}
            </div>
            {suggestion.coupon_code && (
              <div className="text-xs text-emerald-500 mt-1 font-mono">
                🎟 {suggestion.coupon_code} · {suggestion.coupon_discount_percent}% off
                {suggestion.coupon_expires_at && ` · até ${new Date(suggestion.coupon_expires_at).toLocaleString("pt-BR")}`}
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
        <Button size="sm" onClick={copyHtml} disabled={copying}>
          {copied ? <Check className="w-4 h-4 mr-1" /> : <Copy className="w-4 h-4 mr-1" />}
          {copied ? "Copiado!" : "Copiar HTML"}
        </Button>
        <Button size="sm" variant="secondary" onClick={() => setSentOpen(true)}>
          <Send className="w-4 h-4 mr-1" /> Marcar disparado
        </Button>
      </div>
      <SentModal
        open={sentOpen}
        onClose={() => setSentOpen(false)}
        suggestion={suggestion}
        onDone={() => {
          setSentOpen(false);
          onChanged();
        }}
      />
    </Card>
  );
}
```

- [ ] **Step 2: Type-check + commit**

```bash
npx tsc --noEmit
git add src/app/\(dashboard\)/crm/email-templates/components/suggestion-card.tsx
git commit -m "feat(email-templates): SuggestionCard component"
```

---

### Task 27: Create `<SentModal>`

**Files:**
- Create: `src/app/(dashboard)/crm/email-templates/components/sent-modal.tsx`

- [ ] **Step 1: Write sent-modal.tsx**

```tsx
"use client";
import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { EmailSuggestion } from "@/lib/email-templates/types";

function nowLocalIso(): string {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
}

export function SentModal({
  open,
  onClose,
  suggestion,
  onDone,
}: {
  open: boolean;
  onClose: () => void;
  suggestion: EmailSuggestion;
  onDone: () => void;
}) {
  const [sentAt, setSentAt] = useState(nowLocalIso());
  const [hour, setHour] = useState<string>("");
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    try {
      await fetch(`/api/crm/email-templates/${suggestion.id}/sent`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          sent_at: new Date(sentAt).toISOString(),
          hour_chosen: hour ? parseInt(hour, 10) : null,
        }),
      });
      onDone();
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Marcar como disparado</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="sent_at">Data e hora do disparo</Label>
            <Input
              id="sent_at"
              type="datetime-local"
              value={sentAt}
              onChange={(e) => setSentAt(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label>Qual horário sugerido você usou? (opcional)</Label>
            <Select value={hour} onValueChange={setHour}>
              <SelectTrigger>
                <SelectValue placeholder="Outro / não informar" />
              </SelectTrigger>
              <SelectContent>
                {suggestion.recommended_hours.map((h) => (
                  <SelectItem key={h} value={String(h)}>
                    {String(h).padStart(2, "0")}:00
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>Cancelar</Button>
          <Button onClick={save} disabled={saving}>{saving ? "Salvando..." : "Salvar"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 2: Type-check + commit**

```bash
npx tsc --noEmit
git add src/app/\(dashboard\)/crm/email-templates/components/sent-modal.tsx
git commit -m "feat(email-templates): SentModal component"
```

---

### Task 28: Create `<HistoryTable>`

**Files:**
- Create: `src/app/(dashboard)/crm/email-templates/components/history-table.tsx`

- [ ] **Step 1: Write history-table.tsx**

```tsx
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
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { EmailSuggestion } from "@/lib/email-templates/types";

const SLOT_LABEL: Record<number, string> = { 1: "Best-seller", 2: "Sem-giro", 3: "Novidade" };

export function HistoryTable() {
  const [items, setItems] = useState<EmailSuggestion[]>([]);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState<string>("");
  const [slot, setSlot] = useState<string>("");

  useEffect(() => {
    setLoading(true);
    const params = new URLSearchParams({ days: "30" });
    if (status) params.set("status", status);
    if (slot) params.set("slot", slot);
    fetch(`/api/crm/email-templates/history?${params}`)
      .then((r) => r.json())
      .then((d) => setItems(d.suggestions ?? []))
      .finally(() => setLoading(false));
  }, [status, slot]);

  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <Select value={status} onValueChange={(v) => setStatus(v === "all" ? "" : v)}>
          <SelectTrigger className="w-40"><SelectValue placeholder="Estado" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos</SelectItem>
            <SelectItem value="pending">Pending</SelectItem>
            <SelectItem value="selected">Selected</SelectItem>
            <SelectItem value="sent">Sent</SelectItem>
          </SelectContent>
        </Select>
        <Select value={slot} onValueChange={(v) => setSlot(v === "all" ? "" : v)}>
          <SelectTrigger className="w-40"><SelectValue placeholder="Slot" /></SelectTrigger>
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
            <TableRow><TableCell colSpan={5}>Carregando...</TableCell></TableRow>
          )}
          {!loading && items.length === 0 && (
            <TableRow><TableCell colSpan={5} className="text-muted-foreground">Sem histórico</TableCell></TableRow>
          )}
          {items.map((s) => (
            <TableRow key={s.id}>
              <TableCell>{s.generated_for_date}</TableCell>
              <TableCell>{SLOT_LABEL[s.slot]}</TableCell>
              <TableCell className="max-w-xs truncate">{s.product_snapshot.name}</TableCell>
              <TableCell><Badge variant={s.status === "sent" ? "default" : "secondary"}>{s.status}</Badge></TableCell>
              <TableCell>{s.sent_at ? new Date(s.sent_at).toLocaleString("pt-BR") : "—"}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
```

- [ ] **Step 2: Type-check + commit**

```bash
npx tsc --noEmit
git add src/app/\(dashboard\)/crm/email-templates/components/history-table.tsx
git commit -m "feat(email-templates): HistoryTable component"
```

---

### Task 29: Create `<SettingsDrawer>`

**Files:**
- Create: `src/app/(dashboard)/crm/email-templates/components/settings-drawer.tsx`

- [ ] **Step 1: Write settings-drawer.tsx**

```tsx
"use client";
import { useEffect, useState } from "react";
import { Sheet, SheetContent, SheetTrigger, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Settings } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { EmailTemplateSettings } from "@/lib/email-templates/types";

export function SettingsDrawer() {
  const [open, setOpen] = useState(false);
  const [settings, setSettings] = useState<EmailTemplateSettings | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    fetch("/api/crm/email-templates/settings")
      .then((r) => r.json())
      .then(setSettings);
  }, [open]);

  async function save() {
    if (!settings) return;
    setSaving(true);
    try {
      const r = await fetch("/api/crm/email-templates/settings", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(settings),
      });
      const data = await r.json();
      setSettings(data);
    } finally {
      setSaving(false);
    }
  }

  function patch<K extends keyof EmailTemplateSettings>(k: K, v: EmailTemplateSettings[K]) {
    setSettings((s) => (s ? { ...s, [k]: v } : s));
  }

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button variant="outline" size="sm"><Settings className="w-4 h-4 mr-1" /> Configurações</Button>
      </SheetTrigger>
      <SheetContent className="w-full sm:max-w-md overflow-y-auto">
        <SheetHeader>
          <SheetTitle>Configurações · Email Templates</SheetTitle>
        </SheetHeader>
        {!settings && <div className="p-4">Carregando...</div>}
        {settings && (
          <div className="p-4 space-y-4">
            <div className="flex items-center justify-between">
              <Label htmlFor="enabled">Geração diária ativa</Label>
              <Switch
                id="enabled"
                checked={settings.enabled}
                onCheckedChange={(v) => patch("enabled", v)}
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Field label="Lookback best-seller (d)">
                <Input type="number" value={settings.bestseller_lookback_days} onChange={(e) => patch("bestseller_lookback_days", Number(e.target.value))} />
              </Field>
              <Field label="Estoque mín. best-seller">
                <Input type="number" value={settings.min_stock_bestseller} onChange={(e) => patch("min_stock_bestseller", Number(e.target.value))} />
              </Field>
              <Field label="Lookback sem-giro (d)">
                <Input type="number" value={settings.slowmoving_lookback_days} onChange={(e) => patch("slowmoving_lookback_days", Number(e.target.value))} />
              </Field>
              <Field label="Vendas máx. sem-giro">
                <Input type="number" value={settings.slowmoving_max_sales} onChange={(e) => patch("slowmoving_max_sales", Number(e.target.value))} />
              </Field>
              <Field label="Desconto sem-giro %">
                <Input type="number" min={5} max={20} value={settings.slowmoving_discount_percent} onChange={(e) => patch("slowmoving_discount_percent", Number(e.target.value))} />
              </Field>
              <Field label="Validade cupom (h)">
                <Input type="number" min={12} max={168} value={settings.slowmoving_coupon_validity_hours} onChange={(e) => patch("slowmoving_coupon_validity_hours", Number(e.target.value))} />
              </Field>
              <Field label="Lookback novidade (d)">
                <Input type="number" value={settings.newarrival_lookback_days} onChange={(e) => patch("newarrival_lookback_days", Number(e.target.value))} />
              </Field>
            </div>
            <div className="space-y-2">
              <Label>Provider de copy</Label>
              <Select value={settings.copy_provider} onValueChange={(v) => patch("copy_provider", v as any)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="template">Template (default)</SelectItem>
                  <SelectItem value="llm">LLM via team-agent</SelectItem>
                </SelectContent>
              </Select>
              {settings.copy_provider === "llm" && (
                <div>
                  <Label>Slug do agent</Label>
                  <Input
                    placeholder="copywriting | email-sequence"
                    value={settings.llm_agent_slug ?? ""}
                    onChange={(e) => patch("llm_agent_slug", e.target.value || null)}
                  />
                </div>
              )}
            </div>
            <Button onClick={save} disabled={saving} className="w-full">
              {saving ? "Salvando..." : "Salvar"}
            </Button>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <Label>{label}</Label>
      {children}
    </div>
  );
}
```

- [ ] **Step 2: Type-check + commit**

```bash
npx tsc --noEmit
git add src/app/\(dashboard\)/crm/email-templates/components/settings-drawer.tsx
git commit -m "feat(email-templates): SettingsDrawer component"
```

---

### Task 30: Create main `page.tsx` (Hoje + Histórico)

**Files:**
- Create: `src/app/(dashboard)/crm/email-templates/page.tsx`

- [ ] **Step 1: Write page.tsx**

```tsx
"use client";
import { useEffect, useState, useCallback } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { SuggestionCard } from "./components/suggestion-card";
import { HistoryTable } from "./components/history-table";
import { SettingsDrawer } from "./components/settings-drawer";
import type { EmailSuggestion } from "@/lib/email-templates/types";

export default function EmailTemplatesPage() {
  const [items, setItems] = useState<EmailSuggestion[]>([]);
  const [date, setDate] = useState<string>("");
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch("/api/crm/email-templates/active");
      const d = await r.json();
      setItems(d.suggestions ?? []);
      setDate(d.date ?? "");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  return (
    <div className="p-6 space-y-6 max-w-5xl mx-auto">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold">Email Templates</h1>
          <p className="text-muted-foreground text-sm">
            {items.length} sugestão{items.length === 1 ? "" : "ões"} prontas pra hoje · {date}
          </p>
        </div>
        <SettingsDrawer />
      </div>
      <Tabs defaultValue="today">
        <TabsList>
          <TabsTrigger value="today">Hoje</TabsTrigger>
          <TabsTrigger value="history">Histórico</TabsTrigger>
        </TabsList>
        <TabsContent value="today" className="space-y-4">
          {loading && <div>Carregando...</div>}
          {!loading && items.length === 0 && (
            <div className="border rounded p-8 text-center text-muted-foreground">
              Nenhuma sugestão pra hoje. Verifique se a feature está ativada em Configurações
              e se o cron já rodou (06:00 BRT).
            </div>
          )}
          {items.map((s) => (
            <SuggestionCard key={s.id} suggestion={s} onChanged={reload} />
          ))}
        </TabsContent>
        <TabsContent value="history">
          <HistoryTable />
        </TabsContent>
      </Tabs>
    </div>
  );
}
```

- [ ] **Step 2: Build a dev server smoke check**

```bash
npm run dev
# In another shell:
curl -i http://localhost:3000/crm/email-templates
# Expected: 200 (after login redirect handling).
# Type-check:
npx tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add src/app/\(dashboard\)/crm/email-templates/page.tsx
git commit -m "feat(email-templates): main page with Hoje/Histórico tabs"
```

---

## Phase 7 — Wiring & Smoke Tests

### Task 31: Document env vars

**Files:**
- Modify: `.env.local.example` (or equivalent — check what exists)

- [ ] **Step 1: Check existing env example**

```bash
ls -la .env*.example .env.example 2>/dev/null
```

- [ ] **Step 2: Add new vars**

Append to the env example file (path varies):

```
# Email Templates
EMAIL_COUNTDOWN_SECRET=<generate via: openssl rand -hex 32>
NEXT_PUBLIC_APP_URL=https://app.bulking.com.br
```

If no example file exists, create `.env.local.example` with these lines.

- [ ] **Step 3: Commit**

```bash
git add .env.local.example
git commit -m "docs(email-templates): document new env vars"
```

> **Action item for the deployer:** set `EMAIL_COUNTDOWN_SECRET` in Vercel project settings (Production + Preview). Use `openssl rand -hex 32` to generate.

---

### Task 32: Smoke test for libs (`scripts/test-email-templates-libs.ts`)

**Files:**
- Create: `scripts/test-email-templates-libs.ts`

- [ ] **Step 1: Write the smoke script**

```ts
// scripts/test-email-templates-libs.ts
/**
 * Smoke verification for email-templates pure libs.
 * Usage: npx tsx scripts/test-email-templates-libs.ts
 */
import { sign, verify, buildCountdownUrl } from "../src/lib/email-templates/countdown";
import { renderBestseller } from "../src/lib/email-templates/templates/bestseller";
import { renderSlowmoving } from "../src/lib/email-templates/templates/slowmoving";
import { renderNewarrival } from "../src/lib/email-templates/templates/newarrival";
import type { TemplateRenderContext } from "../src/lib/email-templates/types";

process.env.EMAIL_COUNTDOWN_SECRET = process.env.EMAIL_COUNTDOWN_SECRET || "test-secret";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(`ASSERTION FAILED: ${msg}`);
  console.log(`  ✓ ${msg}`);
}

console.log("[countdown] sign+verify roundtrip");
const expires = "2026-05-02T15:00:00.000Z";
const sig = sign(expires);
assert(verify(expires, sig), "valid sig verifies");
assert(!verify(expires, sig.slice(0, -2) + "ff"), "tampered sig fails");
const url = buildCountdownUrl({ base_url: "https://example.com", expires_at: new Date(expires) });
assert(url.startsWith("https://example.com/api/email-countdown.png?"), "url shape");
assert(url.includes(`expires=${encodeURIComponent(expires)}`), "url has expires");

console.log("[templates] render bestseller");
const baseCtx: TemplateRenderContext = {
  product: {
    vnda_id: "1",
    name: "Camiseta Hustle Preta",
    price: 89.9,
    image_url: "https://cdn.example.com/img.jpg",
    url: "https://www.bulking.com.br/produto/x",
  },
  copy: {
    subject: "Top 1 da semana",
    headline: "O mais vestido da semana.",
    lead: "Lorem ipsum.",
    cta_text: "Ver na loja",
    cta_url: "https://www.bulking.com.br/produto/x",
  },
  workspace: { name: "Bulking" },
};
const html1 = renderBestseller(baseCtx);
assert(html1.includes("BULKING"), "header present");
assert(html1.includes("TOP 1 DA SEMANA"), "badge present");
assert(html1.includes("Respect the Hustle"), "footer present");
assert(html1.length < 50000, "html size sane");

console.log("[templates] render slowmoving");
const html2 = renderSlowmoving({
  ...baseCtx,
  coupon: {
    code: "EMAIL-SLOWMOV-A7K2X",
    discount_percent: 10,
    expires_at: new Date(expires),
    countdown_url: url,
  },
});
assert(html2.includes("EMAIL-SLOWMOV-A7K2X"), "coupon code in html");
assert(html2.includes(url), "countdown img src");

console.log("[templates] render newarrival");
const html3 = renderNewarrival(baseCtx);
assert(html3.includes("ACABOU DE CHEGAR"), "newarrival badge");

console.log("\nALL SMOKE TESTS PASSED");
```

- [ ] **Step 2: Run it**

```bash
npx tsx scripts/test-email-templates-libs.ts
```
Expected: lines ending in `ALL SMOKE TESTS PASSED`. Any assertion failure stops with `ASSERTION FAILED`.

- [ ] **Step 3: Commit**

```bash
git add scripts/test-email-templates-libs.ts
git commit -m "test(email-templates): smoke verification for countdown + templates"
```

---

### Task 33: Smoke test for orchestrator (`scripts/test-email-templates-orchestrator.ts`)

**Files:**
- Create: `scripts/test-email-templates-orchestrator.ts`

- [ ] **Step 1: Write the orchestrator smoke script**

```ts
// scripts/test-email-templates-orchestrator.ts
/**
 * E2E dry-run for email-templates orchestrator on a real workspace.
 *
 * Pre-reqs:
 *   - Workspace must have email_template_settings.enabled=true
 *   - Workspace must have VNDA + GA4 connected
 *   - Migration 066 applied
 *   - EMAIL_COUNTDOWN_SECRET set
 *
 * Usage:
 *   WORKSPACE_ID=<uuid> npx tsx scripts/test-email-templates-orchestrator.ts
 *
 * Side effects:
 *   - Creates today's 3 suggestions (or upserts if already there)
 *   - Creates a real VNDA coupon for slot 2
 *   - Writes audit events
 */
import "dotenv/config";
import { generateForWorkspace } from "../src/lib/email-templates/orchestrator";

const workspace_id = process.env.WORKSPACE_ID;
if (!workspace_id) {
  console.error("WORKSPACE_ID env var required");
  process.exit(1);
}

(async () => {
  console.log(`Generating for workspace ${workspace_id}...`);
  const out = await generateForWorkspace(workspace_id);
  console.log(JSON.stringify(out, null, 2));

  const okCount = out.results.filter((r) => r.ok).length;
  console.log(`\n${okCount}/3 slots filled.`);
  if (okCount === 0) {
    console.error("All slots failed. Check audit table.");
    process.exit(1);
  }
})();
```

- [ ] **Step 2: Run it (manual, requires real workspace ID)**

```bash
WORKSPACE_ID=<paste real workspace uuid with VNDA+GA4 enabled> \
  npx tsx scripts/test-email-templates-orchestrator.ts
```
Expected: JSON summary; ≥1 slot filled.

- [ ] **Step 3: Verify in DB**

```bash
psql "$SUPABASE_DB_URL" -c "
  select slot, status, vnda_product_id, coupon_code
  from email_template_suggestions
  where workspace_id = '<workspace_id>'
    and generated_for_date = current_date - interval '0 day'
  order by slot;
"
```
Expected: up to 3 rows, slot 2 has `coupon_code`.

- [ ] **Step 4: Commit**

```bash
git add scripts/test-email-templates-orchestrator.ts
git commit -m "test(email-templates): orchestrator e2e dry-run script"
```

---

### Task 34: End-to-end manual verification

**Files:** none — manual verification.

- [ ] **Step 1: Trigger cron via curl**

```bash
curl -X POST https://app.bulking.com.br/api/cron/email-templates-refresh \
  -H "Authorization: Bearer $CRON_SECRET"
```
Expected: `{ "ok": true, "processed": N, "summaries": [...] }`

- [ ] **Step 2: Open the UI**

Navigate to `https://app.bulking.com.br/crm/email-templates` in a browser logged into a workspace with `enabled=true`. Expected:
- 3 cards visible (or fewer with empty-state messages explaining why a slot is missing)
- Each card shows product, segment, 3 horários, and slot 2 has cupom + countdown
- "Preview" opens iframe with rendered HTML
- "Copiar HTML" copies + sets badge "Copiado 1×"
- "Marcar disparado" opens modal, datetime defaults to now, hour select shows 3 options

- [ ] **Step 3: Verify countdown PNG renders**

```bash
SIG=$(node -e "
const c=require('crypto');
const exp='2026-05-02T15:00:00.000Z';
const s=process.env.EMAIL_COUNTDOWN_SECRET;
console.log(c.createHmac('sha256',s).update(exp).digest('hex'));
")
curl -o /tmp/countdown.png "https://app.bulking.com.br/api/email-countdown.png?expires=2026-05-02T15:00:00.000Z&sig=$SIG"
file /tmp/countdown.png
```
Expected: `PNG image data, 600 x 120`

- [ ] **Step 4: Verify audit table populated**

```sql
select event, count(*) from email_template_audit
where workspace_id = '<id>' and created_at > now() - interval '1 hour'
group by event;
```
Expected: rows for `generated`, possibly `coupon_created`, `selected`, `sent` after UI actions.

---

## Self-Review Checklist (run after writing the plan above)

**1. Spec coverage:**

| Spec Section | Tasks |
|--------------|-------|
| 1. Visão & Escopo (3 slots, fluxo, estados) | Task 1 (schema enforces 3 slots + states), 26 (UI badges), 21+22 (state transitions) |
| 2. Arquitetura | Tasks 2-15 (libs), 16 (cron), 18-23 (API), 25-30 (UI) |
| 3. Schema | Task 1 |
| 4. Algoritmos (picker/segments/hours/copy) | Tasks 5, 6, 7, 10 |
| 5. HTML email-safe + countdown + cupom | Tasks 8 (coupon), 9 (countdown URL), 11-14 (templates), 24 (countdown PNG) |
| 6. UI/API/Cron/Observabilidade | Tasks 16, 17, 18-23, 25-30, 31 (env), 32-34 (smoke) |
| 7. ADRs | Implicit in implementations (idempotency at task 1, freezing at task 15, fallback at task 10) |
| 8. v2/v3 | Out of scope per spec |

All sections covered.

**2. Placeholder scan:** Plan has explicit `> NOTE:` callouts at tasks 5, 6, 7, 8, 10, 18 — these point to real shape verification against existing code (signatures of `runGa4Report`, `searchVndaProducts`, `createFullCoupon`, `requireWorkspace`, `runAgent`). They are not TBDs; they tell the engineer to confirm the exact signature and adjust 1-2 lines of code. Acceptable.

**3. Type consistency:**
- `CopyOutput`, `CopyInput`, `CopyProvider`, `CopyProviderImpl` defined task 2; used in tasks 10, 15.
- `EmailTemplateSettings` defined task 2; used in tasks 3, 7, 15, 23, 29.
- `ProductSnapshot` defined task 2; used in tasks 7, 8, 11-15.
- `TemplateRenderContext` defined task 2; used in tasks 12-14, 32.
- `Slot` (1|2|3) consistent throughout.
- `audit.AuditEvent` enum is the only place those literals exist; orchestrator/api routes reference them by string.
- `SuggestionStatus` (`pending|selected|sent`) consistent in schema (task 1), types (task 2), API routes (tasks 21, 22), UI (tasks 26, 28).

No drift detected.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-04-30-email-templates-generator.md`.
