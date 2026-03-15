-- Campaign attribution: conversion tracking + ROI
ALTER TABLE wa_campaigns
  ADD COLUMN IF NOT EXISTS attribution_window_days INT DEFAULT 3,
  ADD COLUMN IF NOT EXISTS message_cost_usd NUMERIC(10,6) DEFAULT 0.0625,
  ADD COLUMN IF NOT EXISTS exchange_rate NUMERIC(10,4) DEFAULT 5.50;
