'use strict';

const https = require('https');
const fs = require('fs');

const EDGAR_BASE = 'https://data.sec.gov';
const USER_AGENT = process.env.SEC_USER_AGENT || 'fundamental-screener contact@example.com';

/**
 * Fetch JSON from a URL with the required SEC User-Agent header.
 */
function fetchJson(url) {
  return new Promise((resolve, reject) => {
    const options = { headers: { 'User-Agent': USER_AGENT, 'Accept-Encoding': 'identity' } };
    https.get(url, options, (res) => {
      if (res.statusCode !== 200) {
        reject(new Error(`HTTP ${res.statusCode} for ${url}`));
        res.resume();
        return;
      }
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        try { resolve(JSON.parse(Buffer.concat(chunks).toString())); }
        catch (e) { reject(e); }
      });
    }).on('error', reject);
  });
}

/**
 * Return the company facts JSON for a given zero-padded 10-digit CIK string.
 * Loads from a local file path if `source` is provided, otherwise fetches live.
 *
 * @param {string} cik   Zero-padded 10-digit CIK, e.g. "0000320193"
 * @param {string} [source]  Optional path to a local CIK JSON file.
 */
async function fetchCompanyFacts(cik, source) {
  if (source) {
    const raw = fs.readFileSync(source, 'utf8');
    return JSON.parse(raw);
  }
  const url = `${EDGAR_BASE}/api/xbrl/companyfacts/CIK${cik}.json`;
  return fetchJson(url);
}

/**
 * Resolve a ticker symbol to a CIK using EDGAR's company_tickers.json.
 * Returns a zero-padded 10-digit string.
 */
async function tickerToCik(ticker) {
  const url = 'https://www.sec.gov/files/company_tickers.json';
  const index = await fetchJson(url);
  const upper = ticker.toUpperCase();
  for (const entry of Object.values(index)) {
    if (entry.ticker === upper) {
      return String(entry.cik_str).padStart(10, '0');
    }
  }
  throw new Error(`Ticker not found: ${ticker}`);
}

/**
 * Normalise user input to a zero-padded CIK string.
 * Accepts a numeric CIK (with or without leading zeros) or a ticker symbol.
 */
async function resolveCik(input) {
  if (/^\d+$/.test(input)) {
    return input.padStart(10, '0');
  }
  return tickerToCik(input);
}

module.exports = { fetchCompanyFacts, tickerToCik, resolveCik };
