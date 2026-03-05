# CLAW System State
Date: February 26, 2026
Status: Operational with active control-plane transition

## 1) Infrastructure Overview

### Machines
- **M1 Desktop**
  - Legacy claw system origin
  - Full indexing executed
  - Stable, no longer being modified
- **M3 Max**
  - `claw-architect` development node
  - Ran Ollama-based classification batches
  - Intended LLM worker/control role
- **M4 (36GB RAM)**
  - Intended primary control-plane host
  - Not fully centralized yet
- **i7 infra node**
  - Redis/Postgres infrastructure support
- **NAS (Synology)**
  - Primary Postgres data spine
  - File storage + index data source
  - Not used for LLM serving

## 2) Codebases

### A) `~/claw` (Legacy, complete, frozen)
- Completed cross-device indexing
- Writes to NAS Postgres
- First-pass classification works
- Stable and should not be modified

**Role now:** data collection/ingestion only

### B) `~/claw-architect` (Active, future control plane)
- Planner, dispatcher, orchestrator, task system
- Agent framework (dedupe, triage, QA, patch, classify, etc.)
- Model router + registry
- Active development target

## 3) Data & Database State

### Source of truth
- **Single Postgres instance on NAS** used by both projects

### Current data condition
- Indexing complete
- SHA-256 computed
- Source machine tracked
- Basic category labels populated
- First-pass classification present
- NAS state healthy

### Explicitly not required now
- No full re-index
- No full first-pass reclassification
- No NAS filesystem mutation

## 4) LLM / Model State

### Previous
- Ollama on M3 Max handled classification workflows

### Current transition
- Moving to OpenAI Codex (`gpt-5.1` and mini tiers as needed)
- `OPENAI_API_KEY` available in legacy environment
- `claw-architect` model-router migration in progress
- Interim/fallback model paths may still include DeepSeek/Gemini/Ollama

## 5) Redis / Queue State
- Redis moved off M1
- Used for task queueing, dispatch, and lifecycle state transitions
- Infrastructure considered stable

## 6) What Is Finished
- Multi-machine indexing pipeline
- First-pass classification layer
- NAS Postgres stability
- Base infra networking/connectivity
- Redis functional state
- Data integrity preserved

## 7) What Is In Transition
- Centralizing control plane on `claw-architect`
- Model-router transition to OpenAI Codex
- Reducing/removing legacy dependencies
- Defining deeper semantic/media pipeline stages

## 8) Deep Media Categorization Reality Check
Current system is effectively **Layer 1 complete** (structural classification), not full media intelligence.

### Layer status
- **Layer 1 Structural:** done (mime/ext/basic category)
- **Layer 2 Metadata intelligence:** mostly not done
- **Layer 3 Visual semantic tagging:** not done
- **Layer 4 Business semantic grouping:** not done

## 9) Operational Guardrails (Do Not Touch)
- Do not modify `~/claw` unless explicitly approved for emergency fixes
- Do not re-index whole corpus
- Do not mass-rewrite NAS files
- Do not run full-dataset recategorization without staged batching plan

## 10) Recommended Immediate Dev Steps
1. Confirm `claw-architect` uses the same NAS Postgres as legacy `claw`
2. Complete model-router migration path to OpenAI Codex
3. Ensure architect agents operate on existing DB records (no duplicate pipelines)
4. Run dedupe lifecycle from architect control plane
5. Enable/verify orchestrator-driven task lifecycle end-to-end

## 11) Deep-Media Next Phase (Target)
Add architect-side agents (new layer):
- `media-enrich-agent`
- `media-semantic-agent`
- `recategorize-agent`
- `cluster-agent`

### Initial workload query gate
Before implementation, quantify workload:
- count of `unknown`
- count of `confidence < threshold` (e.g. 0.75)
- count of media/image/video files

Use this to choose processing mode:
- ~10k files: direct batches
- ~100k files: staged batched processing
- 1M+ files: multi-phase pipeline with checkpoints

## 12) Current Architect Additions (Experimental)
Recent experimental engine work exists in this repo and is not yet production-hardened:
- `scripts/experiment-engine.js`
- `scripts/adaptive-sender.js`
- `scripts/experiment-dashboard.js`
- Stripe attribution integration hooks

Treat as **experimental** until dependency/runtime validation is completed in target environment.

---

## One-Paragraph Handoff Summary
Legacy `claw` has completed indexing + first-pass classification and should remain frozen. `claw-architect` is the active control plane and should now own orchestration, dedupe, QA, triage, and future semantic/media intelligence passes against the same NAS Postgres source of truth. The current transition priority is model-router migration from Ollama-era paths to OpenAI Codex while avoiding any unnecessary re-indexing or NAS filesystem churn.
