-- supabase/migration-073-drop-default-margin-pct.sql
--
-- Cleanup: remove email_template_settings.default_margin_pct.
--
-- A versão inicial de migration-072 adicionava essa coluna como
-- fallback de custo quando product_costs não tinha o SKU. Decidimos
-- depois usar workspace_financial_settings.product_cost_pct (mesma
-- fonte do commercial-simulator) pra que ABC e simulador concordem
-- sobre o que é "lucro". A coluna não é mais lida nem escrita pelo
-- código.
--
-- Idempotente — rode mesmo se a coluna nunca tiver sido criada.
alter table if exists email_template_settings
  drop column if exists default_margin_pct;
