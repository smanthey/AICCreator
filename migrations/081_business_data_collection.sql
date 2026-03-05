-- Migration 081: Business Data Collection System
-- Creates comprehensive schema for unified business intelligence system
-- This supports data aggregation from all business platforms (e-commerce, payments, shipping, analytics, social, email, SMS)

-- Integration registry: Track all connected platforms and their status
CREATE TABLE IF NOT EXISTS business_data_sources (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  platform TEXT NOT NULL UNIQUE, -- shopify, etsy, amazon, stripe, shippo, pirateship, ga4, google_ads, facebook_ads, instagram, tiktok, twitter, linkedin, youtube, email, sms
  platform_display_name TEXT NOT NULL,
  status TEXT DEFAULT 'disconnected' CHECK (status IN ('disconnected', 'connecting', 'connected', 'error', 'deprecated')),
  auth_type TEXT, -- oauth, api_key, webhook, etc.
  credentials_encrypted JSONB, -- Encrypted API credentials
  last_sync_at TIMESTAMPTZ,
  last_sync_status TEXT, -- success, error, partial
  last_sync_error TEXT,
  sync_frequency_minutes INTEGER DEFAULT 60,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_business_sources_status ON business_data_sources(status);
CREATE INDEX IF NOT EXISTS idx_business_sources_platform ON business_data_sources(platform);

-- Unified customers with cross-platform matching (created before revenue/orders that reference it)
CREATE TABLE IF NOT EXISTS business_customers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT,
  phone TEXT,
  first_name TEXT,
  last_name TEXT,
  company_name TEXT,
  customer_since TIMESTAMPTZ,
  lifetime_value_usd NUMERIC(10,2) DEFAULT 0,
  total_orders INTEGER DEFAULT 0,
  last_order_date TIMESTAMPTZ,
  platforms TEXT[], -- Array of platforms this customer has purchased from
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_business_customers_email ON business_customers(email) WHERE email IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_business_customers_phone ON business_customers(phone) WHERE phone IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_business_customers_platforms ON business_customers USING GIN(platforms);

-- Unified revenue tracking across all platforms
CREATE TABLE IF NOT EXISTS business_revenue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_platform TEXT NOT NULL REFERENCES business_data_sources(platform),
  order_id TEXT, -- Platform-specific order ID
  customer_id UUID REFERENCES business_customers(id),
  amount_usd NUMERIC(10,2) NOT NULL,
  currency TEXT DEFAULT 'USD',
  revenue_type TEXT DEFAULT 'sale' CHECK (revenue_type IN ('sale', 'subscription', 'refund', 'chargeback', 'fee')),
  transaction_date TIMESTAMPTZ NOT NULL,
  platform_metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(source_platform, order_id, transaction_date)
);

CREATE INDEX IF NOT EXISTS idx_business_revenue_platform ON business_revenue(source_platform);
CREATE INDEX IF NOT EXISTS idx_business_revenue_date ON business_revenue(transaction_date DESC);
CREATE INDEX IF NOT EXISTS idx_business_revenue_customer ON business_revenue(customer_id);
CREATE INDEX IF NOT EXISTS idx_business_revenue_type ON business_revenue(revenue_type);

-- Unified orders across all platforms
CREATE TABLE IF NOT EXISTS business_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_platform TEXT NOT NULL REFERENCES business_data_sources(platform),
  platform_order_id TEXT NOT NULL,
  customer_id UUID REFERENCES business_customers(id),
  order_status TEXT NOT NULL, -- pending, processing, shipped, delivered, cancelled, refunded
  total_amount_usd NUMERIC(10,2) NOT NULL,
  currency TEXT DEFAULT 'USD',
  order_date TIMESTAMPTZ NOT NULL,
  fulfillment_status TEXT, -- unfulfilled, partial, fulfilled
  shipping_cost_usd NUMERIC(10,2) DEFAULT 0,
  tax_amount_usd NUMERIC(10,2) DEFAULT 0,
  discount_amount_usd NUMERIC(10,2) DEFAULT 0,
  shipping_carrier TEXT,
  tracking_number TEXT,
  platform_metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(source_platform, platform_order_id)
);

CREATE INDEX IF NOT EXISTS idx_business_orders_platform ON business_orders(source_platform);
CREATE INDEX IF NOT EXISTS idx_business_orders_date ON business_orders(order_date DESC);
CREATE INDEX IF NOT EXISTS idx_business_orders_customer ON business_orders(customer_id);
CREATE INDEX IF NOT EXISTS idx_business_orders_status ON business_orders(order_status);


-- Unified products catalog
CREATE TABLE IF NOT EXISTS business_products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sku TEXT,
  product_name TEXT NOT NULL,
  description TEXT,
  category TEXT,
  brand TEXT,
  platforms TEXT[], -- Array of platforms this product is sold on
  total_sales_usd NUMERIC(10,2) DEFAULT 0,
  total_units_sold INTEGER DEFAULT 0,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_business_products_sku ON business_products(sku) WHERE sku IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_business_products_platforms ON business_products USING GIN(platforms);

-- Inventory tracking across platforms
CREATE TABLE IF NOT EXISTS business_inventory (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID REFERENCES business_products(id),
  platform TEXT NOT NULL REFERENCES business_data_sources(platform),
  platform_product_id TEXT, -- Platform-specific product ID
  sku TEXT,
  quantity_available INTEGER DEFAULT 0,
  quantity_reserved INTEGER DEFAULT 0,
  quantity_sold INTEGER DEFAULT 0,
  reorder_point INTEGER,
  location TEXT,
  last_updated_at TIMESTAMPTZ DEFAULT NOW(),
  metadata JSONB DEFAULT '{}'::jsonb,
  UNIQUE(platform, platform_product_id, sku)
);

CREATE INDEX IF NOT EXISTS idx_business_inventory_product ON business_inventory(product_id);
CREATE INDEX IF NOT EXISTS idx_business_inventory_platform ON business_inventory(platform);
CREATE INDEX IF NOT EXISTS idx_business_inventory_low_stock ON business_inventory(platform, quantity_available) WHERE quantity_available <= reorder_point;

-- Shipping data from Shippo, PirateShip, and platform APIs
CREATE TABLE IF NOT EXISTS business_shipments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID REFERENCES business_orders(id),
  shipping_provider TEXT NOT NULL, -- shippo, pirateship, or platform name
  tracking_number TEXT NOT NULL,
  carrier TEXT,
  service_level TEXT, -- ground, express, overnight, etc.
  cost_usd NUMERIC(10,2) NOT NULL,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'in_transit', 'delivered', 'exception', 'returned')),
  shipped_at TIMESTAMPTZ,
  delivered_at TIMESTAMPTZ,
  estimated_delivery_date DATE,
  tracking_url TEXT,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(shipping_provider, tracking_number)
);

CREATE INDEX IF NOT EXISTS idx_business_shipments_order ON business_shipments(order_id);
CREATE INDEX IF NOT EXISTS idx_business_shipments_provider ON business_shipments(shipping_provider);
CREATE INDEX IF NOT EXISTS idx_business_shipments_status ON business_shipments(status);
CREATE INDEX IF NOT EXISTS idx_business_shipments_tracking ON business_shipments(tracking_number);

-- Analytics data (GA4, social platforms)
CREATE TABLE IF NOT EXISTS business_analytics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_platform TEXT NOT NULL REFERENCES business_data_sources(platform),
  metric_date DATE NOT NULL,
  metric_type TEXT NOT NULL, -- sessions, pageviews, conversions, revenue, etc.
  metric_value NUMERIC(12,2) NOT NULL,
  dimension_1 TEXT, -- e.g., source, medium, campaign
  dimension_2 TEXT, -- e.g., device, country
  dimension_3 TEXT,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(source_platform, metric_date, metric_type, dimension_1, dimension_2, dimension_3)
);

CREATE INDEX IF NOT EXISTS idx_business_analytics_platform_date ON business_analytics(source_platform, metric_date DESC);
CREATE INDEX IF NOT EXISTS idx_business_analytics_type ON business_analytics(metric_type);

-- Social media data
CREATE TABLE IF NOT EXISTS business_social_media (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  platform TEXT NOT NULL REFERENCES business_data_sources(platform),
  post_id TEXT NOT NULL,
  post_type TEXT, -- post, story, reel, video, etc.
  content_text TEXT,
  posted_at TIMESTAMPTZ NOT NULL,
  likes_count INTEGER DEFAULT 0,
  comments_count INTEGER DEFAULT 0,
  shares_count INTEGER DEFAULT 0,
  views_count INTEGER DEFAULT 0,
  reach INTEGER DEFAULT 0,
  impressions INTEGER DEFAULT 0,
  engagement_rate NUMERIC(5,4),
  url TEXT,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(platform, post_id)
);

CREATE INDEX IF NOT EXISTS idx_business_social_platform ON business_social_media(platform);
CREATE INDEX IF NOT EXISTS idx_business_social_posted_at ON business_social_media(posted_at DESC);

-- Ad campaigns data
CREATE TABLE IF NOT EXISTS business_ad_campaigns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  platform TEXT NOT NULL REFERENCES business_data_sources(platform),
  campaign_id TEXT NOT NULL,
  campaign_name TEXT NOT NULL,
  status TEXT DEFAULT 'active' CHECK (status IN ('active', 'paused', 'archived', 'deleted')),
  start_date DATE,
  end_date DATE,
  spend_usd NUMERIC(10,2) DEFAULT 0,
  impressions INTEGER DEFAULT 0,
  clicks INTEGER DEFAULT 0,
  conversions INTEGER DEFAULT 0,
  revenue_usd NUMERIC(10,2) DEFAULT 0,
  roas NUMERIC(5,2), -- Return on ad spend
  ctr NUMERIC(5,4), -- Click-through rate
  cpc_usd NUMERIC(6,4), -- Cost per click
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(platform, campaign_id)
);

CREATE INDEX IF NOT EXISTS idx_business_ads_platform ON business_ad_campaigns(platform);
CREATE INDEX IF NOT EXISTS idx_business_ads_status ON business_ad_campaigns(status);
CREATE INDEX IF NOT EXISTS idx_business_ads_date ON business_ad_campaigns(start_date DESC);

-- Email campaigns (aggregated from existing email_sends)
CREATE TABLE IF NOT EXISTS business_email_campaigns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_name TEXT,
  brand_slug TEXT,
  sent_at TIMESTAMPTZ NOT NULL,
  sent_count INTEGER DEFAULT 0,
  delivered_count INTEGER DEFAULT 0,
  opened_count INTEGER DEFAULT 0,
  clicked_count INTEGER DEFAULT 0,
  bounced_count INTEGER DEFAULT 0,
  unsubscribed_count INTEGER DEFAULT 0,
  revenue_usd NUMERIC(10,2) DEFAULT 0,
  open_rate NUMERIC(5,4),
  click_rate NUMERIC(5,4),
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_business_email_sent_at ON business_email_campaigns(sent_at DESC);
CREATE INDEX IF NOT EXISTS idx_business_email_brand ON business_email_campaigns(brand_slug);

-- SMS campaigns
CREATE TABLE IF NOT EXISTS business_sms_campaigns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_name TEXT,
  brand_slug TEXT,
  sent_at TIMESTAMPTZ NOT NULL,
  sent_count INTEGER DEFAULT 0,
  delivered_count INTEGER DEFAULT 0,
  clicked_count INTEGER DEFAULT 0,
  revenue_usd NUMERIC(10,2) DEFAULT 0,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_business_sms_sent_at ON business_sms_campaigns(sent_at DESC);
CREATE INDEX IF NOT EXISTS idx_business_sms_brand ON business_sms_campaigns(brand_slug);

-- Research findings for new integrations
CREATE TABLE IF NOT EXISTS business_integration_research (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  platform TEXT NOT NULL,
  research_status TEXT DEFAULT 'pending' CHECK (research_status IN ('pending', 'in_progress', 'completed', 'blocked')),
  api_documentation_url TEXT,
  authentication_method TEXT,
  api_endpoints JSONB, -- Array of discovered endpoints
  rate_limits JSONB,
  data_available JSONB, -- What data can be collected
  integration_complexity TEXT, -- simple, moderate, complex
  estimated_build_time_hours INTEGER,
  research_notes TEXT,
  researcher_agent TEXT DEFAULT 'business-research-agent',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_business_research_platform ON business_integration_research(platform);
CREATE INDEX IF NOT EXISTS idx_business_research_status ON business_integration_research(research_status);

-- Build queue for Builder Agent
CREATE TABLE IF NOT EXISTS business_build_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  research_id UUID REFERENCES business_integration_research(id),
  platform TEXT NOT NULL,
  build_status TEXT DEFAULT 'queued' CHECK (build_status IN ('queued', 'building', 'testing', 'completed', 'failed')),
  build_priority INTEGER DEFAULT 5, -- 1-10, higher is more urgent
  sync_script_path TEXT,
  migration_path TEXT,
  build_notes TEXT,
  builder_agent TEXT DEFAULT 'business-builder-agent',
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_business_build_status ON business_build_queue(build_status, build_priority DESC);
CREATE INDEX IF NOT EXISTS idx_business_build_platform ON business_build_queue(platform);

-- Improvement logs
CREATE TABLE IF NOT EXISTS business_improvement_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  improvement_type TEXT NOT NULL, -- performance, feature, bug_fix, optimization
  target_component TEXT, -- sync_script, dashboard, api, database
  description TEXT NOT NULL,
  improvement_status TEXT DEFAULT 'proposed' CHECK (improvement_status IN ('proposed', 'implementing', 'testing', 'deployed', 'rejected')),
  impact_score INTEGER, -- 1-10
  effort_estimate_hours INTEGER,
  before_metrics JSONB,
  after_metrics JSONB,
  improver_agent TEXT DEFAULT 'business-improver-agent',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_business_improvements_status ON business_improvement_logs(improvement_status);
CREATE INDEX IF NOT EXISTS idx_business_improvements_type ON business_improvement_logs(improvement_type);

-- Sync status tracking
CREATE TABLE IF NOT EXISTS business_sync_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  platform TEXT NOT NULL REFERENCES business_data_sources(platform),
  sync_type TEXT NOT NULL, -- full, incremental, manual
  sync_status TEXT NOT NULL CHECK (sync_status IN ('started', 'in_progress', 'completed', 'failed', 'partial')),
  records_synced INTEGER DEFAULT 0,
  records_failed INTEGER DEFAULT 0,
  started_at TIMESTAMPTZ NOT NULL,
  completed_at TIMESTAMPTZ,
  duration_seconds INTEGER,
  error_message TEXT,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_business_sync_platform ON business_sync_logs(platform);
CREATE INDEX IF NOT EXISTS idx_business_sync_status ON business_sync_logs(sync_status);
CREATE INDEX IF NOT EXISTS idx_business_sync_started_at ON business_sync_logs(started_at DESC);

COMMENT ON TABLE business_data_sources IS 'Registry of all connected business platforms and their sync status';
COMMENT ON TABLE business_revenue IS 'Unified revenue tracking across all platforms';
COMMENT ON TABLE business_orders IS 'Unified order data from all e-commerce platforms';
COMMENT ON TABLE business_customers IS 'Unified customer data with cross-platform matching';
COMMENT ON TABLE business_products IS 'Unified product catalog across all platforms';
COMMENT ON TABLE business_inventory IS 'Inventory levels tracked across all platforms';
COMMENT ON TABLE business_shipments IS 'Shipping data from Shippo, PirateShip, and platform APIs';
COMMENT ON TABLE business_analytics IS 'Analytics data from GA4 and social platforms';
COMMENT ON TABLE business_social_media IS 'Social media posts and engagement metrics';
COMMENT ON TABLE business_ad_campaigns IS 'Ad campaign performance from Google Ads, Facebook Ads, etc.';
COMMENT ON TABLE business_email_campaigns IS 'Email campaign performance aggregated from email_sends';
COMMENT ON TABLE business_sms_campaigns IS 'SMS campaign performance';
COMMENT ON TABLE business_integration_research IS 'Research findings for new platform integrations';
COMMENT ON TABLE business_build_queue IS 'Queue of integrations waiting to be built by Builder Agent';
COMMENT ON TABLE business_improvement_logs IS 'Log of improvements proposed and implemented by Improver Agent';
COMMENT ON TABLE business_sync_logs IS 'Log of all sync operations for monitoring and debugging';
