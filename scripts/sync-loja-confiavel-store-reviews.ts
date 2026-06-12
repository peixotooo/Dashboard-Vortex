/* eslint-disable @typescript-eslint/no-explicit-any */
import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });

import { createHash } from "crypto";
import { createClient } from "@supabase/supabase-js";

type ParsedStoreReview = {
  external_id: string;
  rating: number;
  comment: string | null;
  author_name: string | null;
  location: string | null;
  reviewed_at: string;
  page: number;
  index: number;
  process_rating: number | null;
  delivery_rating: number | null;
  service_rating: number | null;
};

const SOURCE = "loja-confiavel";
const DEFAULT_SLUG = "bulking";
const DEFAULT_WORKSPACE = "36f37e88-a9c7-4ed7-89b9-45e62b8bba04";

function argValue(name: string): string | undefined {
  return process.argv.find((arg) => arg.startsWith(`${name}=`))?.slice(name.length + 1);
}

function decodeHtml(input: string): string {
  return input
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)))
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

function stripTags(input: string): string {
  return decodeHtml(input.replace(/<[^>]*>/g, " "));
}

function matchOne(input: string, pattern: RegExp): string | null {
  const match = input.match(pattern);
  return match ? decodeHtml(match[1]) : null;
}

function hashReview(parts: Array<string | number | null | undefined>): string {
  return createHash("sha256")
    .update(parts.map((part) => String(part ?? "")).join("|"))
    .digest("hex")
    .slice(0, 24);
}

function parseStars(block: string, title: string): number | null {
  const escaped = title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = block.match(new RegExp(`<div[^>]+title="${escaped}"[\\s\\S]*?<\\/div>`, "i"));
  if (!match) return null;
  return (match[0].match(/yv-fa-star yv-star-color/g) || []).length;
}

function parseReviews(html: string, page: number): ParsedStoreReview[] {
  const blocks = html
    .split(/<div itemprop="review" itemscope itemtype="http:\/\/schema\.org\/Review">/i)
    .slice(1);

  return blocks.map((block, index) => {
    const rating = Number(matchOne(block, /<meta itemprop="ratingValue" content="(\d+)"/i)) || 0;
    const date = matchOne(block, /itemprop="datePublished" content="([^"]+)"/i);
    const author = matchOne(block, /<strong class="yv-user-name"[^>]*>([\s\S]*?)<\/strong>/i);
    const location = matchOne(block, /<span class="yv-author-local">([\s\S]*?)<\/span>/i);
    const rawBody = matchOne(block, /<span itemprop="reviewBody">([\s\S]*?)<\/span>/i);
    const cleanBody = rawBody && !/nao deixou comentario|não deixou comentário/i.test(rawBody)
      ? rawBody
      : null;

    if (!rating || !date) {
      throw new Error(`Review sem rating/data na página ${page}, índice ${index + 1}`);
    }

    const processRating = parseStars(block, "Processo de compra");
    const deliveryRating = parseStars(block, "Entrega");
    const serviceRating = parseStars(block, "Atendimento");
    const externalId = hashReview([
      date,
      author,
      location,
      rating,
      cleanBody,
      processRating,
      deliveryRating,
      serviceRating,
    ]);
    return {
      external_id: externalId,
      rating,
      comment: cleanBody,
      author_name: author,
      location,
      reviewed_at: `${date}T12:00:00.000Z`,
      page,
      index: index + 1,
      process_rating: processRating,
      delivery_rating: deliveryRating,
      service_rating: serviceRating,
    };
  });
}

async function fetchPage(slug: string, page: number): Promise<string> {
  const url = page <= 1
    ? `https://www.lojaconfiavel.com/${encodeURIComponent(slug)}`
    : `https://www.lojaconfiavel.com/${encodeURIComponent(slug)}?pag=${page}`;
  const res = await fetch(url, { headers: { "User-Agent": "DashboardVortex/1.0" } });
  if (!res.ok) throw new Error(`Loja Confiavel HTTP ${res.status} page=${page}`);
  return res.text();
}

async function scrapeAll(slug: string, maxPages?: number): Promise<ParsedStoreReview[]> {
  const all: ParsedStoreReview[] = [];
  for (let page = 1; ; page++) {
    if (maxPages && page > maxPages) break;
    const html = await fetchPage(slug, page);
    const rows = parseReviews(html, page);
    if (rows.length === 0) break;
    all.push(...rows);
    if (!html.includes(`?pag=${page + 1}`) && !html.includes(`?pag=${page + 1}&`)) break;
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  return all;
}

function disambiguateDuplicateIds(rows: ParsedStoreReview[]): {
  rows: ParsedStoreReview[];
  duplicateGroups: number;
  duplicateRows: number;
} {
  const seen = new Map<string, number>();
  let duplicateGroups = 0;
  let duplicateRows = 0;

  return {
    rows: rows.map((row) => {
      const count = seen.get(row.external_id) || 0;
      seen.set(row.external_id, count + 1);
      if (count === 0) return row;
      if (count === 1) duplicateGroups++;
      duplicateRows++;
      return { ...row, external_id: `${row.external_id}-${count + 1}` };
    }),
    duplicateGroups,
    duplicateRows,
  };
}

function toDbRow(workspaceId: string, review: ParsedStoreReview) {
  const metadata = [
    review.location ? `Local: ${review.location}` : null,
    review.process_rating ? `Processo: ${review.process_rating}/5` : null,
    review.delivery_rating ? `Entrega: ${review.delivery_rating}/5` : null,
    review.service_rating ? `Atendimento: ${review.service_rating}/5` : null,
  ]
    .filter(Boolean)
    .join(" | ");
  const comment = [review.comment, metadata ? `[${metadata}]` : null]
    .filter(Boolean)
    .join("\n\n");

  return {
    workspace_id: workspaceId,
    order_id: `${SOURCE}:${review.external_id}`,
    order_code: null,
    rating: review.rating,
    comment: comment || null,
    author_name: review.author_name,
    author_email: null,
    status: "published",
    review_request_id: null,
    created_at: review.reviewed_at,
    updated_at: new Date().toISOString(),
  };
}

async function main() {
  const workspaceId = argValue("--workspace") || DEFAULT_WORKSPACE;
  const slug = argValue("--slug") || DEFAULT_SLUG;
  const maxPages = argValue("--max-pages") ? Number(argValue("--max-pages")) : undefined;
  const apply = process.argv.includes("--apply");

  const scrapedRows = await scrapeAll(slug, maxPages);
  const {
    rows,
    duplicateGroups,
    duplicateRows,
  } = disambiguateDuplicateIds(scrapedRows);
  const withComment = rows.filter((row) => row.comment).length;
  const byRating = rows.reduce<Record<number, number>>((acc, row) => {
    acc[row.rating] = (acc[row.rating] || 0) + 1;
    return acc;
  }, {});

  console.log(JSON.stringify({
    mode: apply ? "apply" : "dry-run",
    slug,
    pages: rows.length ? rows[rows.length - 1].page : 0,
    total: rows.length,
    with_comment: withComment,
    duplicate_groups: duplicateGroups,
    duplicate_rows_disambiguated: duplicateRows,
    by_rating: byRating,
    sample: rows.slice(0, 5),
  }, null, 2));

  if (!apply) return;

  const url = (process.env.NEXT_PUBLIC_SUPABASE_URL || "").trim();
  const key = (process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  if (!url || !key) throw new Error("NEXT_PUBLIC_SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY são obrigatórios");

  const admin = createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  let insertedOrUpdated = 0;
  for (let i = 0; i < rows.length; i += 500) {
    const batch = rows.slice(i, i + 500).map((row) => toDbRow(workspaceId, row));
    const { data, error } = await admin
      .from("store_reviews")
      .upsert(batch, { onConflict: "workspace_id,order_id" })
      .select("id");
    if (error) throw new Error(error.message);
    insertedOrUpdated += data?.length || 0;
  }
  console.log(`Importados/atualizados em store_reviews: ${insertedOrUpdated}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
