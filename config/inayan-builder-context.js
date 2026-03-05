"use strict";

/**
 * Inayan Builder — canonical audit and architecture (architect → agent → subagents).
 * Single source of truth for tooling and agents. Human summaries in docs/INAYAN-BUILDER-AUDIT.md and docs/INAYAN-BUILDER-ARCHITECTURE.md.
 * Builder runs on most OpenClaw / claw-architect systems via inayanBuildTargets (refresh uses --repos-from-context).
 * @module config/inayan-builder-context
 */

const auditDate = "2026-03-04";

/** Builder targets: from master list (local override or env path; no repo names in committed code). Used with --repos-from-context. */
function loadInayanBuildTargets() {
  const { loadMasterList } = require("./repo-completion-master-list-loader");
  const master = loadMasterList();
  const priority = master.priority_repos || [];
  const additional = master.additional_repos || [];
  return [...new Set([...priority, ...additional])];
}

const inayanBuildTargets = loadInayanBuildTargets();

const groundTruth = [
  { component: "builder_identity", location: "agent-state/agents/builder/SOUL.md, AGENTS.md", whatItDoes: "Soul + runbook for Builder agent; mission, completion policy, quality gates, code exploration standard." },
  { component: "builder_cron_refresh", location: "config/agent-team.json (id: builder)", whatItDoes: "refresh_command: brief:weekly then builder:gap:pulse --repos-from-context. Writer: SHIP_LOG.md. Cron: 25 * * * *. Targets: inayanBuildTargets (most OpenClaw systems from repo-completion-master-list)." },
  { component: "agent_team_cycle", location: "scripts/agent-team-cycle.js", whatItDoes: "On --agent builder --refresh: runs refresh_command then appends makeContent() block to SHIP_LOG.md (outcomes, blockers, next_focus). SHIP_LOG content is from makeContent(), not brief:weekly." },
  { component: "brief_weekly", location: "scripts/weekly-trends-brief.js", whatItDoes: "Writes to ~/notes/briefs/weekly/. Does not write SHIP_LOG.md." },
  { component: "builder_gap_pulse", location: "scripts/builder-gap-pulse.js", whatItDoes: "Runs repo-completion-gap-one per selected repo; for each repo with gaps (incomplete sections, next_actions, issues), queues repo_autofix and opencode_controller with gap_context + builder_policy." },
  { component: "repo_autofix", location: "agents/repo-autofix-agent.js", whatItDoes: "Worker: npm install + plannedChecks (check, build, lint, test, test:e2e); on failure queues site_fix_plan + site_audit." },
  { component: "opencode_controller", location: "agents/opencode-controller-agent.js", whatItDoes: "Worker: plan + implement + review; queues site_fix_plan, repo_autofix, site_audit, github_repo_audit, github_observability_scan; can auto-iterate." },
  { component: "builder_research_agenda", location: "scripts/builder-research-agenda.js", whatItDoes: "Consumes rolling gap report; emits research targets per incomplete section/issue. Not invoked by builder refresh; run separately." },
  { component: "inayan_builder_bot", location: "external product repo", whatItDoes: "Product for Reddit/GitHub research, magic-run. Integration via builder:gap:pulse and manual/API calls; no automatic call from gap-pulse." },
];

const drift = [
  { issue: "ship_log_vs_brief_weekly", where: "docs/INAYAN-BUILDER-REAL-USE.md", detail: "brief:weekly writes to ~/notes/briefs/weekly/; SHIP_LOG.md is updated by agent-team-cycle append. Fixed in doc copy." },
  { issue: "indexing_instruction", where: "AGENTS.md vs .cursor/rules/index-inayan-builder-loop.mdc", detail: "Loop uses jCodeMunch for indexing repos; builder runbook uses symbol-map/MCP first. Different contexts (loop vs builder run)." },
  { issue: "builder_default_repo", where: "config/agent-team.json + inayanBuildTargets", detail: "Refresh runs builder:gap:pulse --repos-from-context (all inayanBuildTargets). For one repo use --repos X or --next." },
  { issue: "builder_agents_refresh", where: "agent-state/agents/builder/AGENTS.md", detail: "Runbook refresh command matches config: brief:weekly && builder:gap:pulse --repos-from-context." },
  { issue: "planner_catalog", where: "agents/planner.js", detail: "builder_gap_pulse, repo_autofix, opencode_controller, site_fix_plan, site_audit added to TASK_CATALOG. Execution of builder_gap_pulse = run npm run builder:gap:pulse." },
];

const hallucinations = [
  { claim: "Builder runs brief:weekly (SHIP_LOG update)", source: "INAYAN-BUILDER-REAL-USE.md", reality: "brief:weekly writes to ~/notes/briefs/weekly; SHIP_LOG is updated by agent-team-cycle." },
  { claim: "orchestrate can route to builder", source: "architect → agent", reality: "Planner TASK_CATALOG includes builder task types; execution of builder_gap_pulse is run CLI script which queues workers." },
  { claim: "External research product is called when you run the loop", source: "cursor rules", reality: "Integration optional; gap-pulse does not call external product APIs." },
];

const structuralGaps = [
  "No single documented architect role handing off to builder; mission control can trigger but architect → builder → subagents chain is in this context only.",
  "Subagents (gap-pulse, repo_autofix, opencode_controller, research-agenda) job functions and handoffs now in this module and architecture doc.",
  "gap_context and builder_policy passed in payloads; canonical payload shape and builder_policy live in scripts/builder-gap-pulse.js.",
  "Builder in agent-team = runner (refresh_command, SHIP_LOG); builder work = repo_autofix + opencode_controller executed by workers.",
];

const recommendations = [
  "Keep doc drift fixed: brief:weekly vs SHIP_LOG described correctly in real-use and this context.",
  "Document architect → builder → subagents in this module; human summary in docs/INAYAN-BUILDER-ARCHITECTURE.md.",
  "Planner task types for builder (builder_gap_pulse, repo_autofix, opencode_controller, site_fix_plan, site_audit) added; builder_gap_pulse execution = run npm run builder:gap:pulse.",
  "Single source of truth for builder policy: BUILDER_COMPLETION_POLICY in scripts/builder-gap-pulse.js; SOUL/AGENTS point to script for canonical policy.",
  "Builder and humans use this context (and audit/architecture docs) to stay aligned and avoid hallucinating.",
];

const hierarchy = {
  architect: {
    role: "Mission Control / Orchestrator",
    description: "Sets goals, triggers runs, monitors progress. Can call dashboard actions or API to run builder / gap pulse / individual tasks. Does not route builder work through planner task catalog by default; planner can emit builder task types.",
  },
  builderAgent: {
    id: "builder",
    role: "Builder Agent (coordinator)",
    description: "Runs brief:weekly then builder:gap:pulse for configured repos; appends run summary to SHIP_LOG.md via agent-team-cycle. Owns SHIP_LOG.md. Cron 25 * * * * or npm run agent:team:run -- --agent builder --refresh.",
  },
  subagents: [
    { id: "gap_pulse_runner", script: "scripts/builder-gap-pulse.js", type: "script" },
    { id: "research_agenda_runner", script: "scripts/builder-research-agenda.js", type: "script" },
    { id: "repo_autofix", worker: "agents/repo-autofix-agent.js", type: "worker" },
    { id: "opencode_controller", worker: "agents/opencode-controller-agent.js", type: "worker" },
  ],
};

const jobFunctions = [
  { role: "architect", whatItDoes: "Sets goals, triggers runs, monitors progress. Can call dashboard or API for builder / gap pulse / tasks.", triggeredBy: "Human, cron, other agents", outputHandoff: "Goals (GOALS.md), API calls, dashboard actions." },
  { role: "builder_agent", whatItDoes: "Runs brief:weekly then builder:gap:pulse for configured repos; appends run summary to SHIP_LOG via agent-team-cycle.", triggeredBy: "agent-team-cycle (cron or --agent builder --refresh)", outputHandoff: "SHIP_LOG.md updated; repo_autofix and opencode_controller queued when repo has gaps." },
  { role: "gap_pulse_runner", whatItDoes: "For each selected repo: runs repo-completion-gap-one, reads rolling gap report; if hasGaps(record), queues repo_autofix + opencode_controller with gap_context and builder_policy.", triggeredBy: "Builder refresh_command or CLI (npm run builder:gap:pulse -- --repos X | --next)", outputHandoff: "Tasks in PostgreSQL; console log." },
  { role: "research_agenda_runner", whatItDoes: "Reads rolling gap report; emits research targets (e.g. GitHub/Reddit queries) per incomplete section/issue.", triggeredBy: "Manual or separate scheduler; not part of builder refresh.", outputHandoff: "Research targets (file or stdout); consumed by humans or external product." },
  { role: "repo_autofix", whatItDoes: "npm install + quality gates (check, build, lint, test, test:e2e). On failure queues site_fix_plan + site_audit.", triggeredBy: "Gap Pulse Runner or API/direct insert", outputHandoff: "Task result; downstream site_fix_plan / site_audit if needed." },
  { role: "opencode_controller", whatItDoes: "Plan + implement + review; can queue site_fix_plan, repo_autofix, site_audit, github_repo_audit, github_observability_scan; can auto-iterate.", triggeredBy: "Gap Pulse Runner or API/direct insert", outputHandoff: "Task result; code changes; downstream tasks." },
];

const handoff = {
  builderToGapPulse: {
    trigger: "Builder refresh_command includes builder:gap:pulse --repos-from-context (targets inayanBuildTargets). Optional: --repos A,B,C or --next for single/small set.",
    input: ["--repos <name>[,name2]", "--next", "--dry-run (optional)"],
    note: "Script reads rolling gap report and master list; no handoff payload from builder to script.",
  },
  gapPulseToWorkers: {
    contract: {
      repo: "string (required)",
      source: "builder_gap_pulse",
      gap_context: { incomplete_sections: "array", benchmark_lookup: "object", issues: "array", next_actions: "array", quality_gate_scripts: "array" },
      builder_policy: "string from BUILDER_COMPLETION_POLICY in builder-gap-pulse.js",
    },
    idempotency: "Tasks deduplicated by idempotency key (type + payload hash).",
    routing: "config/task-routing.js: repo_autofix → claw_tasks_io_heavy, opencode_controller → claw_tasks_ai",
  },
  workerDownstream: {
    repo_autofix: "On failure queues site_fix_plan and site_audit.",
    opencode_controller: "Can queue site_fix_plan, repo_autofix, site_audit, github_repo_audit, github_observability_scan.",
  },
  researchAgendaExternal: "Research agenda produces targets; external product consumes via API or manual. Not wired by builder-gap-pulse; research is separate from pulse + queue fixes.",
};

const dataFlow = [
  "Architect / Human may set goals or trigger builder run.",
  "Builder Agent runs: brief:weekly (writes to ~/notes/briefs/weekly) then builder:gap:pulse --repos-from-context (all inayanBuildTargets; most OpenClaw systems).",
  "Gap Pulse Runner runs repo-completion-gap-one per repo; reads reports/repo-completion-gap-rolling.json; for each repo with gaps queues repo_autofix and opencode_controller with gap_context and builder_policy.",
  "Workers run; results and downstream tasks (site_fix_plan, site_audit, etc.) complete asynchronously.",
  "Agent-team-cycle appends run summary to SHIP_LOG.md (outcomes, blockers, next_focus).",
];

/** Next repo(s) to complete to 100%. Set via INAYAN_NEXT_REPOS (comma-separated); no repo names in code. Focus run: --repos <name>. */
const nextInayanBuildRepos = process.env.INAYAN_NEXT_REPOS
  ? process.env.INAYAN_NEXT_REPOS.split(",").map((s) => s.trim()).filter(Boolean)
  : [];

const references = {
  config: ["config/agent-team.json", "config/task-routing.js", "config/repo-completion-master-list.json", "config/repo-completion-master-list-loader.js", "config/repo-completion-master-list.local.json.example"],
  scripts: ["scripts/builder-gap-pulse.js", "scripts/repo-completion-gap-one.js", "scripts/builder-research-agenda.js", "scripts/agent-team-cycle.js", "scripts/inayan-full-cycle.js"],
  workers: ["agents/repo-autofix-agent.js", "agents/opencode-controller-agent.js"],
  planner: "agents/planner.js",
  docs: ["docs/BUILDER-PROFESSIONAL-COMPLETION.md", "docs/INAYAN-BUILDER-REAL-USE.md", "docs/INAYAN-BUILDER-AUDIT.md", "docs/INAYAN-BUILDER-ARCHITECTURE.md", "docs/INAYAN-NEXT-TARGETS.md"],
  cursorRule: ".cursor/rules/index-inayan-builder-loop.mdc",
};

module.exports = {
  auditDate,
  groundTruth,
  drift,
  hallucinations,
  structuralGaps,
  recommendations,
  hierarchy,
  jobFunctions,
  handoff,
  dataFlow,
  references,
  nextInayanBuildRepos,
  inayanBuildTargets,
  loadInayanBuildTargets,
};
