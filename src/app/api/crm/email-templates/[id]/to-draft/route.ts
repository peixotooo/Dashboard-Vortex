// src/app/api/crm/email-templates/[id]/to-draft/route.ts
//
// Promotes a daily auto-suggestion into an editable draft. Loads the
// suggestion (workspace-scoped), pulls its product snapshot, copy, and
// coupon, and constructs a Draft using buildDraftFromSuggestion. The
// resulting draft lands in email_template_drafts so the user can open
// it in the block editor and customize before sending.

import { NextRequest, NextResponse } from "next/server";
import { getWorkspaceContext, handleAuthError } from "@/lib/api-auth";
import { createAdminClient } from "@/lib/supabase-admin";
import { buildTreeDraftFromSuggestion } from "@/lib/email-templates/tree/presets";
import type { ProductSnapshot, Slot } from "@/lib/email-templates/types";

export const runtime = "nodejs";

interface SuggestionRow {
  id: string;
  workspace_id: string;
  slot: number;
  layout_id: string | null;
  product_snapshot: ProductSnapshot;
  copy: {
    subject: string;
    headline: string;
    lead: string;
    cta_text: string;
    cta_url: string;
  };
  coupon_code: string | null;
  coupon_discount_percent: number | null;
  coupon_expires_at: string | null;
}

interface ShelfRow {
  product_id: string;
  name: string;
  price: number | null;
  sale_price: number | null;
  image_url: string | null;
  product_url: string | null;
}

function abs(u: string | null): string {
  if (!u) return "";
  return u.startsWith("//") ? `https:${u}` : u;
}

interface ToDraftBody {
  /** Overrides do conteúdo da sugestão (subject/headline/lead/CTA).
   *  Usado pela tela "Disparar sugestão" quando o usuário edita inline
   *  e clica "Salvar como rascunho". Campos não informados caem pro
   *  valor original da sugestão. */
  copy_override?: Partial<{
    subject: string;
    headline: string;
    lead: string;
    cta_text: string;
    cta_url: string;
  }>;
  retention_context?: {
    list_id?: string;
    audience?: string;
    playbook?: string;
    playbook_id?: string;
    run?: string;
  };
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { workspaceId } = await getWorkspaceContext(req);
    const { id } = await params;
    const body = (await req.json().catch(() => ({}))) as ToDraftBody;
    const sb = createAdminClient();

    // Use select(*) so this keeps working whether or not migration-069
    // (layout_id column on email_template_suggestions) has been run yet —
    // production was 500'ing on a select that referenced layout_id directly.
    const { data: sug, error: sugErr } = await sb
      .from("email_template_suggestions")
      .select("*")
      .eq("workspace_id", workspaceId)
      .eq("id", id)
      .maybeSingle();
    if (sugErr) {
      console.error("[to-draft] suggestion select failed:", sugErr);
      return NextResponse.json({ error: sugErr.message }, { status: 500 });
    }
    if (!sug) return NextResponse.json({ error: "suggestion not found" }, { status: 404 });

    const s = sug as unknown as SuggestionRow;

    // Pull related products from the workspace's shelf so the editor's grid
    // lights up with real catalog items.
    const { data: relRows } = await sb
      .from("shelf_products")
      .select("product_id, name, price, sale_price, image_url, product_url")
      .eq("workspace_id", workspaceId)
      .eq("active", true)
      .eq("in_stock", true)
      .not("image_url", "is", null)
      .neq("product_id", s.product_snapshot.vnda_id)
      .order("created_at", { ascending: false })
      .limit(9);
    const related: ProductSnapshot[] = ((relRows ?? []) as ShelfRow[]).map((r) => ({
      vnda_id: r.product_id,
      name: r.name,
      price: Number(r.sale_price ?? r.price ?? 0),
      old_price:
        r.sale_price != null && r.price != null && Number(r.price) > Number(r.sale_price)
          ? Number(r.price)
          : undefined,
      image_url: abs(r.image_url),
      url: r.product_url ?? "",
    }));

    const coupon =
      s.coupon_code && s.coupon_expires_at
        ? {
            code: s.coupon_code,
            discount_percent: Number(s.coupon_discount_percent ?? 10),
            expires_at: new Date(s.coupon_expires_at),
          }
        : undefined;

    // Aplica copy_override do body por cima da copy original — campos
    // vazios mantêm o original.
    const mergedCopy = {
      subject: body.copy_override?.subject?.trim() || s.copy.subject,
      headline: body.copy_override?.headline?.trim() || s.copy.headline,
      lead: body.copy_override?.lead?.trim() || s.copy.lead,
      cta_text: body.copy_override?.cta_text?.trim() || s.copy.cta_text,
      cta_url: body.copy_override?.cta_url?.trim() || s.copy.cta_url,
    };

    const tree = buildTreeDraftFromSuggestion({
      workspace_id: workspaceId,
      // Use the layout the cron actually rendered with (post migration-069).
      // Older suggestions without a stored layout_id fall back to "classic".
      layoutId: s.layout_id ?? "classic",
      slot: s.slot as Slot,
      primary: s.product_snapshot,
      related,
      copy: mergedCopy,
      coupon,
    });

    const { data: inserted, error: insErr } = await sb
      .from("email_template_drafts")
      .insert({
        workspace_id: workspaceId,
        layout_id: tree.layout_id ?? null,
        name: tree.name,
        // Tree-engine drafts: meta carries engine="tree" and the JSONB blocks
        // column stores the section list. Render endpoint dispatches on engine.
        meta: {
          ...tree.meta,
          engine: "tree",
          ...(body.retention_context
            ? {
                retention_context: {
                  list_id: body.retention_context.list_id,
                  audience: body.retention_context.audience,
                  playbook: body.retention_context.playbook,
                  playbook_id: body.retention_context.playbook_id,
                  run: body.retention_context.run,
                },
              }
            : {}),
        },
        blocks: tree.sections,
      })
      .select()
      .single();
    if (insErr) {
      console.error("[to-draft] draft insert failed:", insErr);
      return NextResponse.json({ error: insErr.message }, { status: 500 });
    }

    return NextResponse.json({ draft: inserted });
  } catch (err) {
    console.error("[to-draft] unhandled error:", err);
    return handleAuthError(err);
  }
}
