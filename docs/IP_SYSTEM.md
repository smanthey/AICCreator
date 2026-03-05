# IP System (Local-First)

This subsystem builds a structured IP case engine from mixed Notes/Mail/files, then supports office-action parsing and USPTO refresh.

## Safety boundary

Use as internal drafting/checklist tooling. Final TEAS/TEASi filing and signatures remain manual.

## Schema

Migration: `035_ip_system_core.sql`

Primary tables:
- `ip_cases`
- `ip_documents`
- `ip_events`
- `ip_issues`
- `ip_deadlines`
- `ip_entities`
- `ip_document_entities`
- `ip_sync_runs`
- `ip_pipeline_state`
- `ip_rule_sets`
- `ip_rule_changes`
- `ip_case_outcomes`
- `ip_prefiling_assessments`
- `ip_examiner_profiles`
- `ip_class_profiles`
- `ip_category_profiles`
- `ip_borderline_matrix`

## Pipeline order

1. Ingest all sources
2. Parse office actions
3. Confirm tagging/categorization quality
4. Enable paralegal output

Paralegal output is hard-gated and blocked until these are marked complete.

## Commands

Run migration:

```bash
npm run migrate
```

Extract mailboxes to EML:

```bash
node scripts/ip-extract-mbox.js --input /path/to/mailbox.mbox --out /path/to/eml_dir
```

Ingest Notes/Mail/files:

```bash
node scripts/ip-ingest.js --source notes --machine M1 --root /path/to/notes_export --limit 20000
node scripts/ip-ingest.js --source notes --machine M3 --root /path/to/notes_export --limit 20000
node scripts/ip-ingest.js --source mail --machine M1 --root /path/to/eml_dir --limit 20000
node scripts/ip-ingest.js --source files --machine M1 --root /path/to/documents --limit 50000
node scripts/ip-ingest.js --source file_index --machine M1 --limit 5000
```

Parse office actions from ingested docs:

```bash
node scripts/ip-parse-office-action.js --limit 500
```

Log outcomes after each resolved matter (for rule tuning):

```bash
node scripts/ip-log-outcome.js --case-id <uuid> --issue-type specimen_refusal --strategy "substitute specimen + declaration" --examiner "J Smith" --result accepted --cycles 1 --days 42 --resolved-at 2026-03-15
```

Mark pipeline completion gates:

```bash
node scripts/ip-mark-stage.js --key ingestion_complete --value true
node scripts/ip-mark-stage.js --key parsing_complete --value true
node scripts/ip-mark-stage.js --key tagging_complete --value true
node scripts/ip-mark-stage.js --key categorization_complete --value true
node scripts/ip-mark-stage.js --key paralegal_enabled --value true
```

Generate next actions (blocked unless gates pass):

```bash
node scripts/ip-next-actions.js
```

USPTO sync (TSDR):

```bash
# optional env vars:
# USPTO_API_KEY=...
# USPTO_TSDR_CASE_URL_TEMPLATE=https://tsdrapi.uspto.gov/ts/cd/casestatus/sn{serial}/info.json

node scripts/ip-sync-uspto.js --limit 100

# optional daemon loop (default every 12h; set IP_SYNC_INTERVAL_MIN)
npm run ip:sync:loop
```

Generate rule-change proposals (suggestions only, never auto-applied):

```bash
npm run ip:rules:suggest
```

Refresh profile learning tables from outcomes:

```bash
npm run ip:patterns:refresh
```

Run pre-filing risk + strategy assessment:

```bash
npm run ip:prefiling:assess -- \
  --mark "SMAT" \
  --goods "Downloadable software for media workflow management" \
  --classes "9,42" \
  --category "software" \
  --basis 1b
```

## Local IP KB (TMEP/TBMP/ID Manual)

Initialize KB database:

```bash
npm run ip:kb:init
```

Install Python dependencies:

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r scripts/ip-kb-requirements.txt
```

Ingest TBMP (download PDF first):

```bash
npm run ip:kb:ingest:tbmp -- --pdf /absolute/path/tbmp-Master-June2025.pdf
```

Ingest TMEP HTML bundle (unzip locally first):

```bash
npm run ip:kb:ingest:tmep-html -- --root /absolute/path/tmep_html
```

Default tier model:
- `authoritative`: USPTO/TMEP/TBMP/IDM/statutes/rules (rules backbone)
- `interpretive`: commentary/casebooks/blogs (drafting aid only)

Ingest ID Manual:

```bash
npm run ip:kb:ingest:idm
```

Search the KB:

```bash
npm run ip:kb:search -- "section 2(d)"
npm run ip:kb:search -- "likelihood of confusion" --tier authoritative
```

Generate embeddings locally with Ollama (`mxbai-embed-large` default):

```bash
npm run ip:kb:embed -- --tier authoritative --limit 500
```

## Notes

- `ip-sync-uspto` URL is template-driven via `USPTO_TSDR_CASE_URL_TEMPLATE`.
- `ip-ingest` de-duplicates by SHA-256 and links documents to cases using serial/reg extraction and title heuristics.
- Office-action parser buckets common issue types and generates open deadlines.
- Deterministic rule set is JSON-driven at `config/ip-rules/ip-rules.v1.json`.
- Rule proposals are written to `scripts/ip-rules-proposals/` for manual review.

## Primary references used

- USPTO TSDR API and Open Data Portal docs
- USPTO TEAS/TEASi process pages and TMEP structure
- Apple Mail mailbox export workflow (`.mbox`)
- Open-source Apple Notes exporters (AppleScript/HTML and Markdown-capable variants)
