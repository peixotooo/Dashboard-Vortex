import { isCapiConfigured, sendCapiEvent } from "@/lib/meta-capi";
import type { VndaWebhookPayload } from "@/lib/vnda-webhook";
import { createAdminClient } from "@/lib/supabase-admin";
import { isWorkspaceCapiEnabled } from "@/lib/meta-capi-settings";

// Workspace gate. The CAPI pixel/token in env vars points at the BK COM
// pixel, so we MUST only fire Purchase events for the workspace that owns
// that pixel. Set META_CAPI_VNDA_WORKSPACE_ID to the workspace UUID that
// should forward purchases. Comma-separated for multiple workspaces.
const ALLOWED_WORKSPACES = (process.env.META_CAPI_VNDA_WORKSPACE_ID || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

function workspaceAllowed(workspaceId: string): boolean {
  if (ALLOWED_WORKSPACES.length === 0) return false;
  return ALLOWED_WORKSPACES.includes(workspaceId);
}

// Deterministic event_id so the browser-side and webhook-side Purchase
// events deduplicate on Meta's end. Meta merges user_data across the two,
// giving us fbp/fbc from the browser AND the full hashed PII from the
// server — maxing out Event Match Quality without double-counting revenue.
export function purchaseEventId(orderCode: string | number): string {
  return `vtx_purchase_${String(orderCode)}`;
}

// Build event_source_url so Meta has a context page for attribution.
// VNDA's order confirmation lives at /pedido/{code}.
function buildSourceUrl(storeHost: string | null, code: string): string | undefined {
  if (!storeHost) return undefined;
  const host = storeHost.replace(/^https?:\/\//, "").replace(/\/$/, "");
  return `https://${host}/pedido/${encodeURIComponent(code)}`;
}

export interface DispatchVndaPurchaseInput {
  workspaceId: string;
  storeHost?: string | null;
  payload: VndaWebhookPayload;
}

interface AttributionRow {
  fbc: string | null;
  fbp: string | null;
  client_ip: string | null;
  user_agent: string | null;
  captured_at: string;
}

// Fetch the latest browser-side attribution snapshot for this email/workspace.
// Returns null if none — caller proceeds without those signals.
async function fetchAttribution(
  workspaceId: string,
  email: string
): Promise<AttributionRow | null> {
  try {
    const admin = createAdminClient();
    const { data, error } = await admin
      .from("meta_attribution")
      .select("fbc, fbp, client_ip, user_agent, captured_at")
      .eq("workspace_id", workspaceId)
      .eq("email", email.trim().toLowerCase())
      .order("captured_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error || !data) return null;
    return data as AttributionRow;
  } catch {
    return null;
  }
}

export async function dispatchVndaPurchaseToCapi(
  input: DispatchVndaPurchaseInput
): Promise<{ ok: boolean; reason?: string; fbtrace_id?: string }> {
  if (!isCapiConfigured()) return { ok: false, reason: "not_configured" };
  if (!(await isWorkspaceCapiEnabled(input.workspaceId))) {
    return { ok: false, reason: "disabled" };
  }
  if (!workspaceAllowed(input.workspaceId)) {
    return { ok: false, reason: "workspace_not_allowed" };
  }

  const { payload } = input;

  // Skip cancellations / refunds — only confirmed orders count as Purchase.
  const status = (payload.status || "").toLowerCase();
  if (status === "cancelled" || status === "canceled" || status === "refunded") {
    return { ok: false, reason: `status_${status}` };
  }

  const code = payload.code || String(payload.id);
  const phone = payload.phone
    ? `${payload.phone_area || ""}${payload.phone}`.trim()
    : payload.cellphone
    ? `${payload.cellphone_area || ""}${payload.cellphone}`.trim()
    : payload.shipping_address?.phone || null;

  const city = payload.shipping_address?.city || payload.city || null;
  const state = payload.shipping_address?.state || payload.state || null;
  const zip = payload.shipping_address?.zip || payload.zip || null;
  const firstName = payload.first_name || payload.shipping_address?.first_name || null;
  const lastName = payload.last_name || payload.shipping_address?.last_name || null;

  const items = payload.items || [];
  // content_ids: prefer SKU (matches catalog feed). reference (product id) as fallback.
  const contentIds = items
    .map((it) => (it.sku ? String(it.sku) : it.reference ? String(it.reference) : ""))
    .filter(Boolean);

  const contents = items.map((it) => ({
    id: String(it.sku || it.reference || it.id),
    quantity: it.quantity,
    item_price: it.price,
  }));

  const numItems = items.reduce((acc, it) => acc + (it.quantity || 0), 0);

  // Time of the actual confirmation, not now() — Meta accepts up to 7 days back.
  const confirmedAt =
    payload.confirmed_at || payload.received_at || payload.updated_at || null;
  const eventTime = confirmedAt
    ? Math.floor(new Date(confirmedAt).getTime() / 1000)
    : Math.floor(Date.now() / 1000);

  // external_id: CPF is the strongest cross-session identifier we have. Falls
  // back to email so we still get something hashed in this slot.
  const externalId = payload.cpf || payload.email || null;

  // Browser-side signals captured at checkout-email-entry time.
  const attribution = payload.email
    ? await fetchAttribution(input.workspaceId, payload.email)
    : null;

  const result = await sendCapiEvent({
    event_name: "Purchase",
    event_id: purchaseEventId(code),
    event_time: eventTime,
    event_source_url: buildSourceUrl(input.storeHost ?? null, code),
    action_source: "website",
    user: {
      email: payload.email,
      phone,
      first_name: firstName,
      last_name: lastName,
      city,
      state,
      zip,
      country: "br",
      birthdate: payload.birthdate,
      external_id: externalId,
      fbc: attribution?.fbc || undefined,
      fbp: attribution?.fbp || undefined,
      client_ip_address: attribution?.client_ip || undefined,
      client_user_agent: attribution?.user_agent || undefined,
    },
    custom: {
      content_ids: contentIds.length ? contentIds : undefined,
      content_type: contentIds.length ? "product" : undefined,
      contents: contents.length ? contents : undefined,
      value: payload.total,
      currency: "BRL",
      num_items: numItems || undefined,
      order_id: code,
    },
  });

  if (!result.ok) {
    return { ok: false, reason: result.error, fbtrace_id: result.fbtrace_id };
  }
  return { ok: true, fbtrace_id: result.fbtrace_id };
}
