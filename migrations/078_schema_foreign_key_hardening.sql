-- Migration 078: Schema Foreign Key Hardening
-- Adds missing foreign key constraints for brand_slug, plan_id, and task_id columns
-- Addresses schema integrity gaps identified in status review

-- ── Foreign Keys for brand_slug columns ────────────────────────────────────────

-- content_items.brand_slug → brands.slug
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'content_items')
     AND EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'brands')
     AND EXISTS (SELECT 1 FROM information_schema.columns 
                 WHERE table_name = 'content_items' AND column_name = 'brand_slug') THEN
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.table_constraints 
      WHERE constraint_name = 'fk_content_items_brand_slug'
        AND table_name = 'content_items'
    ) THEN
      -- Only add FK if all brand_slug values in content_items exist in brands
      IF NOT EXISTS (
        SELECT 1 FROM content_items ci
        WHERE ci.brand_slug IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM brands b WHERE b.slug = ci.brand_slug)
      ) THEN
        ALTER TABLE content_items
          ADD CONSTRAINT fk_content_items_brand_slug
          FOREIGN KEY (brand_slug) REFERENCES brands(slug) ON DELETE SET NULL;
      END IF;
    END IF;
  END IF;
END $$;

-- content_briefs.brand_slug → brands.slug
-- Note: Migration 065 adds FK to brand_id, but brand_slug FK is still needed for legacy data
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'content_briefs')
     AND EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'brands')
     AND EXISTS (SELECT 1 FROM information_schema.columns 
                 WHERE table_name = 'content_briefs' AND column_name = 'brand_slug') THEN
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.table_constraints 
      WHERE constraint_name = 'fk_content_briefs_brand_slug'
        AND table_name = 'content_briefs'
    ) THEN
      IF NOT EXISTS (
        SELECT 1 FROM content_briefs cb
        WHERE cb.brand_slug IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM brands b WHERE b.slug = cb.brand_slug)
      ) THEN
        ALTER TABLE content_briefs
          ADD CONSTRAINT fk_content_briefs_brand_slug
          FOREIGN KEY (brand_slug) REFERENCES brands(slug) ON DELETE RESTRICT;
      END IF;
    END IF;
  END IF;
END $$;

-- leads.brand_slug → brands.slug
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'leads')
     AND EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'brands')
     AND EXISTS (SELECT 1 FROM information_schema.columns 
                 WHERE table_name = 'leads' AND column_name = 'brand_slug') THEN
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.table_constraints 
      WHERE constraint_name = 'fk_leads_brand_slug'
        AND table_name = 'leads'
    ) THEN
      IF NOT EXISTS (
        SELECT 1 FROM leads l
        WHERE l.brand_slug IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM brands b WHERE b.slug = l.brand_slug)
      ) THEN
        ALTER TABLE leads
          ADD CONSTRAINT fk_leads_brand_slug
          FOREIGN KEY (brand_slug) REFERENCES brands(slug) ON DELETE RESTRICT;
      END IF;
    END IF;
  END IF;
END $$;

-- email_sends.brand_slug → brands.slug
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'email_sends')
     AND EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'brands')
     AND EXISTS (SELECT 1 FROM information_schema.columns 
                 WHERE table_name = 'email_sends' AND column_name = 'brand_slug') THEN
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.table_constraints 
      WHERE constraint_name = 'fk_email_sends_brand_slug'
        AND table_name = 'email_sends'
    ) THEN
      IF NOT EXISTS (
        SELECT 1 FROM email_sends es
        WHERE es.brand_slug IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM brands b WHERE b.slug = es.brand_slug)
      ) THEN
        ALTER TABLE email_sends
          ADD CONSTRAINT fk_email_sends_brand_slug
          FOREIGN KEY (brand_slug) REFERENCES brands(slug) ON DELETE SET NULL;
      END IF;
    END IF;
  END IF;
END $$;

-- ── Foreign Keys for plan_id columns (if plans table exists) ────────────────────

-- content_items.plan_id → plans.id (if plans table exists)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'plans')
     AND EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'content_items')
     AND EXISTS (SELECT 1 FROM information_schema.columns 
                 WHERE table_name = 'content_items' AND column_name = 'plan_id') THEN
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.table_constraints 
      WHERE constraint_name = 'fk_content_items_plan_id'
        AND table_name = 'content_items'
    ) THEN
      -- Only add if no orphaned plan_ids exist
      IF NOT EXISTS (
        SELECT 1 FROM content_items ci
        WHERE ci.plan_id IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM plans p WHERE p.id = ci.plan_id)
      ) THEN
        ALTER TABLE content_items
          ADD CONSTRAINT fk_content_items_plan_id
          FOREIGN KEY (plan_id) REFERENCES plans(id) ON DELETE SET NULL;
      END IF;
    END IF;
  END IF;
END $$;

-- content_briefs.plan_id → plans.id
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'plans')
     AND EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'content_briefs')
     AND EXISTS (SELECT 1 FROM information_schema.columns 
                 WHERE table_name = 'content_briefs' AND column_name = 'plan_id') THEN
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.table_constraints 
      WHERE constraint_name = 'fk_content_briefs_plan_id'
        AND table_name = 'content_briefs'
    ) THEN
      IF NOT EXISTS (
        SELECT 1 FROM content_briefs cb
        WHERE cb.plan_id IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM plans p WHERE p.id = cb.plan_id)
      ) THEN
        ALTER TABLE content_briefs
          ADD CONSTRAINT fk_content_briefs_plan_id
          FOREIGN KEY (plan_id) REFERENCES plans(id) ON DELETE SET NULL;
      END IF;
    END IF;
  END IF;
END $$;

-- leads.plan_id → plans.id
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'plans')
     AND EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'leads')
     AND EXISTS (SELECT 1 FROM information_schema.columns 
                 WHERE table_name = 'leads' AND column_name = 'plan_id') THEN
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.table_constraints 
      WHERE constraint_name = 'fk_leads_plan_id'
        AND table_name = 'leads'
    ) THEN
      IF NOT EXISTS (
        SELECT 1 FROM leads l
        WHERE l.plan_id IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM plans p WHERE p.id = l.plan_id)
      ) THEN
        ALTER TABLE leads
          ADD CONSTRAINT fk_leads_plan_id
          FOREIGN KEY (plan_id) REFERENCES plans(id) ON DELETE SET NULL;
      END IF;
    END IF;
  END IF;
END $$;

-- email_sends.plan_id → plans.id
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'plans')
     AND EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'email_sends')
     AND EXISTS (SELECT 1 FROM information_schema.columns 
                 WHERE table_name = 'email_sends' AND column_name = 'plan_id') THEN
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.table_constraints 
      WHERE constraint_name = 'fk_email_sends_plan_id'
        AND table_name = 'email_sends'
    ) THEN
      IF NOT EXISTS (
        SELECT 1 FROM email_sends es
        WHERE es.plan_id IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM plans p WHERE p.id = es.plan_id)
      ) THEN
        ALTER TABLE email_sends
          ADD CONSTRAINT fk_email_sends_plan_id
          FOREIGN KEY (plan_id) REFERENCES plans(id) ON DELETE SET NULL;
      END IF;
    END IF;
  END IF;
END $$;

-- ── Foreign Keys for task_id columns → tasks.id ───────────────────────────────

-- content_items.task_id → tasks.id
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'tasks')
     AND EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'content_items')
     AND EXISTS (SELECT 1 FROM information_schema.columns 
                 WHERE table_name = 'content_items' AND column_name = 'task_id') THEN
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.table_constraints 
      WHERE constraint_name = 'fk_content_items_task_id'
        AND table_name = 'content_items'
    ) THEN
      IF NOT EXISTS (
        SELECT 1 FROM content_items ci
        WHERE ci.task_id IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM tasks t WHERE t.id = ci.task_id)
      ) THEN
        ALTER TABLE content_items
          ADD CONSTRAINT fk_content_items_task_id
          FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE SET NULL;
      END IF;
    END IF;
  END IF;
END $$;

-- content_briefs.task_id → tasks.id
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'tasks')
     AND EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'content_briefs')
     AND EXISTS (SELECT 1 FROM information_schema.columns 
                 WHERE table_name = 'content_briefs' AND column_name = 'task_id') THEN
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.table_constraints 
      WHERE constraint_name = 'fk_content_briefs_task_id'
        AND table_name = 'content_briefs'
    ) THEN
      IF NOT EXISTS (
        SELECT 1 FROM content_briefs cb
        WHERE cb.task_id IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM tasks t WHERE t.id = cb.task_id)
      ) THEN
        ALTER TABLE content_briefs
          ADD CONSTRAINT fk_content_briefs_task_id
          FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE SET NULL;
      END IF;
    END IF;
  END IF;
END $$;

-- leads.task_id → tasks.id
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'tasks')
     AND EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'leads')
     AND EXISTS (SELECT 1 FROM information_schema.columns 
                 WHERE table_name = 'leads' AND column_name = 'task_id') THEN
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.table_constraints 
      WHERE constraint_name = 'fk_leads_task_id'
        AND table_name = 'leads'
    ) THEN
      IF NOT EXISTS (
        SELECT 1 FROM leads l
        WHERE l.task_id IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM tasks t WHERE t.id = l.task_id)
      ) THEN
        ALTER TABLE leads
          ADD CONSTRAINT fk_leads_task_id
          FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE SET NULL;
      END IF;
    END IF;
  END IF;
END $$;

-- email_sends.task_id → tasks.id
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'tasks')
     AND EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'email_sends')
     AND EXISTS (SELECT 1 FROM information_schema.columns 
                 WHERE table_name = 'email_sends' AND column_name = 'task_id') THEN
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.table_constraints 
      WHERE constraint_name = 'fk_email_sends_task_id'
        AND table_name = 'email_sends'
    ) THEN
      IF NOT EXISTS (
        SELECT 1 FROM email_sends es
        WHERE es.task_id IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM tasks t WHERE t.id = es.task_id)
      ) THEN
        ALTER TABLE email_sends
          ADD CONSTRAINT fk_email_sends_task_id
          FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE SET NULL;
      END IF;
    END IF;
  END IF;
END $$;

-- ── Indexes for better FK lookup performance ──────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_content_items_brand_slug 
  ON content_items(brand_slug) WHERE brand_slug IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_content_briefs_brand_slug 
  ON content_briefs(brand_slug) WHERE brand_slug IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_leads_brand_slug 
  ON leads(brand_slug) WHERE brand_slug IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_email_sends_brand_slug 
  ON email_sends(brand_slug) WHERE brand_slug IS NOT NULL;

COMMENT ON TABLE content_items IS 'Foreign keys added: brand_slug→brands, plan_id→plans (if exists), task_id→tasks';
COMMENT ON TABLE content_briefs IS 'Foreign keys added: brand_slug→brands, plan_id→plans (if exists), task_id→tasks';
COMMENT ON TABLE leads IS 'Foreign keys added: brand_slug→brands, plan_id→plans (if exists), task_id→tasks';
COMMENT ON TABLE email_sends IS 'Foreign keys added: brand_slug→brands, plan_id→plans (if exists), task_id→tasks';
