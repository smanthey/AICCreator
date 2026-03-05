-- 071_finance_automation_os.sql
-- Subscription audit + tax prep automation tables

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS finance_subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_key TEXT NOT NULL,
  display_name TEXT NOT NULL,
  amount_usd NUMERIC(12,2),
  billing_cycle TEXT,
  renewal_date DATE,
  last_charge_date DATE,
  monthly_cost_usd NUMERIC(12,2),
  source TEXT NOT NULL DEFAULT 'derived',
  duplicate_group TEXT,
  unused_30d BOOLEAN NOT NULL DEFAULT FALSE,
  price_increase_detected BOOLEAN NOT NULL DEFAULT FALSE,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  notes TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(provider_key, source)
);

CREATE TABLE IF NOT EXISTS finance_subscription_charges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_key TEXT NOT NULL,
  charge_date DATE NOT NULL,
  amount_usd NUMERIC(12,2) NOT NULL,
  currency TEXT,
  merchant_name TEXT,
  source TEXT NOT NULL,
  external_id TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(source, external_id)
);

CREATE TABLE IF NOT EXISTS finance_usage_signals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_key TEXT NOT NULL,
  signal_date TIMESTAMPTZ NOT NULL,
  signal_type TEXT NOT NULL,
  source TEXT NOT NULL,
  message_id TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(source, message_id)
);

CREATE TABLE IF NOT EXISTS finance_alerts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  alert_type TEXT NOT NULL,
  provider_key TEXT,
  due_date DATE,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'sent', 'dismissed')),
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS tax_expense_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tax_year INT NOT NULL,
  txn_date DATE,
  vendor TEXT,
  amount_usd NUMERIC(12,2),
  category TEXT NOT NULL,
  deductible BOOLEAN NOT NULL DEFAULT FALSE,
  source TEXT NOT NULL,
  external_id TEXT,
  receipt_path TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(source, external_id)
);

CREATE TABLE IF NOT EXISTS tax_income_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tax_year INT NOT NULL,
  doc_type TEXT NOT NULL,
  subject TEXT,
  doc_date DATE,
  source TEXT NOT NULL,
  external_id TEXT,
  storage_path TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(source, external_id)
);

CREATE INDEX IF NOT EXISTS idx_finance_subscriptions_provider ON finance_subscriptions(provider_key);
CREATE INDEX IF NOT EXISTS idx_finance_subscription_charges_provider_date ON finance_subscription_charges(provider_key, charge_date DESC);
CREATE INDEX IF NOT EXISTS idx_finance_usage_signals_provider_date ON finance_usage_signals(provider_key, signal_date DESC);
CREATE INDEX IF NOT EXISTS idx_finance_alerts_status_due ON finance_alerts(status, due_date);
CREATE INDEX IF NOT EXISTS idx_tax_expense_items_year_cat ON tax_expense_items(tax_year, category);
CREATE INDEX IF NOT EXISTS idx_tax_income_documents_year_type ON tax_income_documents(tax_year, doc_type);
