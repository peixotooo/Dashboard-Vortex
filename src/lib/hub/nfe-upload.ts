import { createAdminClient } from "@/lib/supabase-admin";
import { eccosys } from "@/lib/eccosys/client";
import { ml } from "@/lib/ml/client";
import type { HubOrder } from "@/types/hub";

interface EccosysNFe {
  id?: number;
  numero?: string | number;
  chave_acesso?: string | null;
  chaveAcesso?: string | null;
  chaveDeAcesso?: string | null;
  serie?: string | number;
  tipo?: string;
  dataEmissao?: string;
  totalFaturado?: number;
  codigoRastreamento?: string | null;
  [key: string]: unknown;
}

function unwrap<T>(result: T | T[]): T {
  return Array.isArray(result) ? result[0] : result;
}

interface NFeUploadResult {
  success: boolean;
  nfe_chave?: string;
  error?: string;
}

/**
 * Upload NF-e XML from Eccosys to Mercado Livre pack.
 *
 * Flow:
 * 1. Resolve ml_pack_id (fetch from ML if not stored)
 * 2. Fetch NF-e details from Eccosys (/nfes/{numero})
 * 3. Fetch NF-e XML from Eccosys (/xml-nfes/{numero})
 * 4. Upload XML to ML (/packs/{pack_id}/fiscal_documents)
 * 5. Update hub_orders with NF-e data and sent timestamp
 */
export async function uploadNFeToML(
  order: HubOrder,
  workspaceId: string
): Promise<NFeUploadResult> {
  const supabase = createAdminClient();

  if (!order.ecc_nfe_numero) {
    return { success: false, error: "Sem ecc_nfe_numero" };
  }

  // 1. Resolve ml_shipment_id (required for /shipments/{id}/invoice_data endpoint)
  if (!order.ml_shipment_id) {
    try {
      const mlOrder = await ml.get<{ shipping?: { id?: number } }>(
        `/orders/${order.ml_order_id}`,
        workspaceId
      );
      const shipmentId = mlOrder.shipping?.id || null;
      if (!shipmentId) {
        return { success: false, error: "Pedido ML sem shipment_id" };
      }
      order.ml_shipment_id = shipmentId;
      await supabase
        .from("hub_orders")
        .update({ ml_shipment_id: shipmentId })
        .eq("id", order.id);
    } catch (err) {
      return {
        success: false,
        error: `Erro ao buscar shipment_id: ${err instanceof Error ? err.message : "desconhecido"}`,
      };
    }
  }

  // 2. Fetch NF-e details from Eccosys (response can be array or object)
  let nfe: EccosysNFe;
  try {
    const rawResult = await eccosys.get<EccosysNFe | EccosysNFe[]>(
      `/nfes/${order.ecc_nfe_numero}`,
      workspaceId,
      { $serie: "1", $tipoNota: "S", $idUnidadeNegocio: "0" }
    );
    nfe = unwrap(rawResult);
  } catch (err) {
    return {
      success: false,
      error: `Erro ao buscar NF ${order.ecc_nfe_numero}: ${err instanceof Error ? err.message : "desconhecido"}`,
    };
  }

  // Try multiple possible field names for the access key
  const chaveAcesso =
    nfe.chave_acesso ||
    nfe.chaveAcesso ||
    nfe.chaveDeAcesso ||
    (nfe.chaveNFe as string | undefined) ||
    (nfe.chave as string | undefined) ||
    null;

  if (!chaveAcesso) {
    const keys = nfe ? Object.keys(nfe).join(", ") : "(empty)";
    return {
      success: false,
      error: `NF ${order.ecc_nfe_numero} sem chave de acesso. Campos: ${keys}`,
    };
  }

  // 3. Fetch NF-e XML from Eccosys
  let xmlContent: string;
  try {
    xmlContent = await eccosys.getText(
      `/xml-nfes/${order.ecc_nfe_numero}`,
      workspaceId,
      { $tipo: "S", $serie: "1" }
    );
  } catch (err) {
    return {
      success: false,
      error: `Erro ao buscar XML: ${err instanceof Error ? err.message : "desconhecido"}`,
    };
  }

  if (!xmlContent || xmlContent.length < 100) {
    return { success: false, error: "XML da NF-e vazio ou invalido" };
  }

  // Eccosys returns JSON envelope: { "xmls": ["<?xml..."] }
  const trimmed = xmlContent.trim();
  let pureXml = xmlContent;
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      const parsed = JSON.parse(trimmed);
      const xmlField =
        (parsed?.xmls?.[0] as string) ||
        (parsed?.xml as string) ||
        (parsed?.xmlNFe as string) ||
        (parsed?.[0]?.xml as string) ||
        (parsed?.[0]?.xmlNFe as string);
      if (xmlField && typeof xmlField === "string") {
        pureXml = xmlField;
      }
    } catch {
      // Not JSON, keep original
    }
  }

  // Validate it looks like XML
  if (!pureXml.trim().startsWith("<")) {
    return {
      success: false,
      error: `XML da NF-e em formato invalido. Inicio: "${pureXml.slice(0, 100)}"`,
    };
  }

  // 4. Upload XML to ML using /shipments/{id}/invoice_data endpoint (Brazil)
  // Reference: https://developers.mercadolivre.com.br/pt_br/anexar-nota-fiscal
  if (!order.ml_shipment_id) {
    return {
      success: false,
      error: "Pedido sem ml_shipment_id — necessario para envio da NF",
    };
  }

  try {
    await ml.postXml(
      `/shipments/${order.ml_shipment_id}/invoice_data/?siteId=MLB`,
      pureXml,
      workspaceId
    );
  } catch (err) {
    return {
      success: false,
      error: `Upload ML falhou: ${err instanceof Error ? err.message : "desconhecido"}`,
    };
  }

  // 5. Update hub_orders
  await supabase
    .from("hub_orders")
    .update({
      ecc_nfe_chave: chaveAcesso,
      ecc_data_faturamento: nfe.dataEmissao || null,
      nfe_xml_sent_at: new Date().toISOString(),
      sync_status: "nfe_sent" as const,
      error_msg: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", order.id);

  return { success: true, nfe_chave: chaveAcesso };
}
