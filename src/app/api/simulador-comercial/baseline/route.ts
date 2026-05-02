import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";

function createSupabase(request: NextRequest) {
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll() {},
      },
    }
  );
}

type VendaRow = {
  valor: number | null;
  data_compra: string | null;
};

const CHUNK = 1000;
const HARD_CAP = 50000;

export async function GET(request: NextRequest) {
  try {
    const supabase = createSupabase(request);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

    const workspaceId = request.headers.get("x-workspace-id") || "";
    if (!workspaceId) return NextResponse.json({ error: "Workspace not specified" }, { status: 400 });

    const fim = new Date();
    const inicio = new Date(fim);
    inicio.setDate(inicio.getDate() - 30);

    const startISO = inicio.toISOString();
    const endISO = fim.toISOString();

    const all: VendaRow[] = [];
    let offset = 0;
    while (offset < HARD_CAP) {
      const { data, error } = await supabase
        .from("crm_vendas")
        .select("valor, data_compra")
        .eq("workspace_id", workspaceId)
        .gte("data_compra", startISO)
        .lte("data_compra", endISO)
        .order("data_compra", { ascending: false })
        .range(offset, offset + CHUNK - 1);
      if (error) {
        console.error("[Baseline] page error:", error.message);
        break;
      }
      const rows = (data || []) as VendaRow[];
      all.push(...rows);
      if (rows.length < CHUNK) break;
      offset += CHUNK;
    }

    const valid = all.filter((r) => Number(r.valor ?? 0) > 0 && r.data_compra);
    const totalReceita = valid.reduce((s, r) => s + Number(r.valor ?? 0), 0);
    const numPedidos = valid.length;
    const ticketMedio = numPedidos > 0 ? totalReceita / numPedidos : 0;

    const dias = new Set<string>();
    for (const r of valid) {
      if (r.data_compra) dias.add(r.data_compra.slice(0, 10));
    }
    const diasComVenda = dias.size;
    const receitaMediaDiaria = diasComVenda > 0 ? totalReceita / diasComVenda : 0;

    return NextResponse.json({
      inicio: startISO,
      fim: endISO,
      totalReceita,
      numPedidos,
      ticketMedio,
      diasComVenda,
      receitaMediaDiaria,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
