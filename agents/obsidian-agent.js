// agents/obsidian-agent.js
// ─────────────────────────────────────────────────────────────────────────────
// Obsidian Direct — connects to the Obsidian Local REST API plugin
// (github.com/coddingtonbear/obsidian-local-rest-api)
//
// Prerequisites (one-time setup on Mac):
//   1. In Obsidian: Settings → Community Plugins → Browse → "Local REST API"
//      Install & enable it.
//   2. Copy the API key from the plugin settings into .env:
//        OBSIDIAN_API_KEY=your-key-here
//   3. (Optional) OBSIDIAN_PORT=27123  (default)
//        OBSIDIAN_HOST=127.0.0.1       (default; use host IP for remote vault)
//
// Registered task types:
//   OBSIDIAN_LIST_FILES   — list all notes in the vault (or a folder)
//   OBSIDIAN_READ_NOTE    — read a note's markdown content
//   OBSIDIAN_WRITE_NOTE   — create or overwrite a note
//   OBSIDIAN_APPEND_NOTE  — append text to an existing note
//   OBSIDIAN_SEARCH       — full-text search across the vault
//   OBSIDIAN_DELETE_NOTE  — delete a note
//
// CLI usage:
//   node agents/obsidian-agent.js --cmd list
//   node agents/obsidian-agent.js --cmd read  --path "Daily/2026-02-26.md"
//   node agents/obsidian-agent.js --cmd write --path "Test/hello.md" --content "# Hello"
//   node agents/obsidian-agent.js --cmd search --query "SkynPatch"
// ─────────────────────────────────────────────────────────────────────────────

'use strict';

require('dotenv').config();
const https = require('https');
const http  = require('http');
const { register } = require('./registry');

// ── Config from env ───────────────────────────────────────────────────────────
const OBSIDIAN_HOST = process.env.OBSIDIAN_HOST || '127.0.0.1';
const OBSIDIAN_PORT = parseInt(process.env.OBSIDIAN_PORT || '27123', 10);
const OBSIDIAN_KEY  = process.env.OBSIDIAN_API_KEY || '';
const USE_HTTPS     = process.env.OBSIDIAN_HTTPS === 'true';  // plugin uses http by default

// ── HTTP helper ───────────────────────────────────────────────────────────────
function obsidianRequest(method, path, body = null) {
  return new Promise((resolve, reject) => {
    const lib = USE_HTTPS ? https : http;
    const bodyStr = body !== null ? (typeof body === 'string' ? body : JSON.stringify(body)) : null;
    const isJson  = body !== null && typeof body !== 'string';

    const opts = {
      hostname: OBSIDIAN_HOST,
      port:     OBSIDIAN_PORT,
      path:     path,
      method:   method,
      headers: {
        'Authorization': `Bearer ${OBSIDIAN_KEY}`,
        'Content-Type': isJson ? 'application/json' : 'text/markdown',
        ...(bodyStr ? { 'Content-Length': Buffer.byteLength(bodyStr) } : {}),
      },
      // Plugin uses self-signed cert on https — skip verification
      rejectUnauthorized: false,
    };

    const req = lib.request(opts, (res) => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const raw = Buffer.concat(chunks).toString();
        if (res.statusCode >= 200 && res.statusCode < 300) {
          try { resolve(JSON.parse(raw)); } catch { resolve(raw); }
        } else if (res.statusCode === 404) {
          resolve(null); // note not found
        } else {
          reject(new Error(`Obsidian API ${res.statusCode}: ${raw.slice(0, 200)}`));
        }
      });
    });

    req.on('error', reject);
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

// ── Health check ──────────────────────────────────────────────────────────────
async function ping() {
  try {
    const res = await obsidianRequest('GET', '/');
    return { ok: true, version: res?.versions?.obsidian ?? 'unknown' };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

// ── OBSIDIAN_LIST_FILES ───────────────────────────────────────────────────────
async function listFiles({ folder = '' } = {}) {
  const encodedFolder = folder ? encodeURIComponent(folder) : '';
  const path = `/vault/${encodedFolder}`;
  const res = await obsidianRequest('GET', path);
  if (!res) return { files: [], folder };

  const files = (res.files || []).map(f => ({
    path: f,
    name: f.split('/').pop(),
    folder: f.includes('/') ? f.split('/').slice(0, -1).join('/') : '',
  }));

  return { files, folder, count: files.length };
}

// ── OBSIDIAN_READ_NOTE ────────────────────────────────────────────────────────
async function readNote({ path: notePath }) {
  if (!notePath) throw new Error('path is required');
  const encoded = notePath.split('/').map(encodeURIComponent).join('/');
  const res = await obsidianRequest('GET', `/vault/${encoded}`);
  if (res === null) return { ok: false, error: 'Note not found', path: notePath };
  const content = typeof res === 'string' ? res : JSON.stringify(res);
  return { ok: true, path: notePath, content, length: content.length };
}

// ── OBSIDIAN_WRITE_NOTE ───────────────────────────────────────────────────────
async function writeNote({ path: notePath, content, overwrite = true }) {
  if (!notePath) throw new Error('path is required');
  if (content === undefined) throw new Error('content is required');

  if (!overwrite) {
    // Check if file exists first
    const existing = await readNote({ path: notePath });
    if (existing.ok) return { ok: false, error: 'Note already exists. Use overwrite=true.' };
  }

  const encoded = notePath.split('/').map(encodeURIComponent).join('/');
  await obsidianRequest('PUT', `/vault/${encoded}`, content);
  return { ok: true, path: notePath, action: 'written', bytes: content.length };
}

// ── OBSIDIAN_APPEND_NOTE ──────────────────────────────────────────────────────
async function appendNote({ path: notePath, content, separator = '\n\n' }) {
  if (!notePath) throw new Error('path is required');
  if (!content)  throw new Error('content is required');

  const existing = await readNote({ path: notePath });
  if (!existing.ok) {
    // Note doesn't exist — create it
    return writeNote({ path: notePath, content });
  }

  const newContent = existing.content + separator + content;
  return writeNote({ path: notePath, content: newContent, overwrite: true });
}

// ── OBSIDIAN_SEARCH ───────────────────────────────────────────────────────────
async function searchNotes({ query, context_length = 100 }) {
  if (!query) throw new Error('query is required');
  const res = await obsidianRequest('POST', '/search/simple/', { query, contextLength: context_length });

  if (!Array.isArray(res)) return { query, results: [], count: 0 };

  const results = res.map(r => ({
    path:     r.filename,
    score:    r.score,
    excerpts: (r.matches || []).map(m => m.context?.trim()),
  }));

  return { query, results, count: results.length };
}

// ── OBSIDIAN_DELETE_NOTE ──────────────────────────────────────────────────────
async function deleteNote({ path: notePath }) {
  if (!notePath) throw new Error('path is required');
  const encoded = notePath.split('/').map(encodeURIComponent).join('/');
  await obsidianRequest('DELETE', `/vault/${encoded}`);
  return { ok: true, path: notePath, action: 'deleted' };
}

// ── Register task handlers ────────────────────────────────────────────────────
register('OBSIDIAN_LIST_FILES',  listFiles);
register('OBSIDIAN_READ_NOTE',   readNote);
register('OBSIDIAN_WRITE_NOTE',  writeNote);
register('OBSIDIAN_APPEND_NOTE', appendNote);
register('OBSIDIAN_SEARCH',      searchNotes);
register('OBSIDIAN_DELETE_NOTE', deleteNote);

// ── CLI mode ──────────────────────────────────────────────────────────────────
if (require.main === module) {
  const args = process.argv.slice(2);
  const getArg = (f) => { const i = args.indexOf(f); return i !== -1 ? args[i+1] : null; };

  const cmd     = getArg('--cmd')     || 'ping';
  const path    = getArg('--path')    || '';
  const query   = getArg('--query')   || '';
  const content = getArg('--content') || '';
  const folder  = getArg('--folder')  || '';

  (async () => {
    if (!OBSIDIAN_KEY) {
      console.error('⚠️  OBSIDIAN_API_KEY not set in .env');
      console.error('   Install the "Local REST API" plugin in Obsidian,');
      console.error('   copy the API key, and add it to .env');
      process.exit(1);
    }

    console.log(`\n📓 Obsidian Agent — cmd: ${cmd}\n`);

    try {
      let result;
      switch (cmd) {
        case 'ping':   result = await ping(); break;
        case 'list':   result = await listFiles({ folder }); break;
        case 'read':   result = await readNote({ path }); break;
        case 'write':  result = await writeNote({ path, content }); break;
        case 'append': result = await appendNote({ path, content }); break;
        case 'search': result = await searchNotes({ query }); break;
        case 'delete': result = await deleteNote({ path }); break;
        default: throw new Error(`Unknown cmd: ${cmd}`);
      }
      console.log(JSON.stringify(result, null, 2));
    } catch (err) {
      console.error('Error:', err.message);
      process.exitCode = 1;
    }
  })();
}

module.exports = { ping, listFiles, readNote, writeNote, appendNote, searchNotes, deleteNote };
