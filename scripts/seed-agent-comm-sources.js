#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "../.env") });

const pg = require("../infra/postgres");

const DRY_RUN = process.argv.includes("--dry-run");
const ROOT = path.join(__dirname, "..");
const REPORT_PATH = path.join(ROOT, "reports", "agent-comm-source-seed-latest.json");

function nowIso() {
  return new Date().toISOString();
}

const REPO_SOURCES = [
  {
    source_key: "repo:openai/openai-agents-js",
    domain: "agent",
    title: "OpenAI Agents SDK",
    url: "https://github.com/openai/openai-agents-js",
    summary: "Handoffs, guardrails, orchestration, tracing, and MCP integration for production multi-agent systems.",
    score: 97,
    metadata: {
      focus: ["handoff", "agent_as_tool", "guardrails", "tracing", "sessions"],
      source_type_hint: "official_framework",
      docs: "https://openai.github.io/openai-agents-js/guides/multi-agent/",
      indexed_from: "seed-agent-comm-sources",
    },
  },
  {
    source_key: "repo:modelcontextprotocol/specification",
    domain: "agent",
    title: "Model Context Protocol Specification",
    url: "https://github.com/modelcontextprotocol/specification",
    summary: "Protocol spec for tools/resources/prompts with capability negotiation and secure interoperability.",
    score: 96,
    metadata: {
      focus: ["tools", "resources", "prompts", "capability_negotiation", "security"],
      source_type_hint: "protocol_spec",
      docs: "https://modelcontextprotocol.io/specification/2025-06-18/",
      indexed_from: "seed-agent-comm-sources",
    },
  },
  {
    source_key: "repo:google/A2A",
    domain: "agent",
    title: "Agent2Agent Protocol (A2A)",
    url: "https://github.com/google/A2A",
    summary: "Open agent interoperability protocol for discovery, capability negotiation, task lifecycle, and secure exchange.",
    score: 95,
    metadata: {
      focus: ["agent_discovery", "json_rpc", "sse", "async_tasks", "enterprise_auth"],
      source_type_hint: "protocol_spec",
      docs: "https://google-a2a.github.io/A2A/specification/",
      indexed_from: "seed-agent-comm-sources",
    },
  },
  {
    source_key: "repo:microsoft/autogen",
    domain: "agent",
    title: "Microsoft AutoGen",
    url: "https://github.com/microsoft/autogen",
    summary: "Conversable multi-agent framework with tool use, human-in-the-loop, and flexible conversation topologies.",
    score: 93,
    metadata: {
      focus: ["conversable_agents", "human_in_the_loop", "tool_use", "conversation_patterns"],
      docs: "https://microsoft.github.io/autogen/",
      indexed_from: "seed-agent-comm-sources",
    },
  },
  {
    source_key: "repo:langchain-ai/langgraph-supervisor-py",
    domain: "agent",
    title: "LangGraph Supervisor",
    url: "https://github.com/langchain-ai/langgraph-supervisor-py",
    summary: "Supervisor-centric orchestration with tool-based handoff and memory-aware message history controls.",
    score: 90,
    metadata: {
      focus: ["supervisor", "handoff", "history_management", "memory"],
      docs: "https://docs.langchain.com/oss/python/langchain/multi-agent/handoffs",
      indexed_from: "seed-agent-comm-sources",
    },
  },
  {
    source_key: "repo:langchain-ai/langgraph",
    domain: "agent",
    title: "LangGraph",
    url: "https://github.com/langchain-ai/langgraph",
    summary: "Stateful graph runtime for durable multi-agent and tool-driven workflows.",
    score: 89,
    metadata: {
      focus: ["durable_execution", "state_graph", "interrupts", "human_review"],
      indexed_from: "seed-agent-comm-sources",
    },
  },
  {
    source_key: "repo:crewAIInc/crewAI",
    domain: "agent",
    title: "CrewAI",
    url: "https://github.com/crewAIInc/crewAI",
    summary: "Production-oriented crews and flows with guardrails, memory, and observability patterns.",
    score: 86,
    metadata: {
      focus: ["crew_orchestration", "flow_routing", "guardrails", "memory"],
      docs: "https://docs.crewai.com/",
      indexed_from: "seed-agent-comm-sources",
    },
  },
  {
    source_key: "repo:run-llama/llama_index",
    domain: "agent",
    title: "LlamaIndex",
    url: "https://github.com/run-llama/llama_index",
    summary: "Agent workflow, orchestrator, and custom planner patterns with explicit state transfer options.",
    score: 85,
    metadata: {
      focus: ["agentworkflow", "orchestrator", "custom_planner", "state_persistence"],
      docs: "https://docs.llamaindex.ai/en/stable/understanding/agent/multi_agent/",
      indexed_from: "seed-agent-comm-sources",
    },
  },
  {
    source_key: "repo:camel-ai/camel",
    domain: "agent",
    title: "CAMEL Multi-Agent Framework",
    url: "https://github.com/camel-ai/camel",
    summary: "Role-based agent society framework emphasizing communication and collaborative behavior at scale.",
    score: 82,
    metadata: {
      focus: ["role_playing", "agent_society", "communication"],
      indexed_from: "seed-agent-comm-sources",
    },
  },
  {
    source_key: "repo:SWE-agent/SWE-agent",
    domain: "qa",
    title: "SWE-agent",
    url: "https://github.com/SWE-agent/SWE-agent",
    summary: "Software-engineering agent automation with issue-to-patch workflows and evaluation discipline.",
    score: 80,
    metadata: {
      focus: ["issue_to_patch", "tool_use", "evaluation", "engineering_agents"],
      indexed_from: "seed-agent-comm-sources",
    },
  },
  {
    source_key: "repo:nats-io/nats.docs",
    domain: "queue",
    title: "NATS / JetStream Docs",
    url: "https://github.com/nats-io/nats.docs",
    summary: "Durable message streams, replay, deduplication, and acknowledgement semantics for robust agent messaging.",
    score: 92,
    metadata: {
      focus: ["durable_streaming", "dedupe", "replay", "acksync", "workqueue"],
      docs: "https://docs.nats.io/nats-concepts/jetstream",
      indexed_from: "seed-agent-comm-sources",
    },
  },
  {
    source_key: "repo:open-telemetry/opentelemetry-specification",
    domain: "infra",
    title: "OpenTelemetry Specification",
    url: "https://github.com/open-telemetry/opentelemetry-specification",
    summary: "Trace context propagation and semantic conventions for end-to-end observability in distributed agent systems.",
    score: 91,
    metadata: {
      focus: ["trace_context", "messaging_semconv", "distributed_tracing", "propagation"],
      docs: "https://opentelemetry.io/docs/specs/semconv/messaging/messaging-spans/",
      indexed_from: "seed-agent-comm-sources",
    },
  },
];

const PAPER_SOURCES = [
  {
    source_key: "paper:arxiv:2502.14321",
    domain: "agent",
    title: "Beyond Self-Talk: A Communication-Centric Survey of LLM-Based Multi-Agent Systems",
    url: "https://arxiv.org/abs/2502.14321",
    summary: "Communication-centric survey of architectures, strategies, paradigms, and robustness issues in LLM MAS.",
    score: 94,
    source_updated_at: "2025-02-20T00:00:00.000Z",
    metadata: { focus: ["communication_strategies", "scalability", "security", "multimodal"] },
  },
  {
    source_key: "paper:arxiv:2504.01963",
    domain: "agent",
    title: "LLMs Working in Harmony: A Survey on Technological Aspects of Effective LLM MAS",
    url: "https://arxiv.org/abs/2504.01963",
    summary: "Survey of architecture, memory, planning, and framework tradeoffs for multi-agent robustness.",
    score: 92,
    source_updated_at: "2025-03-13T00:00:00.000Z",
    metadata: { focus: ["architecture", "memory", "planning", "scalability"] },
  },
  {
    source_key: "paper:arxiv:2501.06322",
    domain: "agent",
    title: "Multi-Agent Collaboration Mechanisms: A Survey of LLMs",
    url: "https://arxiv.org/abs/2501.06322",
    summary: "Framework for collaboration types, structures, strategies, and coordination protocols.",
    score: 90,
    source_updated_at: "2025-01-10T00:00:00.000Z",
    metadata: { focus: ["coordination_protocols", "collaboration_types", "distributed_structures"] },
  },
  {
    source_key: "paper:arxiv:2506.02951",
    domain: "agent",
    title: "Adaptive Graph Pruning for Multi-Agent Communication",
    url: "https://arxiv.org/abs/2506.02951",
    summary: "Task-adaptive optimization of agent count and communication topology to cut token cost and improve quality.",
    score: 88,
    source_updated_at: "2025-06-03T00:00:00.000Z",
    metadata: { focus: ["topology_optimization", "cost_reduction", "adaptive_routing"] },
  },
  {
    source_key: "paper:arxiv:2510.17149",
    domain: "agent",
    title: "Which LLM Multi-Agent Protocol to Choose?",
    url: "https://arxiv.org/abs/2510.17149",
    summary: "ProtocolBench and ProtocolRouter benchmarking protocol tradeoffs across latency, overhead, and resilience.",
    score: 89,
    source_updated_at: "2025-10-20T00:00:00.000Z",
    metadata: { focus: ["protocol_selection", "latency_vs_success", "failure_recovery"] },
  },
  {
    source_key: "paper:arxiv:2505.06416",
    domain: "agent",
    title: "ScaleMCP: Dynamic and Auto-Synchronizing MCP Tools for LLM Agents",
    url: "https://arxiv.org/abs/2505.06416",
    summary: "Dynamic MCP tool retrieval and synchronization patterns to reduce stale tool catalogs.",
    score: 87,
    source_updated_at: "2025-05-09T00:00:00.000Z",
    metadata: { focus: ["mcp_tool_sync", "dynamic_tool_retrieval", "tool_catalog_consistency"] },
  },
];

const ALL_SOURCES = [
  ...REPO_SOURCES.map((s) => ({ ...s, source_type: "repo" })),
  ...PAPER_SOURCES.map((s) => ({ ...s, source_type: "paper", metadata: { ...(s.metadata || {}), indexed_from: "seed-agent-comm-sources" } })),
];

async function ensureSchema() {
  await pg.query(`
    CREATE TABLE IF NOT EXISTS knowledge_sources (
      source_key TEXT PRIMARY KEY,
      source_type TEXT NOT NULL CHECK (source_type IN ('repo','paper')),
      domain TEXT NOT NULL,
      title TEXT,
      url TEXT,
      summary TEXT,
      source_updated_at TIMESTAMPTZ,
      score INTEGER NOT NULL DEFAULT 0,
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      indexed BOOLEAN NOT NULL DEFAULT FALSE,
      last_index_attempt_at TIMESTAMPTZ,
      status TEXT NOT NULL DEFAULT 'active',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}

async function upsertSource(row) {
  if (DRY_RUN) return { changed: false };
  const existing = await pg.query(
    `SELECT source_key, source_type, domain, title, url, summary, score, metadata, status
       FROM knowledge_sources
      WHERE source_key = $1`,
    [row.source_key]
  );
  await pg.query(
    `INSERT INTO knowledge_sources
      (source_key, source_type, domain, title, url, summary, source_updated_at, score, metadata, indexed, last_index_attempt_at, status, updated_at)
     VALUES
      ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, FALSE, NULL, 'active', NOW())
     ON CONFLICT (source_key)
     DO UPDATE SET
      source_type = EXCLUDED.source_type,
      domain = EXCLUDED.domain,
      title = EXCLUDED.title,
      url = EXCLUDED.url,
      summary = EXCLUDED.summary,
      source_updated_at = EXCLUDED.source_updated_at,
      score = EXCLUDED.score,
      metadata = EXCLUDED.metadata,
      status = 'active',
      updated_at = NOW()`,
    [
      row.source_key,
      row.source_type,
      row.domain,
      row.title || null,
      row.url || null,
      row.summary || null,
      row.source_updated_at || null,
      Number(row.score || 0),
      JSON.stringify(row.metadata || {}),
    ]
  );
  return { changed: existing.rowCount === 0 ? "inserted" : "updated" };
}

function buildFollowUps() {
  return [
    "npm run -s pattern:robust:build",
    "npm run -s qa:symbolic:hub",
    "npm run -s progress:enforce",
  ];
}

async function main() {
  const report = {
    ok: true,
    dry_run: DRY_RUN,
    generated_at: nowIso(),
    source_count: ALL_SOURCES.length,
    inserted: 0,
    updated: 0,
    by_domain: {},
    by_type: {},
    sources: [],
    recommended_next: buildFollowUps(),
  };

  await ensureSchema();

  for (const row of ALL_SOURCES) {
    const res = await upsertSource(row);
    if (res.changed === "inserted") report.inserted += 1;
    if (res.changed === "updated") report.updated += 1;
    report.by_domain[row.domain] = (report.by_domain[row.domain] || 0) + 1;
    report.by_type[row.source_type] = (report.by_type[row.source_type] || 0) + 1;
    report.sources.push({
      source_key: row.source_key,
      source_type: row.source_type,
      domain: row.domain,
      score: row.score,
      url: row.url,
      status: DRY_RUN ? "planned" : (res.changed || "unchanged"),
    });
  }

  fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
  fs.writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));
}

main()
  .catch((err) => {
    console.error("[seed-agent-comm-sources] fatal:", err.message);
    process.exit(1);
  })
  .finally(async () => {
    await pg.end().catch(() => {});
  });
