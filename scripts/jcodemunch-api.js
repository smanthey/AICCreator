#!/usr/bin/env node
/**
 * jcodemunch-api.js — REST API wrapper around the jcodemunch local index.
 *
 * Exposes the same functionality as the MCP tools so Ollama, DeepSeek,
 * and any OpenClaw agent can search/navigate all indexed repos via HTTP.
 *
 * Port: 4055   (Mission Control is 4051, no conflict)
 * Index dir: ~/.code-index/
 *
 * Endpoints:
 *   GET /api/health
 *   GET /api/repos
 *   GET /api/outline?repo=local/claw-architect
 *   GET /api/file-tree?repo=local/claw-architect[&prefix=scripts]
 *   GET /api/file-outline?repo=local/claw-architect&file=scripts/architect-api.js
 *   GET /api/search?repo=local/claw-architect&q=uptime[&kind=function][&lang=javascript][&limit=20]
 *   GET /api/symbol?repo=local/claw-architect&id=scripts/architect-api.js::runWatchdog#function
 *   GET /api/search-text?repo=local/claw-architect&q=FRESHNESS_SLA[&limit=20]
 *   GET /api/search-all?q=uptime[&kind=function][&limit=20]   ← searches ALL repos
 */

'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');

const PORT = parseInt(process.env.JCODEMUNCH_API_PORT || '4055', 10);
const HOST = process.env.JCODEMUNCH_API_HOST || '127.0.0.1';
const API_KEY = String(process.env.JCODEMUNCH_API_KEY || '').trim();
const ALLOWED_ORIGINS = String(
  process.env.JCODEMUNCH_ALLOWED_ORIGINS || 'http://localhost:4051,http://127.0.0.1:4051'
)
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
const ALLOW_ANY_ORIGIN = ALLOWED_ORIGINS.includes('*');
const INDEX_DIR = path.join(process.env.HOME, '.code-index');

// ── Index cache ──────────────────────────────────────────────────────────────

const _cache = new Map(); // repo-key -> { index, mtime }

function indexPath(repoKey) {
  // repoKey e.g. "local/claw-architect" → "local-claw-architect.json"
  return path.join(INDEX_DIR, repoKey.replace(/\//g, '-') + '.json');
}

function loadIndex(repoKey) {
  const fp = indexPath(repoKey);
  try {
    const stat = fs.statSync(fp);
    const cached = _cache.get(repoKey);
    if (cached && cached.mtime >= stat.mtimeMs) return cached.index;
    const index = JSON.parse(fs.readFileSync(fp, 'utf8'));
    _cache.set(repoKey, { index, mtime: stat.mtimeMs });
    return index;
  } catch {
    return null;
  }
}

function listRepoKeys() {
  try {
    return fs.readdirSync(INDEX_DIR)
      .filter(f => f.endsWith('.json') && !f.startsWith('_'))
      .map(f => f.slice(0, -5).replace('-', '/'));  // "local-foo" → "local/foo"
  } catch {
    return [];
  }
}

// ── Search helpers ────────────────────────────────────────────────────────────

function symbolMatches(sym, q, kind, lang, filePattern) {
  const ql = q ? q.toLowerCase() : null;
  if (ql) {
    const hay = [sym.name, sym.qualified_name, sym.signature, sym.summary, sym.docstring]
      .filter(Boolean).join(' ').toLowerCase();
    if (!hay.includes(ql)) return false;
  }
  if (kind && sym.kind !== kind) return false;
  if (lang && sym.language !== lang) return false;
  if (filePattern) {
    const re = new RegExp(
      filePattern.replace(/\*\*/g, '.*').replace(/\*/g, '[^/]*').replace(/\?/g, '.'),
      'i'
    );
    if (!re.test(sym.file)) return false;
  }
  return true;
}

function symbolSummary(sym) {
  return {
    id: sym.id,
    file: sym.file,
    name: sym.name,
    kind: sym.kind,
    language: sym.language,
    signature: sym.signature,
    summary: sym.summary || sym.docstring || sym.signature,
    line: sym.line,
    end_line: sym.end_line,
  };
}

// ── Route handlers ────────────────────────────────────────────────────────────

function handleHealth(req, res) {
  const keys = listRepoKeys();
  send(res, 200, { ok: true, indexed_repos: keys.length, index_dir: INDEX_DIR });
}

function handleRepos(req, res) {
  const keys = listRepoKeys();
  const repos = keys.map(key => {
    const idx = loadIndex(key);
    if (!idx) return { repo: key, error: 'failed to load' };
    return {
      repo: key,
      indexed_at: idx.indexed_at,
      file_count: (idx.source_files || []).length,
      symbol_count: (idx.symbols || []).length,
      languages: idx.languages || {},
    };
  });
  send(res, 200, { count: repos.length, repos });
}

function handleOutline(req, res, params) {
  const repoKey = params.get('repo');
  if (!repoKey) return send(res, 400, { error: 'repo param required' });
  const idx = loadIndex(repoKey);
  if (!idx) return send(res, 404, { error: `repo not found: ${repoKey}` });

  const dirCounts = {};
  for (const f of (idx.source_files || [])) {
    const dir = f.includes('/') ? f.split('/')[0] + '/' : './';
    dirCounts[dir] = (dirCounts[dir] || 0) + 1;
  }
  const kindCounts = {};
  for (const sym of (idx.symbols || [])) {
    kindCounts[sym.kind] = (kindCounts[sym.kind] || 0) + 1;
  }
  send(res, 200, {
    repo: repoKey,
    indexed_at: idx.indexed_at,
    file_count: (idx.source_files || []).length,
    symbol_count: (idx.symbols || []).length,
    languages: idx.languages || {},
    directories: dirCounts,
    symbol_kinds: kindCounts,
  });
}

function handleFileTree(req, res, params) {
  const repoKey = params.get('repo');
  if (!repoKey) return send(res, 400, { error: 'repo param required' });
  const idx = loadIndex(repoKey);
  if (!idx) return send(res, 404, { error: `repo not found: ${repoKey}` });

  const prefix = params.get('prefix') || '';
  const files = (idx.source_files || [])
    .filter(f => !prefix || f.startsWith(prefix));

  // Count symbols per file
  const symCount = {};
  for (const sym of (idx.symbols || [])) {
    symCount[sym.file] = (symCount[sym.file] || 0) + 1;
  }

  // Get language per file from symbols
  const fileLang = {};
  for (const sym of (idx.symbols || [])) {
    if (!fileLang[sym.file]) fileLang[sym.file] = sym.language;
  }

  send(res, 200, {
    repo: repoKey,
    path_prefix: prefix,
    tree: files.map(f => ({
      path: f,
      type: 'file',
      language: fileLang[f] || 'unknown',
      symbol_count: symCount[f] || 0,
    })),
    _meta: { file_count: files.length },
  });
}

function handleFileOutline(req, res, params) {
  const repoKey = params.get('repo');
  const file = params.get('file');
  if (!repoKey || !file) return send(res, 400, { error: 'repo and file params required' });
  const idx = loadIndex(repoKey);
  if (!idx) return send(res, 404, { error: `repo not found: ${repoKey}` });

  const syms = (idx.symbols || []).filter(s => s.file === file);
  send(res, 200, {
    repo: repoKey,
    file,
    symbols: syms.map(symbolSummary),
    _meta: { symbol_count: syms.length },
  });
}

function handleSearch(req, res, params) {
  const repoKey = params.get('repo');
  if (!repoKey) return send(res, 400, { error: 'repo param required' });
  const idx = loadIndex(repoKey);
  if (!idx) return send(res, 404, { error: `repo not found: ${repoKey}` });

  const q = params.get('q') || '';
  const kind = params.get('kind') || null;
  const lang = params.get('lang') || null;
  const filePattern = params.get('file_pattern') || null;
  const limit = Math.min(parseInt(params.get('limit') || '20', 10), 200);

  const matches = (idx.symbols || [])
    .filter(s => symbolMatches(s, q, kind, lang, filePattern))
    .slice(0, limit)
    .map(symbolSummary);

  send(res, 200, { repo: repoKey, query: q, count: matches.length, results: matches });
}

function handleSearchAll(req, res, params) {
  const q = params.get('q') || '';
  const kind = params.get('kind') || null;
  const lang = params.get('lang') || null;
  const limit = Math.min(parseInt(params.get('limit') || '30', 10), 200);

  const keys = listRepoKeys();
  const results = [];
  for (const key of keys) {
    const idx = loadIndex(key);
    if (!idx) continue;
    const matches = (idx.symbols || [])
      .filter(s => symbolMatches(s, q, kind, lang, null))
      .slice(0, limit)
      .map(s => ({ ...symbolSummary(s), repo: key }));
    results.push(...matches);
    if (results.length >= limit) break;
  }

  send(res, 200, {
    query: q,
    repos_searched: keys.length,
    count: results.length,
    results: results.slice(0, limit),
  });
}

function handleSymbol(req, res, params) {
  const repoKey = params.get('repo');
  const id = params.get('id');
  if (!repoKey || !id) return send(res, 400, { error: 'repo and id params required' });
  const idx = loadIndex(repoKey);
  if (!idx) return send(res, 404, { error: `repo not found: ${repoKey}` });

  const sym = (idx.symbols || []).find(s => s.id === id);
  if (!sym) return send(res, 404, { error: `symbol not found: ${id}` });

  // Attempt to read source from file using byte_offset / byte_length
  let source = null;
  const folderMap = loadFolderMap();
  const baseDir = folderMap[repoKey];
  if (baseDir && sym.byte_offset != null && sym.byte_length != null) {
    try {
      const filePath = path.join(baseDir, sym.file);
      const buf = Buffer.alloc(sym.byte_length);
      const fd = fs.openSync(filePath, 'r');
      fs.readSync(fd, buf, 0, sym.byte_length, sym.byte_offset);
      fs.closeSync(fd);
      source = buf.toString('utf8');
    } catch {
      source = null;
    }
  }

  send(res, 200, { repo: repoKey, symbol: { ...sym, source } });
}

function handleSearchText(req, res, params) {
  const repoKey = params.get('repo');
  const q = params.get('q') || '';
  if (!repoKey || !q) return send(res, 400, { error: 'repo and q params required' });
  const idx = loadIndex(repoKey);
  if (!idx) return send(res, 404, { error: `repo not found: ${repoKey}` });

  const limit = Math.min(parseInt(params.get('limit') || '20', 10), 100);
  const ql = q.toLowerCase();

  // Search symbol names + signatures + summaries for text matches
  const matches = (idx.symbols || [])
    .filter(s => {
      const hay = [s.name, s.signature, s.summary, s.docstring, s.file]
        .filter(Boolean).join(' ').toLowerCase();
      return hay.includes(ql);
    })
    .slice(0, limit)
    .map(s => ({
      file: s.file,
      line: s.line,
      name: s.name,
      kind: s.kind,
      match_context: s.signature || s.summary,
    }));

  send(res, 200, { repo: repoKey, query: q, count: matches.length, results: matches });
}

// ── Folder map (repo key → absolute folder path) ──────────────────────────────

const FOLDER_MAP_PATH = path.join(INDEX_DIR, '_folder-map.json');

function loadFolderMap() {
  try {
    return JSON.parse(fs.readFileSync(FOLDER_MAP_PATH, 'utf8'));
  } catch {
    return buildFolderMap();
  }
}

function buildFolderMap() {
  // Auto-derive from known conventions
  const HOME = process.env.HOME;
  const map = {};
  const keys = listRepoKeys();
  for (const key of keys) {
    const name = key.replace('local/', '');
    if (name === 'claw-architect') {
      map[key] = path.join(HOME, 'claw-architect');
    } else {
      const candidate = path.join(HOME, 'claw-repos', name);
      if (fs.existsSync(candidate)) map[key] = candidate;
    }
  }
  try {
    fs.writeFileSync(FOLDER_MAP_PATH, JSON.stringify(map, null, 2));
  } catch {}
  return map;
}

// ── HTTP plumbing ─────────────────────────────────────────────────────────────

function send(res, status, body) {
  const json = JSON.stringify(body);
  const origin = res.__origin;
  const allowOrigin = ALLOW_ANY_ORIGIN ? '*' : (origin && ALLOWED_ORIGINS.includes(origin) ? origin : null);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(json),
    ...(allowOrigin ? { 'Access-Control-Allow-Origin': allowOrigin, Vary: 'Origin' } : {}),
  });
  res.end(json);
}

function remoteAddress(req) {
  const xfwd = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  return (xfwd || req.socket?.remoteAddress || '').replace(/^::ffff:/, '');
}

function isLoopback(req) {
  const addr = remoteAddress(req);
  return addr === '127.0.0.1' || addr === '::1' || addr === 'localhost';
}

function authorized(req) {
  if (!API_KEY) return isLoopback(req);
  const auth = String(req.headers.authorization || '');
  const token = auth.replace(/^Bearer\s+/i, '').trim();
  return token && token === API_KEY;
}

const ROUTES = {
  '/api/health': handleHealth,
  '/api/repos': handleRepos,
  '/api/outline': handleOutline,
  '/api/file-tree': handleFileTree,
  '/api/file-outline': handleFileOutline,
  '/api/search': handleSearch,
  '/api/search-all': handleSearchAll,
  '/api/symbol': handleSymbol,
  '/api/search-text': handleSearchText,
};

const server = http.createServer((req, res) => {
  const requestOrigin = String(req.headers.origin || '').trim();
  res.__origin = requestOrigin;
  const allowOrigin = ALLOW_ANY_ORIGIN ? '*' : (requestOrigin && ALLOWED_ORIGINS.includes(requestOrigin) ? requestOrigin : null);

  if (req.method === 'OPTIONS') {
    const headers = {
      ...(allowOrigin ? { 'Access-Control-Allow-Origin': allowOrigin, Vary: 'Origin' } : {}),
      'Access-Control-Allow-Methods': 'GET,OPTIONS',
      'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    };
    res.writeHead(204, headers);
    return res.end();
  }
  if (!authorized(req)) {
    return send(res, 401, { error: API_KEY ? 'unauthorized' : 'loopback_only' });
  }
  const parsed = url.parse(req.url, true);
  const params = new URLSearchParams(parsed.search || '');
  const handler = ROUTES[parsed.pathname];
  if (handler) {
    try {
      handler(req, res, params);
    } catch (err) {
      send(res, 500, { error: err.message });
    }
  } else {
    send(res, 404, {
      error: 'Not found',
      available_routes: Object.keys(ROUTES),
    });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`[jcodemunch-api] listening on http://${HOST}:${PORT}`);
  console.log(`[jcodemunch-api] index dir: ${INDEX_DIR}`);
  if (!API_KEY) {
    console.warn('[jcodemunch-api] JCODEMUNCH_API_KEY not set; loopback-only mode enabled.');
  }
  // Eagerly build folder map on startup
  const map = buildFolderMap();
  console.log(`[jcodemunch-api] folder map: ${Object.keys(map).length} repos resolved`);
});

server.on('error', err => {
  console.error('[jcodemunch-api] server error:', err.message);
  process.exit(1);
});
