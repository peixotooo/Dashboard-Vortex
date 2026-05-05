// scripts/test-locaweb-dispatch.ts
//
// One-shot smoke test for the Locaweb integration. Discovers domains +
// senders, creates a transient test list with a single recipient,
// dispatches a sample campaign, and prints the resulting message_id.
//
// USAGE:
//   LOCAWEB_EM_TOKEN=xxx LOCAWEB_EM_ACCOUNT_ID=202654 \
//     LOCAWEB_TEST_RECIPIENT=guilherme@bulking.com.br \
//     LOCAWEB_TEST_SENDER=contato@bulking.com.br \
//     npx tsx scripts/test-locaweb-dispatch.ts
//
// The script never reads from your Supabase or production env — only the
// vars passed inline. Token stays on your machine. The test list is named
// `_dashvortex_test_<timestamp>` so you can spot/delete it in the panel.

import {
  ping,
  listDomains,
  listSenders,
  listLists,
  createList,
  addContactsToList,
  createMessage,
  getMessage,
  type LocawebCreds,
} from "../src/lib/locaweb/email-marketing";

const TOKEN = process.env.LOCAWEB_EM_TOKEN;
const ACCT = process.env.LOCAWEB_EM_ACCOUNT_ID;
const RECIPIENT = process.env.LOCAWEB_TEST_RECIPIENT ?? "guilherme@bulking.com.br";
const SENDER = process.env.LOCAWEB_TEST_SENDER ?? "contato@bulking.com.br";
const SENDER_NAME = process.env.LOCAWEB_TEST_SENDER_NAME ?? "BULKING";
const BASE_URL =
  process.env.LOCAWEB_EM_BASE_URL ?? "https://emailmarketing.locaweb.com.br/api/v1";

if (!TOKEN || !ACCT) {
  console.error(
    "❌ LOCAWEB_EM_TOKEN e LOCAWEB_EM_ACCOUNT_ID são obrigatórios.\n" +
      "Exemplo:\n" +
      "  LOCAWEB_EM_TOKEN=xxx LOCAWEB_EM_ACCOUNT_ID=202654 npx tsx scripts/test-locaweb-dispatch.ts"
  );
  process.exit(1);
}

const creds: LocawebCreds = { base_url: BASE_URL, account_id: ACCT, token: TOKEN };

const SAMPLE_HTML = `<!DOCTYPE html>
<html lang="pt-BR">
<head><meta charset="utf-8"><title>Teste Bulking · Vortex</title></head>
<body style="margin:0;padding:0;background:#f7f7f7;font-family:Inter,Arial,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f7f7f7;">
    <tr><td align="center">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="background:#fff;max-width:600px;">
        <tr><td align="center" style="padding:48px 32px 24px;border-bottom:1px solid #e6e6e6;">
          <span style="font-family:'Kanit',Arial,sans-serif;font-weight:500;font-size:18px;letter-spacing:0.32em;color:#000;">BULKING</span>
        </td></tr>
        <tr><td align="center" style="padding:40px 32px 12px;">
          <span style="font-family:Inter,Arial,sans-serif;font-weight:500;font-size:11px;letter-spacing:0.32em;color:#6E6E6E;text-transform:uppercase;">TESTE · DASHBOARD VORTEX</span>
        </td></tr>
        <tr><td align="center" style="padding:0 40px 24px;">
          <h1 style="margin:0;font-family:'Kanit',Arial,sans-serif;font-weight:500;font-size:36px;line-height:1.1;color:#000;">Integração Locaweb funcionando.</h1>
        </td></tr>
        <tr><td align="center" style="padding:0 40px 32px;">
          <p style="margin:0;font-family:Inter,Arial,sans-serif;font-weight:400;font-size:15px;line-height:1.7;color:#3A3A3A;max-width:480px;">
            Esse email foi disparado pelo Dashboard Vortex via API da Locaweb pra validar o pipeline ponta-a-ponta. Se você está lendo isso, o ciclo render → criar campanha → dispatch funcionou.
          </p>
        </td></tr>
        <tr><td align="center" style="padding:0 40px 56px;">
          <a href="https://www.bulking.com.br" target="_blank" style="display:inline-block;background:#000;color:#fff;font-family:'Kanit',Arial,sans-serif;font-weight:600;font-size:13px;letter-spacing:0.28em;text-transform:uppercase;text-decoration:none;padding:18px 40px;">Ver loja</a>
        </td></tr>
        <tr><td align="center" style="padding:32px 40px 40px;border-top:1px solid #e6e6e6;">
          <span style="font-family:'Kanit',Arial,sans-serif;font-weight:500;font-size:12px;letter-spacing:0.32em;color:#000;text-transform:uppercase;">Respect the Hustle.</span>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

async function main() {
  console.log(`\n🔬 Locaweb smoke-test`);
  console.log(`   account_id: ${ACCT}`);
  console.log(`   recipient:  ${RECIPIENT}`);
  console.log(`   sender:     ${SENDER}\n`);

  console.log("[1/6] ping ...");
  const probe = await ping(creds);
  console.log(`      ✓ conectou · ${probe.lists} lista(s) na conta\n`);

  console.log("[2/6] listando domínios ...");
  const domains = await listDomains(creds);
  if (domains.length === 0) {
    console.error(
      "      ✗ Nenhum domínio retornado. Verifica no painel se o domínio foi" +
        " adicionado E ativado (DNS propagado)."
    );
    process.exit(2);
  }
  for (const d of domains) {
    console.log(`      • ${d.name ?? "(sem nome)"} · id=${d.id} · status=${d.status ?? "?"}`);
  }
  // Prefer an active domain matching the sender's host. Fall back to first.
  const senderDomain = SENDER.split("@")[1]?.toLowerCase();
  const matchedDomain =
    domains.find(
      (d) =>
        (d.name ?? "").toLowerCase() === senderDomain &&
        (!d.status || /(active|verified|ativ)/i.test(d.status))
    ) ?? domains[0];
  console.log(`      → usando domain_id=${matchedDomain.id} (${matchedDomain.name})\n`);

  console.log("[3/6] listando senders ...");
  const senders = await listSenders(creds);
  for (const s of senders) {
    console.log(`      • ${s.email} · status=${s.status ?? "?"}`);
  }
  const senderOk = senders.some((s) => s.email?.toLowerCase() === SENDER.toLowerCase());
  if (!senderOk) {
    console.warn(
      `      ⚠ sender ${SENDER} não está na lista de senders ativos. Pode falhar.`
    );
  }
  console.log("");

  console.log("[4/6] criando lista de teste ...");
  const listName = `_dashvortex_test_${Date.now()}`;
  const list = await createList(creds, listName);
  console.log(`      ✓ lista criada: ${list.name} · id=${list.id}\n`);

  console.log("[5/6] adicionando ${RECIPIENT} à lista ...");
  await addContactsToList(creds, list.id, [
    { email: RECIPIENT, name: "Test Recipient" },
  ]);
  console.log(`      ✓ contato adicionado\n`);

  console.log("[6/6] disparando campanha ...");
  const message = await createMessage(creds, {
    name: `Teste Vortex ${new Date().toISOString().slice(0, 19)}`,
    subject: "Teste · integração Vortex × Locaweb",
    sender: SENDER,
    sender_name: SENDER_NAME,
    domain_id: matchedDomain.id,
    html_body: SAMPLE_HTML,
    list_ids: [list.id],
  });
  const messageId =
    message.id ??
    (typeof message._location === "string"
      ? message._location.split("/").filter(Boolean).pop()
      : null);
  console.log(`      ✓ message criado · id=${messageId ?? "(sem id no body)"}\n`);

  if (messageId) {
    console.log("[7/7] checando status atual ...");
    try {
      const status = await getMessage(creds, messageId);
      console.log(`      status=${status.status ?? "?"}`);
    } catch (err) {
      console.log(`      (status check falhou: ${(err as Error).message})`);
    }
  }

  console.log(`\n✅ tudo certo. checa a inbox de ${RECIPIENT}.`);
  console.log(
    `   (Spam/promoções pode pegar; em ~1-3min normalmente chega. Lista de teste:` +
      ` ${listName} — pode apagar no painel depois.)\n`
  );
}

main().catch((err) => {
  console.error(`\n❌ falhou:`, err.message ?? err);
  if (err.body) console.error("   body:", JSON.stringify(err.body, null, 2).slice(0, 1000));
  if (err.status) console.error("   status:", err.status);
  process.exit(1);
});
