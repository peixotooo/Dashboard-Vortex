/**
 * Maps collection item data to Eccosys API product body.
 * Merges template defaults + AI-generated fields + user edits.
 * Field names match the Eccosys CSV export format.
 */

import type { CollectionItem, TemplateData } from "./types";

interface EccosysProductBody {
  nome: string;
  codigo: string;
  unidade: string;
  cf: string;
  preco: string;
  precoCusto: string;
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
  codigoNoFabricante: string;
  tipoProducao: string;
  gtin: string;
  gtinEmbalagem: string;
  descricaoComplementar: string;
  descricaoEcommerce: string;
  descricaoDetalhada: string;
  opcEcommerce: string;
  opcOpcional: string;
  idProdutoPai: string;
  largura: string;
  altura: string;
  comprimento: string;
  // SEO & e-commerce fields
  tituloPagina: string;
  keywords: string;
  metatagDescription: string;
  url: string;
  // Additional fields from CSV
  situacaoVenda: string;
  situacaoCompra: string;
  classeEnquadIpi: string;
  tempoProducao: string;
  tipoVariacao: string;
  [key: string]: string | number; // Allow dynamic fields (idProdutoMaster, codigoPai, etc.)
}

// Fixed values from real CSV data
const FABRICANTE = "BULKING INDUSTRIA E COMERCIO DE ROUPAS LTDA.";

export function mapItemToEccosys(
  item: CollectionItem,
  template: TemplateData | null
): EccosysProductBody {
  const peso = String(item.peso || template?.peso || "0.220");

  return {
    nome: item.nome || "",
    codigo: "",  // Eccosys auto-generates the SKU
    unidade: item.unidade || template?.unidade || "Un",
    cf: item.ncm || template?.cf || "",
    preco: String(item.preco || "0.00"),
    precoCusto: String(item.preco_custo || "0.00"),
    origem: item.origem || template?.origem || "0",
    situacao: "A",
    tipo: "P",
    tipoFrete: "0",
    calcAutomEstoque: "N",
    estoqueMinimo: "10.00",
    estoqueMaximo: "0.00",
    peso,
    pesoLiq: peso,
    pesoBruto: peso,
    idFornecedor: item.id_fornecedor || template?.idFornecedor || "0",
    codigoNoFabricante: "0",
    tipoProducao: "T",
    gtin: item.gtin || "",
    gtinEmbalagem: "",
    descricaoComplementar: item.descricao_complementar || "",
    descricaoEcommerce: item.descricao_ecommerce || "",
    descricaoDetalhada: item.descricao_detalhada || item.descricao_ecommerce || "",
    opcEcommerce: "S",
    opcOpcional: "N",
    idProdutoPai: "0",
    largura: String(item.largura || template?.largura || "25.00"),
    altura: String(item.altura || template?.altura || "3.00"),
    comprimento: String(item.comprimento || template?.comprimento || "30.00"),
    // SEO fields
    tituloPagina: item.titulo_pagina || item.nome || "",
    keywords: item.keywords || "",
    metatagDescription: item.metatag_description || "",
    url: item.url_slug || item.codigo || "",
    // Fixed fields from CSV patterns
    situacaoVenda: "Ativo",
    situacaoCompra: "Ativo",
    classeEnquadIpi: "999",
    tempoProducao: "30",
    tipoVariacao: "Tamanho Tray",
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
