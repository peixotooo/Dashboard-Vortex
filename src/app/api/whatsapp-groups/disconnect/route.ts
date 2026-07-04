import { NextRequest, NextResponse } from "next/server";
import { getWorkspaceContext, handleAuthError } from "@/lib/api-auth";
import {
  getWapiConfig,
  disconnectInstance,
  updateWapiConnected,
} from "@/lib/wapi-api";

export async function POST(request: NextRequest) {
  try {
    const { workspaceId } = await getWorkspaceContext(request);

    const config = await getWapiConfig(workspaceId);
    if (!config)
      return NextResponse.json(
        { error: "W-API not configured" },
        { status: 400 }
      );

    try {
      const result = await disconnectInstance(config);
      await updateWapiConnected(workspaceId, false);
      return NextResponse.json({
        ok: true,
        instanceId: result.instanceId || config.instanceId,
        message: result.message || null,
      });
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      // W-API responde 404 com "Instância não está online para realizar logout"
      // quando a sessão WhatsApp ja caiu mas o nosso banco ainda tinha
      // connected=true. Isso e exatamente o caso que precisamos resolver:
      // tratar como sucesso e marcar como desconectada.
      const alreadyOffline =
        errMsg.includes("não está online") ||
        errMsg.includes("nao esta online") ||
        errMsg.includes("not online") ||
        errMsg.includes("W-API 404");
      if (alreadyOffline) {
        await updateWapiConnected(workspaceId, false);
        return NextResponse.json({
          ok: true,
          instanceId: config.instanceId,
          message: "Instancia ja estava offline — status sincronizado.",
        });
      }
      throw err;
    }
  } catch (error) {
    return handleAuthError(error);
  }
}
