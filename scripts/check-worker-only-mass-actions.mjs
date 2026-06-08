#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const apiRoot = path.join(root, "src/app/api");

function walk(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...walk(full));
      continue;
    }
    if (entry.isFile() && /\.(ts|tsx)$/.test(entry.name)) {
      files.push(full);
    }
  }
  return files;
}

function rel(file) {
  return path.relative(root, file).split(path.sep).join("/");
}

function matchesAny(route, patterns) {
  return patterns.some((pattern) => pattern.test(route));
}

const batchCashbackRoutes = [
  /^src\/app\/api\/cashback\/reactivate-batch\/route\.ts$/,
  /^src\/app\/api\/cashback\/reactivation-reminder-batch\/route\.ts$/,
];

const rules = [
  {
    name: "W-API group send",
    pattern: /\b(sendText|sendImage|sendVideo|sendAudio|sendDocument)\s*\(/,
    allowed: [/^src\/app\/api\/cron\/wapi-group-sender\/route\.ts$/],
  },
  {
    name: "Locaweb marketing dispatch",
    pattern: /\bcreateMessage\s*\(/,
    allowed: [
      /^src\/app\/api\/crm\/email-templates\/\[id\]\/test-dispatch\/route\.ts$/,
      /^src\/app\/api\/crm\/email-templates\/drafts\/\[id\]\/test-dispatch\/route\.ts$/,
    ],
  },
  {
    name: "cashback reminder send",
    pattern: /\bsendReminderForStage\s*\(/,
    allowed: [
      /^src\/app\/api\/cron\/cashback-tick\/route\.ts$/,
      /^src\/app\/api\/cashback\/diagnostics\/send-test\/route\.ts$/,
      /^src\/app\/api\/cashback\/transactions\/\[id\]\/force-reminder\/route\.ts$/,
      /^src\/app\/api\/cashback\/transactions\/\[id\]\/reactivate\/route\.ts$/,
    ],
    allowedIfGuarded: batchCashbackRoutes,
  },
  {
    name: "cashback VNDA deposit",
    pattern: /\bdepositVndaCredit\s*\(/,
    allowed: [
      /^src\/app\/api\/cron\/cashback-tick\/route\.ts$/,
      /^src\/app\/api\/cashback\/transactions\/\[id\]\/reactivate\/route\.ts$/,
    ],
    allowedIfGuarded: batchCashbackRoutes,
  },
  {
    name: "Meta WhatsApp template send",
    pattern: /\bsendTemplateMessage\s*\(/,
    allowed: [],
  },
];

const violations = [];
for (const file of walk(apiRoot)) {
  const route = rel(file);
  const source = fs.readFileSync(file, "utf8");
  for (const rule of rules) {
    if (!rule.pattern.test(source)) continue;
    if (matchesAny(route, rule.allowed)) continue;
    if (
      rule.allowedIfGuarded &&
      matchesAny(route, rule.allowedIfGuarded) &&
      source.includes("massActionWorkerOnlyPayload")
    ) {
      continue;
    }
    violations.push(`${route}: ${rule.name}`);
  }
}

if (violations.length > 0) {
  console.error("Mass actions must be queued for the Droplet worker.");
  console.error("Direct send/deposit calls are blocked in API routes unless explicitly allowlisted.");
  for (const violation of violations) {
    console.error(`- ${violation}`);
  }
  process.exit(1);
}

console.log("Worker-only mass action guard passed.");
