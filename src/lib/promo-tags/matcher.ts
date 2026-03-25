import { createAdminClient } from "@/lib/supabase-admin";

export interface PromoTagRule {
  badge_text: string;
  badge_bg_color: string;
  badge_text_color: string;
  badge_font_size: string;
  badge_border_radius: string;
  badge_position: string;
  badge_padding: string;
  priority: number;
}

interface ShelfProductRow {
  product_id: string;
  tags: unknown;
  category: string | null;
  name: string;
}

/**
 * Checks if a shelf_products row matches a VNDA tag name.
 * Tags in shelf_products.tags are stored as:
 *   { vnda_tags: [{ name: string, type: string }], on_sale?: boolean }
 * or sometimes as a plain array of { name, type } objects.
 */
function productMatchesTag(product: ShelfProductRow, tagName: string): boolean {
  const tags = product.tags;
  if (!tags || typeof tags !== "object") return false;

  const target = tagName.toLowerCase().trim();

  // Format: { vnda_tags: [...] }
  const obj = tags as Record<string, unknown>;
  const vndaTags = obj.vnda_tags;
  if (Array.isArray(vndaTags)) {
    return vndaTags.some((t) => {
      if (typeof t === "string") return t.toLowerCase().trim() === target;
      if (t && typeof t === "object" && "name" in t)
        return ((t as { name: string }).name || "").toLowerCase().trim() === target;
      return false;
    });
  }

  // Fallback: plain array
  if (Array.isArray(tags)) {
    return (tags as unknown[]).some((t) => {
      if (typeof t === "string") return t.toLowerCase().trim() === target;
      if (t && typeof t === "object" && "name" in t)
        return ((t as { name: string }).name || "").toLowerCase().trim() === target;
      return false;
    });
  }

  return false;
}

/**
 * Computes a map of product_id → matching promo tag rules.
 * Used by the public /api/promo-tags/products endpoint.
 */
export async function computePromoTagMatches(
  workspaceId: string
): Promise<Record<string, PromoTagRule[]>> {
  const admin = createAdminClient();

  // 1. Fetch all enabled rules, ordered by priority DESC
  const { data: rules, error: rulesError } = await admin
    .from("promo_tag_configs")
    .select("*")
    .eq("workspace_id", workspaceId)
    .eq("enabled", true)
    .order("priority", { ascending: false });

  if (rulesError || !rules || rules.length === 0) return {};

  const matches: Record<string, PromoTagRule[]> = {};

  for (const rule of rules) {
    let productIds: string[] = [];
    const safeRule: PromoTagRule = {
      badge_text: rule.badge_text,
      badge_bg_color: rule.badge_bg_color,
      badge_text_color: rule.badge_text_color,
      badge_font_size: rule.badge_font_size,
      badge_border_radius: rule.badge_border_radius,
      badge_position: rule.badge_position,
      badge_padding: rule.badge_padding,
      priority: rule.priority,
    };

    switch (rule.match_type) {
      case "tag": {
        // Fetch all active products and filter by tag locally
        // (tags are stored as JSONB, not queryable with simple eq)
        const { data: products } = await admin
          .from("shelf_products")
          .select("product_id, tags, category, name")
          .eq("workspace_id", workspaceId)
          .eq("active", true)
          .eq("in_stock", true);

        productIds = (products || [])
          .filter((p) => productMatchesTag(p as ShelfProductRow, rule.match_value))
          .map((p) => p.product_id);
        break;
      }

      case "category": {
        const { data: products } = await admin
          .from("shelf_products")
          .select("product_id")
          .eq("workspace_id", workspaceId)
          .eq("active", true)
          .eq("in_stock", true)
          .ilike("category", rule.match_value);

        productIds = (products || []).map((p) => p.product_id);
        break;
      }

      case "name_pattern": {
        // Convert user wildcards (*) to SQL ILIKE pattern (%)
        // First escape existing SQL wildcards in user input
        const pattern = rule.match_value
          .replace(/%/g, "\\%")
          .replace(/_/g, "\\_")
          .replace(/\*/g, "%");

        const { data: products } = await admin
          .from("shelf_products")
          .select("product_id")
          .eq("workspace_id", workspaceId)
          .eq("active", true)
          .eq("in_stock", true)
          .ilike("name", pattern);

        productIds = (products || []).map((p) => p.product_id);
        break;
      }

      case "product_ids": {
        productIds = rule.match_value
          .split(",")
          .map((id: string) => id.trim())
          .filter(Boolean);
        break;
      }
    }

    for (const pid of productIds) {
      if (!matches[pid]) matches[pid] = [];
      matches[pid].push(safeRule);
    }
  }

  return matches;
}
