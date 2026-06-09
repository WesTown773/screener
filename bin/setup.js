#!/usr/bin/env node
'use strict';

/**
 * One-time setup (requires internet for the first run):
 *   node bin/setup.js
 *
 * Downloads:
 *   1. data/companyfacts.zip   — the full EDGAR bulk archive (~1.4 GB)
 *   2. data/tickers.json       — ticker→CIK index for offline symbol lookup
 *
 * Re-run with --force to refresh either file.
 * After setup, the application runs entirely offline.
 */

const fs = require('fs');
const https = require('https');
const path = require('path');
const { downloadZip, BULK_URL } = require('../src/ingest');

const USER_AGENT = process.env.SEC_USER_AGENT || 'fundamental-screener contact@example.com';
const TICKERS_URL = 'https://www.sec.gov/files/company_tickers.json';
const TICKERS_PATH = path.join('data', 'tickers.json');
const ZIP_PATH = path.join('data', 'companyfacts.zip');

const force = process.argv.includes('--force');

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': USER_AGENT } }, (res) => {
      if (res.statusCode !== 200) { reject(new Error(`HTTP ${res.statusCode}`)); res.resume(); return; }
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString())); } catch (e) { reject(e); } });
    }).on('error', reject);
  });
}

async function downloadTickers() {
  if (!force && fs.existsSync(TICKERS_PATH)) {
    console.error(`Tickers index already cached at ${TICKERS_PATH}`);
    return;
  }
  console.error('Downloading tickers index from SEC…');
  const raw = await fetchJson(TICKERS_URL);
  // Transform { "0": { cik_str, ticker, title }, ... } → { TICKER: "0000XXXXXX", ... }
  const index = {};
  for (const entry of Object.values(raw)) {
    if (entry.ticker) {
      index[entry.ticker.toUpperCase()] = String(entry.cik_str).padStart(10, '0');
    }
  }
  fs.mkdirSync('data', { recursive: true });
  fs.writeFileSync(TICKERS_PATH, JSON.stringify(index));
  console.error(`Saved ${Object.keys(index).length} tickers → ${TICKERS_PATH}`);
}

async function main() {
  console.error('=== Fundamental Screener — One-Time Setup ===\n');

  // 1. Tickers index (small, fast)
  await downloadTickers();

  // 2. Bulk zip (large, one-time)
  if (!force && fs.existsSync(ZIP_PATH)) {
    console.error(`\nZip already cached at ${ZIP_PATH} (${(fs.statSync(ZIP_PATH).size / 1e9).toFixed(2)} GB)`);
  } else {
    console.error('\nDownloading companyfacts.zip (~1.4 GB) — this takes a few minutes…');
    let lastLog = 0;
    const { dest } = await downloadZip({
      dest: ZIP_PATH,
      force,
      onProgress(bytes) {
        const now = Date.now();
        if (now - lastLog > 5000) {
          process.stderr.write(`  ${(bytes / 1e6).toFixed(0)} MB downloaded…\n`);
          lastLog = now;
        }
      },
    });
    console.error(`\nSaved → ${dest}`);
  }

  console.error('\n✓ Setup complete. The application will now run offline.');
  console.error('  Start the dashboard: node bin/serve.js');
}

main().catch((err) => { console.error('Setup failed:', err.message); process.exit(1); });
