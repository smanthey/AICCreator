-- Remove "sell in 14 days or we take it back" and any "take it back" copy from experiment engine.
-- Wholesale is cash sale only — no consignment, no take-back, no money back.
UPDATE email_variants
SET content = 'High sell-through — stores reorder within 21 days'
WHERE id = 'subject_sellthru'
  AND content LIKE '%take it back%';

UPDATE email_variants
SET content = 'Independent stores that pass on topical wellness are watching that category go to Amazon. We help you capture that spend in-store.'
WHERE id = 'hook_loss'
  AND content LIKE '%take it back%';
