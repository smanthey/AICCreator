"use strict";

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const { register } = require("./registry");

function safeReadTextFile(p) {
  try {
    const s = fs.readFileSync(p, "utf8");
    return s.slice(0, 20000);
  } catch {
    return "";
  }
}

function extractPdfText(pdfPath) {
  const hasPdfToText = spawnSync("bash", ["-lc", "command -v pdftotext >/dev/null 2>&1"], { encoding: "utf8" });
  if (hasPdfToText.status === 0) {
    const out = spawnSync("pdftotext", ["-q", pdfPath, "-"], { encoding: "utf8", maxBuffer: 10 * 1024 * 1024 });
    if (out.status === 0 && out.stdout) return out.stdout.slice(0, 40000);
  }

  const py = spawnSync(
    "python3",
    [
      "-c",
      [
        "import sys",
        "from pathlib import Path",
        "p = Path(sys.argv[1])",
        "txt = ''",
        "try:",
        "    from pypdf import PdfReader",
        "    r = PdfReader(str(p))",
        "    for i, page in enumerate(r.pages):",
        "        if i > 40:",
        "            break",
        "        t = page.extract_text() or ''",
        "        txt += t + '\\n'",
        "except Exception:",
        "    pass",
        "print(txt[:40000])",
      ].join("\n"),
      pdfPath,
    ],
    { encoding: "utf8", maxBuffer: 10 * 1024 * 1024 }
  );
  if (py.status === 0 && py.stdout) return py.stdout.slice(0, 40000);
  return "";
}

function summarizeText(text) {
  if (!text || !text.trim()) return "No extractable text found.";
  const lines = text
    .split(/\r?\n/)
    .map((x) => x.trim())
    .filter(Boolean)
    .filter((x) => x.length >= 20);
  const uniq = [];
  const seen = new Set();
  for (const line of lines) {
    const key = line.toLowerCase().slice(0, 120);
    if (seen.has(key)) continue;
    seen.add(key);
    uniq.push(line);
    if (uniq.length >= 18) break;
  }
  return uniq.map((x) => `- ${x}`).join("\n");
}

function buildReport(payload, refs) {
  const topic = String(payload.topic || "Plant waveform device R&D");
  const focusAreas = Array.isArray(payload.focus_areas) && payload.focus_areas.length
    ? payload.focus_areas
    : [
        "Manufacturing paths and supplier strategy",
        "BOM ranges and cost model",
        "Firmware/software architecture",
        "Raspberry Pi + ESP32 prototyping stack",
        "Validation, compliance, and test plan",
      ];

  const sections = [];
  sections.push(`# Hardware Research Report: ${topic}`);
  sections.push("");
  sections.push(`Generated: ${new Date().toISOString()}`);
  sections.push("");
  sections.push("## Scope");
  for (const f of focusAreas) sections.push(`- ${f}`);
  sections.push("");
  sections.push("## Source Review");

  for (const r of refs) {
    sections.push(`### ${r.file}`);
    sections.push(`- type: ${r.type}`);
    sections.push(`- extracted_chars: ${r.extracted_chars}`);
    sections.push(r.summary);
    sections.push("");
  }

  sections.push("## Manufacturing Strategy (Draft)");
  sections.push("1. Start with COTS Schumann/7.83Hz modules for baseline characterization.");
  sections.push("2. Parallel custom PCB proto with ESP32 control + isolated output stage.");
  sections.push("3. Split manufacturing into EVT/DVT/PVT gates with pass/fail criteria.");
  sections.push("4. Enforce incoming QC: frequency accuracy, drift, EMI, thermal run, connector durability.");
  sections.push("");

  sections.push("## Cost Model Framework (Draft)");
  sections.push("- Prototype BOM: control MCU, oscillator/timer, output driver, power regulation, enclosure, test fixture.");
  sections.push("- Unit economics model should track: BOM, assembly, yield loss, QA time, packaging, freight, tariffs, return reserve.");
  sections.push("- Run 3 volume tiers: 10-50, 100-500, 1k+ with sensitivity on yield and freight.");
  sections.push("");

  sections.push("## Software / Firmware Architecture (Draft)");
  sections.push("- Device layer: ESP32 firmware for waveform generation, parameter storage, telemetry.");
  sections.push("- Edge layer: Raspberry Pi orchestrator for tests, logging, OTA pipeline, local dashboard.");
  sections.push("- Control plane: API + configuration profiles + manufacturing test script bundle.");
  sections.push("- Include deterministic test vectors for waveform verification and calibration.");
  sections.push("");

  sections.push("## Raspberry Pi Build Track");
  sections.push("- Pi role: lab gateway, data logger, calibration runner, optional local UI server.");
  sections.push("- Interfaces: USB serial, GPIO, I2C/SPI test hooks, optional audio DAC path.");
  sections.push("- Deliverables: automated bring-up script, fixture integration, nightly validation report.");
  sections.push("");

  sections.push("## Next Engineering Steps");
  sections.push("1. Capture electrical specs from all current module candidates into one comparison matrix.");
  sections.push("2. Implement first firmware spike (frequency set + stability logging).\n3. Build verification harness for measured waveform vs target.");
  sections.push("4. Create supplier scorecard: MOQ, lead time, failure rate, communication quality, revision control.");
  sections.push("5. Run pilot lot and update cost model with actuals.");
  sections.push("");

  sections.push("## Open Questions");
  sections.push("- Required certification path for intended markets (FCC/CE/UKCA, safety). ");
  sections.push("- Target user safety envelope and contraindication labeling.");
  sections.push("- Manufacturing partner ownership of test fixtures and golden sample policy.");

  return sections.join("\n");
}

register("hardware_research_report", async (payload = {}) => {
  const files = Array.isArray(payload.reference_files) ? payload.reference_files : [];
  const refs = [];

  for (const filePath of files.slice(0, 20)) {
    const abs = path.resolve(filePath);
    const ext = path.extname(abs).toLowerCase();
    let text = "";

    if (ext === ".pdf") text = extractPdfText(abs);
    else text = safeReadTextFile(abs);

    refs.push({
      file: abs,
      type: ext || "unknown",
      extracted_chars: text.length,
      summary: summarizeText(text),
    });
  }

  const outPath = payload.output_path
    ? path.resolve(payload.output_path)
    : path.resolve("scripts/reports", `${Date.now()}-hardware-research-report.md`);

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  const report = buildReport(payload, refs);
  fs.writeFileSync(outPath, report, "utf8");

  return {
    ok: true,
    output_path: outPath,
    sources_count: refs.length,
    include_web_research: !!payload.include_web_research,
    model_used: "deterministic-hardware-research",
    cost_usd: 0,
  };
});
