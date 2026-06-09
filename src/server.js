'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const unzipper = require('unzipper');
const { computeMetrics } = require('./computeMetrics');
const { buildScorecard } = require('./scorecard');
const { ingest, processEntry, compactRecord, dataQuality: _dq, DEFAULT_ZIP_PATH } = require('./ingest');

const TICKERS_PATH = path.join('data', 'tickers.json');
const ZIP_PATH = DEFAULT_ZIP_PATH;
const RESULTS_PATH = path.join('data', 'results.json');
const DASHBOARD_PATH = path.join(__dirname, '..', 'public', 'index.html');

// ── Ticker lookup ──────────────────────────────────────────────────────────

let tickerCache = null;
function loadTickers() {
  if (tickerCache) return tickerCache;
  if (!fs.existsSync(TICKERS_PATH)) return null;
  tickerCache = JSON.parse(fs.readFileSync(TICKERS_PATH, 'utf8'));
  return tickerCache;
}

function resolveCik(symbol) {
  const tickers = loadTickers();
  if (!tickers) throw new Error('Ticker index not found. Run: node bin/setup.js');
  const cik = tickers[symbol.toUpperCase()];
  if (!cik) throw new Error(`Unknown ticker: ${symbol.toUpperCase()}`);
  return cik;
}

// ── Extract one CIK file from the zip ─────────────────────────────────────

async function extractFromZip(cik) {
  if (!fs.existsSync(ZIP_PATH)) {
    throw new Error('companyfacts.zip not found. Run: node bin/setup.js');
  }
  const filename = `CIK${String(cik).padStart(10, '0')}.json`;
  const directory = await unzipper.Open.file(ZIP_PATH);
  const file = directory.files.find((f) => f.path === filename);
  if (!file) throw new Error(`No EDGAR data found for CIK ${cik} (${filename} not in zip)`);
  return file.buffer();
}

// ── Request routing ────────────────────────────────────────────────────────

function send(res, status, body, type = 'application/json') {
  const data = typeof body === 'string' ? body : JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': type, 'Access-Control-Allow-Origin': '*' });
  res.end(data);
}

async function handleRequest(req, res) {
  const url = new URL(req.url, `http://localhost`);
  const pathname = url.pathname;

  // ── Static dashboard ───────────────────────────────────────────────────
  if (pathname === '/' || pathname === '/index.html') {
    if (!fs.existsSync(DASHBOARD_PATH)) {
      return send(res, 404, { error: 'Dashboard not found' });
    }
    res.writeHead(200, { 'Content-Type': 'text/html' });
    fs.createReadStream(DASHBOARD_PATH).pipe(res);
    return;
  }

  // ── Status ────────────────────────────────────────────────────────────
  if (pathname === '/api/status') {
    return send(res, 200, {
      zip_ready:     fs.existsSync(ZIP_PATH),
      tickers_ready: fs.existsSync(TICKERS_PATH),
      results_ready: fs.existsSync(RESULTS_PATH),
      results_age_hours: fs.existsSync(RESULTS_PATH)
        ? ((Date.now() - fs.statSync(RESULTS_PATH).mtimeMs) / 3600000).toFixed(1)
        : null,
    });
  }

  // ── Pre-computed results ───────────────────────────────────────────────
  if (pathname === '/api/results') {
    if (!fs.existsSync(RESULTS_PATH)) return send(res, 404, { error: 'No results yet. Run a scan first.' });
    res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
    fs.createReadStream(RESULTS_PATH).pipe(res);
    return;
  }

  // ── Single symbol scan ─────────────────────────────────────────────────
  if (pathname === '/api/scan') {
    const symbol = url.searchParams.get('symbol')?.trim();
    if (!symbol) return send(res, 400, { error: 'symbol parameter required' });
    try {
      const cik = /^\d+$/.test(symbol) ? String(symbol).padStart(10, '0') : resolveCik(symbol);
      const buffer = await extractFromZip(cik);
      const record = processEntry(buffer, `CIK${cik}.json`);
      // Also return full scorecard detail for the single-company view
      let fullScorecard = null;
      try {
        const data = JSON.parse(buffer.toString('utf8'));
        const result = computeMetrics(data.facts['us-gaap']);
        fullScorecard = buildScorecard(result, { entityName: data.entityName, cik: data.cik });
        fullScorecard.trend_5y = record.trend_5y;
      } catch { /* use compact record only */ }
      return send(res, 200, { record, scorecard: fullScorecard });
    } catch (err) {
      return send(res, 404, { error: err.message });
    }
  }

  // ── Full universe scan (SSE stream) ───────────────────────────────────
  if (pathname === '/api/scan-all') {
    if (!fs.existsSync(ZIP_PATH)) {
      return send(res, 503, { error: 'companyfacts.zip not found. Run: node bin/setup.js' });
    }
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*',
    });

    const threshold = parseInt(url.searchParams.get('threshold') ?? '8', 10);
    let processed = 0; let passed = 0; let errors = 0;

    const emit = (type, data) => {
      res.write(`data: ${JSON.stringify({ type, ...data })}\n\n`);
    };

    try {
      await ingest({
        zipPath: ZIP_PATH,
        outDir: 'data',
        passThreshold: threshold,
        onProgress({ processed: p, passed: pa, errors: e, name }) {
          processed = p; passed = pa; errors = e;
          if (p % 100 === 0) emit('progress', { processed: p, passed: pa, errors: e, name });
        },
      });
      emit('complete', { processed, passed, errors });
    } catch (err) {
      emit('error', { message: err.message });
    }
    res.end();
    return;
  }

  send(res, 404, { error: 'Not found' });
}

function createServer(port = 3000) {
  const server = http.createServer((req, res) => {
    handleRequest(req, res).catch((err) => {
      console.error('Unhandled error:', err.message);
      send(res, 500, { error: 'Internal server error' });
    });
  });
  return new Promise((resolve) => {
    server.listen(port, '0.0.0.0', () => resolve(server));
  });
}

module.exports = { createServer };
