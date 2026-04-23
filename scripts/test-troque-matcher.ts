import { isActiveExchangeStatus } from "../src/lib/cashback/troquecommerce";

const cases: Array<[string, boolean]> = [
  ["Em Trânsito", true],
  ["Em Transito", true],
  ["Finalizado", true],
  ["Finalizada", true],
  ["Reversa finalizada", true],
  ["Entregue", true],
  ["Entrega Realizada", true],
  ["Coletado", true],
  ["Produtos recebidos", true],
  ["Itens recebidos", true],
  ["Reversa Aprovada", true],
  ["Aprovada", true],
  ["Recusada", false],
  ["Cancelada", false],
  ["Cancelado", false],
  ["Aguardando Pagamento", false],
  ["Reversa criada", false],
  ["", false],
];

let fail = 0;
for (const [input, expected] of cases) {
  const got = isActiveExchangeStatus(input);
  const ok = got === expected;
  if (!ok) fail++;
  console.log(`${ok ? "✅" : "❌"}  "${input}" → ${got} (esperado ${expected})`);
}
console.log(`\n${cases.length - fail}/${cases.length} ok`);
process.exit(fail > 0 ? 1 : 0);
