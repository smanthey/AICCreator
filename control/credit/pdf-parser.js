"use strict";

const { parseMoney } = require("./utils");

function toIsoDateLoose(input) {
  if (!input) return null;
  const s = String(input).trim();
  if (!s) return null;

  const mdY = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (mdY) {
    let [, m, d, y] = mdY;
    const yy = Number(y);
    const yyyy = yy < 100 ? (yy >= 70 ? 1900 + yy : 2000 + yy) : yy;
    const mm = String(Number(m)).padStart(2, "0");
    const dd = String(Number(d)).padStart(2, "0");
    return `${yyyy}-${mm}-${dd}`;
  }

  const monY = s.match(/^([A-Za-z]{3,9})\s+(\d{4})$/);
  if (monY) {
    const months = {
      jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3,
      apr: 4, april: 4, may: 5, jun: 6, june: 6, jul: 7, july: 7,
      aug: 8, august: 8, sep: 9, sept: 9, september: 9, oct: 10, october: 10,
      nov: 11, november: 11, dec: 12, december: 12,
    };
    const m = months[monY[1].toLowerCase()];
    if (!m) return null;
    return `${monY[2]}-${String(m).padStart(2, "0")}-01`;
  }

  return null;
}

function compact(value) {
  return String(value || "")
    .replace(/\uE9EF|\uE9EC|\uE9F0|\uE9F1|\uE9E0|\uE9E1||||/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\s*\n\s*/g, "\n")
    .trim();
}

function splitByStarts(section, starts) {
  const blocks = [];
  if (!section || !starts.length) return blocks;
  for (let i = 0; i < starts.length; i += 1) {
    const start = starts[i];
    const end = i + 1 < starts.length ? starts[i + 1] : section.length;
    const block = section.slice(start, end).trim();
    if (block) blocks.push(block);
  }
  return blocks;
}

function findAllIndexes(raw, pattern) {
  const flags = pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`;
  const re = new RegExp(pattern.source, flags);
  const out = [];
  let m;
  while ((m = re.exec(raw)) !== null) out.push(m.index);
  return out;
}

function parseSectionBounds(raw, startPattern, endPattern, minLen = 0) {
  const starts = findAllIndexes(raw, startPattern);
  if (!starts.length) return "";

  let best = "";
  for (const start of starts) {
    const tail = raw.slice(start);
    const relEnd = tail.search(endPattern);
    const candidate = relEnd < 0 ? tail : tail.slice(0, relEnd);
    if (candidate.length > best.length && candidate.length >= minLen) {
      best = candidate;
    }
  }
  return best;
}

function parseEquifaxTradelines(raw) {
  const section = parseSectionBounds(
    raw,
    /Accounts\s+This includes all types of credit accounts/i,
    /\b(Consumer Statements|Inquiries|Collections|Public Records)\b/i,
    2000
  ) || parseSectionBounds(raw, /\bAccounts\b/i, /\b(Consumer Statements|Inquiries|Collections|Public Records)\b/i, 2000);
  if (!section) return [];

  const starts = [];
  const re = /\n\s*([A-Z][A-Z0-9&'.,/ \-]{3,})\s*(?:-\s*(?:Closed|Open|Charged Off|Collection))?\n[^\n]{0,180}?Date Reported:/g;
  let m;
  while ((m = re.exec(section)) !== null) starts.push(m.index);

  const blocks = splitByStarts(section, starts);
  const out = [];

  for (const block of blocks) {
    const lines = block.split("\n").map((l) => l.trim()).filter(Boolean);
    const name = lines[0] || null;
    const accountRef = (block.match(/Account Number:\s*([*X0-9A-Z\-]+)/i) || [])[1] || null;
    const status = (block.match(/Status:\s*([^\n]+)/i) || [])[1] || null;

    out.push({
      item_type: "trade_line",
      furnisher_name: name,
      account_ref: accountRef,
      account_status: status,
      payment_status: status,
      opened_date: toIsoDateLoose((block.match(/Date Opened:\s*([0-9/]{6,10})/i) || [])[1]),
      dofd_date: toIsoDateLoose((block.match(/Date of 1st Delinquency:\s*([0-9/]{6,10})/i) || [])[1]),
      last_payment_date: toIsoDateLoose((block.match(/Date of Last Payment:\s*([0-9/]{6,10})/i) || [])[1]),
      closed_date: toIsoDateLoose((block.match(/Date Closed:\s*([0-9/]{6,10})/i) || [])[1]),
      balance: parseMoney((block.match(/Balance:\s*\$?\s*([0-9,.-]+)/i) || [])[1]),
      credit_limit: parseMoney((block.match(/Credit Limit:\s*\$?\s*([0-9,.-]+)/i) || [])[1]),
      high_balance: parseMoney((block.match(/High Credit:\s*\$?\s*([0-9,.-]+)/i) || [])[1]),
      past_due_amount: parseMoney((block.match(/Amount Past Due:\s*\$?\s*([0-9,.-]+)/i) || [])[1]),
      remarks: ((block.match(/Narrative Code\(s\):\s*([^\n]+)/i) || [])[1] || "").trim() || null,
      raw_data_json: {
        parser: "equifax_v1",
        snippet: block.slice(0, 2000),
      },
    });
  }

  return out.filter((x) => x.furnisher_name || x.account_ref);
}

function parseExperianTradelines(raw) {
  const section = parseSectionBounds(raw, /\bAccounts\b/i, /\b(Hard Inquiries|Soft Inquiries|Public Records)\b/i, 2000);
  if (!section) return [];

  const starts = [];
  const re = /\n([A-Z][A-Z0-9&'.,/ \-]{3,})\n[^\n]*\nAccount Info/g;
  let m;
  while ((m = re.exec(section)) !== null) starts.push(m.index);

  const blocks = splitByStarts(section, starts);
  const out = [];

  for (const block of blocks) {
    const lines = block.split("\n").map((l) => l.trim()).filter(Boolean);
    const name = lines[0] || null;

    const status = (block.match(/Status\s*([^\n]+)/i) || [])[1] || null;
    const recentPaymentLine = (block.match(/Recent Payment\s*([^\n]+)/i) || [])[1] || "";
    const recentDate = (recentPaymentLine.match(/(\d{1,2}\/\d{1,2}\/\d{2,4})/) || [])[1] || null;

    out.push({
      item_type: "trade_line",
      furnisher_name: name,
      account_ref: (block.match(/Account Number\s*([A-Z0-9*X\-]+)/i) || [])[1] || null,
      account_status: status,
      payment_status: status,
      opened_date: toIsoDateLoose((block.match(/Date Opened\s*([0-9/]{6,10})/i) || [])[1]),
      last_reported_date: toIsoDateLoose((block.match(/Balance Updated\s*([0-9/]{6,10})/i) || [])[1]),
      last_payment_date: toIsoDateLoose(recentDate),
      balance: parseMoney((block.match(/Balance\s*\$?\s*([0-9,.-]+)/i) || [])[1]),
      credit_limit: parseMoney((block.match(/Credit Limit\s*\$?\s*([0-9,.-]+)/i) || [])[1]),
      high_balance: parseMoney((block.match(/Highest Balance\s*\$?\s*([0-9,.-]+)/i) || [])[1]),
      monthly_payment: parseMoney((block.match(/Monthly Payment\s*\$?\s*([0-9,.-]+)/i) || [])[1]),
      remarks: null,
      raw_data_json: {
        parser: "experian_v1",
        snippet: block.slice(0, 2000),
      },
    });
  }

  return out.filter((x) => x.furnisher_name || x.account_ref);
}

function parseTransunionTradelines(raw) {
  const section = parseSectionBounds(raw, /\bAccounts\b/i, /\b(Inquiries|Collections|Public Records)\b/i, 2000);
  if (!section) return [];

  const starts = [];
  const re = /\n([A-Z][A-Z0-9&'.,/ \-]{3,})\n([0-9*X]{8,}[^\n]*)\nAccount Information/g;
  let m;
  while ((m = re.exec(section)) !== null) starts.push(m.index);

  const blocks = splitByStarts(section, starts);
  const out = [];

  for (const block of blocks) {
    const lines = block.split("\n").map((l) => l.trim()).filter(Boolean);
    const name = lines[0] || null;

    out.push({
      item_type: "trade_line",
      furnisher_name: name,
      account_ref: (block.match(/\n([0-9*X]{8,}[^\n]*)\nAccount Information/i) || [])[1] || null,
      account_status: (block.match(/Pay Status\s*([^\n]+)/i) || [])[1] || null,
      payment_status: (block.match(/Pay Status\s*([^\n]+)/i) || [])[1] || null,
      opened_date: toIsoDateLoose((block.match(/Date Opened\s*([0-9/]{6,10})/i) || [])[1]),
      last_reported_date: toIsoDateLoose((block.match(/Date Updated\s*([0-9/]{6,10})/i) || [])[1]),
      last_payment_date: toIsoDateLoose((block.match(/Last Payment Made\s*([0-9/]{6,10})/i) || [])[1]),
      closed_date: toIsoDateLoose((block.match(/Date Closed\s*([0-9/]{6,10})/i) || [])[1]),
      balance: parseMoney((block.match(/\bBalance\s*\$?\s*([0-9,.-]+)/i) || [])[1]),
      credit_limit: parseMoney((block.match(/Credit Limit\s*\$?\s*([0-9,.-]+)/i) || [])[1]),
      high_balance: parseMoney((block.match(/High Balance\s*\$?\s*([0-9,.-]+)/i) || [])[1]),
      monthly_payment: parseMoney((block.match(/Payment Received\s*\$?\s*([0-9,.-]+)/i) || [])[1]),
      remarks: (block.match(/Remarks\s*([^\n]+)/i) || [])[1] || null,
      raw_data_json: {
        parser: "transunion_v1",
        snippet: block.slice(0, 2000),
      },
    });
  }

  return out.filter((x) => x.furnisher_name || x.account_ref);
}

function parseInquiries(raw, bureau) {
  const hardNone = /\bNo hard inquiries\b/i.test(raw);
  if (hardNone) return [];

  const b = String(bureau || "").toLowerCase();
  const startPattern = b === "experian" ? /\bHard Inquiries\b/i : /\b(Hard Inquiries|Inquiries)\b/i;
  const section = parseSectionBounds(raw, startPattern, /\b(Collections|Public Records|Soft Inquiries)\b/i, 200);
  if (!section) return [];

  const out = [];
  const lines = section.split("\n").map((l) => l.trim()).filter(Boolean);
  for (let i = 0; i < lines.length - 1; i += 1) {
    const line = lines[i];
    const next = lines[i + 1];
    if (/^(soft inquiries|collections|public records)$/i.test(line)) continue;
    if (/address|phone|page \d+|annual credit report|inquired on/i.test(line)) continue;

    // Creditor-like names only (avoid addresses and random lines)
    const likelyCreditor = /^[A-Z0-9&'.,\/ \-]{3,60}$/.test(line) &&
      !/\d{3,}/.test(line) &&
      !/\b(AZ|CA|FL|NV|UT|DE|TX|NY)\b/.test(line);
    if (!likelyCreditor) continue;

    let date = (line.match(/(\d{1,2}\/\d{1,2}\/\d{2,4})/) || [])[1]
      || (next.match(/(\d{1,2}\/\d{1,2}\/\d{2,4})/) || [])[1];
    if (!date && /inquired on/i.test(next) && lines[i + 2]) {
      date = (lines[i + 2].match(/(\d{1,2}\/\d{1,2}\/\d{2,4})/) || [])[1] || null;
    }
    if (!date) continue;

    const name = line.replace(/(Date|Date Requested|Date of Inquiry).*$/i, "").trim();
    if (!name || name.length < 3) continue;

    out.push({
      item_type: "inquiry",
      furnisher_name: name,
      account_ref: null,
      opened_date: toIsoDateLoose(date),
      raw_data_json: { parser: `${bureau}_inq_v1`, source_line: `${line} | ${next}` },
    });
  }

  // de-dupe by name+date
  const seen = new Set();
  return out.filter((r) => {
    const k = `${(r.furnisher_name || "").toLowerCase()}|${r.opened_date || ""}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  }).slice(0, 40);
}

function parseCollections(raw, bureau) {
  const b = String(bureau || "").toLowerCase();
  const section = parseSectionBounds(
    raw,
    /\b(Collections|Collection Accounts)\b/i,
    /\b(Public Records|Inquiries|Hard Inquiries|Soft Inquiries|End of Report)\b/i,
    120
  );
  if (!section) return [];

  const starts = [];
  let re = /\n\s*([A-Z][A-Z0-9&'.,/ \-]{3,})\s*\n[^\n]{0,180}?(?:Account|Balance|Status|Date|Opened|Reported)/g;
  let m;
  while ((m = re.exec(section)) !== null) starts.push(m.index);
  if (!starts.length) {
    re = /\n\s*([A-Z][A-Z0-9&'.,/ \-]{3,})\s*(?:-\s*(?:Collection|Charged Off|Closed))?\n/g;
    while ((m = re.exec(section)) !== null) starts.push(m.index);
  }

  const blocks = splitByStarts(section, starts);
  const out = [];

  for (const block of blocks) {
    const lines = block.split("\n").map((l) => l.trim()).filter(Boolean);
    const name = lines[0] || null;
    const accountRef = (block.match(/(?:Account(?: Number)?|Acct(?: Number)?)[\s:]*([*X0-9A-Z\-]+)/i) || [])[1] || null;
    const status = (block.match(/(?:Status|Pay Status)[\s:]*([^\n]+)/i) || [])[1] || null;
    const remarks = (block.match(/(?:Remarks|Comment|Narrative)[\s:]*([^\n]+)/i) || [])[1] || null;

    const item = {
      item_type: "collection",
      furnisher_name: name,
      account_ref: accountRef,
      account_status: status,
      payment_status: status,
      opened_date: toIsoDateLoose((block.match(/(?:Date Opened|Opened)[\s:]*([0-9/]{6,10}|[A-Za-z]{3,9}\s+\d{4})/i) || [])[1]),
      last_reported_date: toIsoDateLoose((block.match(/(?:Date Reported|Date Updated|Updated)[\s:]*([0-9/]{6,10}|[A-Za-z]{3,9}\s+\d{4})/i) || [])[1]),
      dofd_date: toIsoDateLoose((block.match(/(?:Date of 1st Delinquency|DOFD)[\s:]*([0-9/]{6,10}|[A-Za-z]{3,9}\s+\d{4})/i) || [])[1]),
      last_payment_date: toIsoDateLoose((block.match(/(?:Date of Last Payment|Last Payment(?: Made)?)[\s:]*([0-9/]{6,10}|[A-Za-z]{3,9}\s+\d{4})/i) || [])[1]),
      balance: parseMoney((block.match(/(?:Balance|Amount Owed)[\s:]*\$?\s*([0-9,.-]+)/i) || [])[1]),
      past_due_amount: parseMoney((block.match(/(?:Past Due|Amount Past Due)[\s:]*\$?\s*([0-9,.-]+)/i) || [])[1]),
      remarks,
      raw_data_json: {
        parser: `${b || "other"}_collections_v1`,
        snippet: block.slice(0, 2000),
      },
    };

    const hasSignal = item.furnisher_name || item.account_ref || item.balance != null;
    if (hasSignal) out.push(item);
  }

  const seen = new Set();
  return out.filter((r) => {
    const k = `${String(r.furnisher_name || "").toLowerCase()}|${String(r.account_ref || "").toLowerCase()}|${String(r.balance || "")}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

function parsePersonalInfo(raw, bureau) {
  const out = [];

  const nameMatches = [...raw.matchAll(/\b(?:Name|Also Known As|AKA)\b[^\n]*\n([^\n]{3,80})/gi)].slice(0, 8);
  for (const m of nameMatches) {
    const value = (m[1] || "").trim();
    if (!value || /page \d+/i.test(value)) continue;
    out.push({
      item_type: "personal_info",
      remarks: value,
      raw_data_json: { parser: `${bureau}_identity_v1`, field: "name", value },
    });
  }

  const addrMatches = [...raw.matchAll(/(?:Current Address|Other Address|Address)\s*\n([^\n]{8,140})/gi)].slice(0, 20);
  for (const m of addrMatches) {
    const value = (m[1] || "").trim();
    if (!value || /https?:\/\//i.test(value)) continue;
    out.push({
      item_type: "personal_info",
      remarks: value,
      raw_data_json: { parser: `${bureau}_identity_v1`, field: "address", value },
    });
  }

  return out;
}

function parseCreditReportText(rawText, bureau) {
  const raw = compact(rawText || "");
  if (!raw) return { items: [], stats: { trade_lines: 0, inquiries: 0, personal_info: 0 } };

  const b = String(bureau || "other").toLowerCase();
  let tradelines = [];
  if (b === "equifax") tradelines = parseEquifaxTradelines(raw);
  else if (b === "experian") tradelines = parseExperianTradelines(raw);
  else if (b === "transunion") tradelines = parseTransunionTradelines(raw);
  else {
    tradelines = [
      ...parseEquifaxTradelines(raw),
      ...parseExperianTradelines(raw),
      ...parseTransunionTradelines(raw),
    ];
  }

  const inquiries = parseInquiries(raw, b);
  const collections = parseCollections(raw, b);
  const personal = parsePersonalInfo(raw, b);

  const items = [...tradelines, ...collections, ...inquiries, ...personal];
  return {
    items,
    stats: {
      trade_lines: tradelines.length,
      collections: collections.length,
      inquiries: inquiries.length,
      personal_info: personal.length,
      total: items.length,
    },
  };
}

module.exports = {
  parseCreditReportText,
};
