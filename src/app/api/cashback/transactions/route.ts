import { NextRequest, NextResponse } from "next/server";
import { authRoute } from "@/lib/cashback/route-helpers";

export const maxDuration = 15;

const STATUSES = ["AGUARDANDO_DEPOSITO", "ATIVO", "USADO", "EXPIRADO", "CANCELADO", "REATIVADO"];

export async function GET(request: NextRequest) {
  const { auth, error } = await authRoute(request);
  if (error) return error;

  const params = request.nextUrl.searchParams;
  const status = params.get("status");
  const email = params.get("email");
  const sinceDays = params.get("sinceDays");
  const expiredInDays = params.get("expiredInDays"); // expired within last N days
  const minValue = params.get("minValue");
  const page = Math.max(1, Number(params.get("page") || 1));
  const pageSize = Math.min(200, Math.max(1, Number(params.get("pageSize") || 50)));

  let query = auth!.admin
    .from("cashback_transactions")
    .select("*", { count: "exact" })
    .eq("workspace_id", auth!.workspaceId)
    .order("confirmado_em", { ascending: false });

  if (status && STATUSES.includes(status)) {
    query = query.eq("status", status);
  }
  if (email) {
    query = query.ilike("email", `%${email}%`);
  }
  if (sinceDays) {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() - Number(sinceDays));
    query = query.gte("confirmado_em", d.toISOString());
  }
  if (expiredInDays) {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() - Number(expiredInDays));
    query = query.gte("estornado_em", d.toISOString());
  }
  if (minValue) {
    query = query.gte("valor_cashback", Number(minValue));
  }

  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;
  const { data, count, error: dbErr } = await query.range(from, to);

  if (dbErr) return NextResponse.json({ error: dbErr.message }, { status: 500 });

  return NextResponse.json({
    transactions: data ?? [],
    pagination: { page, pageSize, total: count ?? 0 },
  });
}
