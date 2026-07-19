import assert from "node:assert/strict";
import test from "node:test";
import {
  buildMetaBalanceTemplateVariables,
  classifyMetaBalance,
  formatRunway,
  parseMetaBalanceThresholds,
  suggestMetaTopup,
} from "../src/lib/meta-balance-alert.ts";
import {
  type AdAccountFunding,
  parseMetaAvailableBrl,
} from "../src/lib/meta-api.ts";

test("parses the localized prepaid balance returned by Meta", () => {
  assert.equal(
    parseMetaAvailableBrl("Saldo disponível (R$1.629,63\u00a0BRL)"),
    1629.63,
  );
  assert.equal(parseMetaAvailableBrl("Saldo disponível (R$ 312,18 BRL)"), 312.18);
  assert.equal(parseMetaAvailableBrl("Visa final 1234"), null);
});

test("validates and applies alert thresholds", () => {
  const thresholds = parseMetaBalanceThresholds("2.5", "1");
  assert.equal(classifyMetaBalance(Number.POSITIVE_INFINITY, thresholds), "ok");
  assert.equal(classifyMetaBalance(2.51, thresholds), "ok");
  assert.equal(classifyMetaBalance(2.5, thresholds), "warn");
  assert.equal(classifyMetaBalance(1, thresholds), "critical");
  assert.throws(() => parseMetaBalanceThresholds("1", "2"));
});

test("formats runway and limits the suggested top-up", () => {
  assert.equal(formatRunway(0.5), "30 minutos");
  assert.equal(formatRunway(4.125), "4h 8min");
  assert.equal(suggestMetaTopup(1800), 1000);
  assert.equal(suggestMetaTopup(600), 500);
});

test("builds variables in the approved template order without duplicating per-day text", () => {
  const funding: AdAccountFunding = {
    accountId: "act_1",
    name: "Conta",
    currency: "BRL",
    accountStatus: 1,
    disableReason: 0,
    availableBrl: 312.18,
    dailyBurnBrl: 1841,
    runwayHours: 4.07,
  };

  const variables = buildMetaBalanceTemplateVariables("B7984", funding);
  assert.deepEqual(Object.keys(variables), ["1", "2", "3", "4", "5"]);
  assert.equal(variables["1"], "B7984");
  assert.match(variables["2"], /^R\$\s*312$/);
  assert.equal(variables["3"], "4h 4min");
  assert.match(variables["4"], /^R\$\s*1\.841$/);
  assert.doesNotMatch(variables["4"], /dia/i);
  assert.match(variables["5"], /^R\$\s*1\.000$/);
});
