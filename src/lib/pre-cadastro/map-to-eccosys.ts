/**
 * Maps collection item data to Eccosys API product body.
 * Merges template defaults + AI-generated fields + user edits.
 */

import type { CollectionItem, TemplateData } from "./types";

interface EccosysProductBody {
  nome: string;
  codigo: string;
  unidade: string;
  cf: string;
  preco: string;
  origem: string;
  situacao: string;
  tipo: string;
  tipoFrete: string;
  calcAutomEstoque: string;
  estoqueMinimo: string;
  estoqueMaximo: string;
  peso: string;
  pesoLiq: string;
  pesoBruto: string;
  idFornecedor: string;
  tipoProducao: string;
  precoCusto: string;
  gtin: string;
  gtinEmbalagem: string;
  descricaoComplementar: string;
  descricaoEcommerce: string;
  opcEcommerce: string;
  opcOpcional: string;
  idProdutoPai: string;
  largura: string;
  altura: string;
  comprimento: string;
}

export function mapItemToEccosys(
  item: CollectionItem,
  template: TemplateData | null
): EccosysProductBody {
  const peso = String(item.peso || template?.peso || "0.00");

  return {
    nome: item.nome || "",
    codigo: item.codigo || "",
    unidade: item.unidade || template?.unidade || "un",
    cf: item.ncm || template?.cf || "",
    preco: String(item.preco || "0.00"),
    origem: item.origem || template?.origem || "0",
    situacao: template?.situacao || "A",
    tipo: template?.tipo || "P",
    tipoFrete: "0",
    calcAutomEstoque: template?.calcAutomEstoque || "S",
    estoqueMinimo: template?.estoqueMinimo || "0.00",
    estoqueMaximo: template?.estoqueMaximo || "0.00",
    peso,
    pesoLiq: peso,
    pesoBruto: peso,
    idFornecedor: item.id_fornecedor || template?.idFornecedor || "0",
    tipoProducao: template?.tipoProducao || "T",
    precoCusto: "0.00",
    gtin: item.gtin || "",
    gtinEmbalagem: "",
    descricaoComplementar: item.descricao_complementar || "",
    descricaoEcommerce: item.descricao_ecommerce || "",
    opcEcommerce: "S",
    opcOpcional: "N",
    idProdutoPai: "0",
    largura: String(item.largura || template?.largura || "0.00"),
    altura: String(item.altura || template?.altura || "0.00"),
    comprimento: String(item.comprimento || template?.comprimento || "0.00"),
  };
}

export function buildCategorizationBody(item: CollectionItem): unknown[] | null {
  if (!item.departamento_id) return null;

  const dept: { id: number | string; categorias?: unknown[] } = {
    id: Number(item.departamento_id) || item.departamento_id,
  };

  if (item.categoria_id) {
    const cat: { id: number | string; subcategorias?: unknown[] } = {
      id: Number(item.categoria_id) || item.categoria_id,
    };
    if (item.subcategoria_id) {
      cat.subcategorias = [{ id: Number(item.subcategoria_id) || item.subcategoria_id }];
    }
    dept.categorias = [cat];
  }

  return [dept];
}
