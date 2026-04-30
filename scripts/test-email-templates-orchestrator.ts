// scripts/test-email-templates-orchestrator.ts
/**
 * E2E dry-run for email-templates orchestrator on a real workspace.
 *
 * Pre-reqs:
 *   - Migration 066 applied (3 tables exist).
 *   - email_template_settings.enabled = true for the target workspace
 *     (set via dashboard UI → Configurações, or directly in DB).
 *   - VNDA + GA4 connected for the target workspace.
 *   - EMAIL_COUNTDOWN_SECRET set in env.
 *   - shelf_products synced (run shelf-catalog-sync cron at least once).
 *
 * Usage:
 *   WORKSPACE_ID=<uuid> npx tsx scripts/test-email-templates-orchestrator.ts
 *
 * Side effects:
 *   - Creates today's 3 suggestions (or upserts if already there — idempotent).
 *   - Creates a real VNDA coupon for slot 2 (slowmoving). This is intentional;
 *     the coupon is short-lived and product-scoped.
 *   - Writes audit events to email_template_audit.
 */
import "dotenv/config";
import { generateForWorkspace } from "../src/lib/email-templates/orchestrator";

const workspace_id = process.env.WORKSPACE_ID;
if (!workspace_id) {
  console.error("WORKSPACE_ID env var required");
  process.exit(1);
}

(async () => {
  console.log(`Generating for workspace ${workspace_id}...`);
  const out = await generateForWorkspace(workspace_id);
  console.log(JSON.stringify(out, null, 2));

  const okCount = out.results.filter((r) => r.ok).length;
  console.log(`\n${okCount}/3 slots filled.`);
  if (okCount === 0) {
    console.error("All slots failed. Check email_template_audit table for reasons.");
    process.exit(1);
  }
})().catch((err) => {
  console.error("Orchestrator threw:", err);
  process.exit(1);
});
