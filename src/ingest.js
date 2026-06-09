'use strict';

const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');
const unzipper = require('unzipper');
const { computeMetrics } = require('./computeMetrics');
const { buildScorecard } = require('./scorecard');

const BULK_URL = 'https://www.sec.gov/Archives/edgar/daily-index/xbrl/companyfacts.zip';
const USER_AGENT = process.env.SEC_USER_AGENT || 'fundamental-screener contact@example.com';
const PASS_THRESHOLD = parseInt(process.env.PASS_THRESHOLD ?? '10', 10);
const DEFAULT_ZIP_PATH = path.join('data', 'companyfacts.zip');

// Companies with fewer than this many fiscal years are flagged but still emitted.
const MIN_YEARS_TO_SCORE = 3;

// ── HTTP helpers ───────────────────────────────────────────────────────────

function openStream(url) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('https') ? https : http;
    const req = mod.get(url, { headers: { 'User-Agent': USER_AGENT } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        resolve(openStream(res.headers.location));
        return;
      }
      if (res.statusCode !== 200) {
        reject(new Error(`HTTP ${res.statusCode} for ${url}`));
        return;
      }
      resolve(res);
    });
    req.on('error', reject);
  });
}

// ── Download ───────────────────────────────────────────────────────────────

/**
 * Download companyfacts.zip to a local file exactly once.
 * Does nothing if the file already exists (pass force=true to overwrite).
 *
 * @param {object} [opts]
 * @param {string}   [opts.dest=DEFAULT_ZIP_PATH]  Where to save the zip.
 * @param {boolean}  [opts.force=false]             Re-download even if file exists.
 * @param {Function} [opts.onProgress]              Called with bytes downloaded so far.
 * @returns {Promise<{ dest, downloaded }>}
 *   downloaded=false means the file already existed and was reused.
 */
async function downloadZip(opts = {}) {
  const { dest = DEFAULT_ZIP_PATH, force = false, onProgress } = opts;
  fs.mkdirSync(path.dirname(dest), { recursive: true });

  if (!force && fs.existsSync(dest)) {
    return { dest, downloaded: false };
  }

  const res = await openStream(BULK_URL);
  const tmp = dest + '.tmp';
  const out = fs.createWriteStream(tmp);
  let bytes = 0;

  await new Promise((resolve, reject) => {
    res.on('data', (chunk) => {
      bytes += chunk.length;
      if (onProgress) onProgress(bytes);
    });
    res.pipe(out);
    out.on('finish', resolve);
    out.on('error', reject);
    res.on('error', reject);
  });

  fs.renameSync(tmp, dest);
  return { dest, downloaded: true };
}

// ── Per-company processing ─────────────────────────────────────────────────

function dataQuality(result) {
  const flags = [];
  if (result.fiscal_years.length < MIN_YEARS_TO_SCORE) {
    flags.push('insufficient_history');
  } else if (result.fiscal_years.length < 10) {
    flags.push('partial_history');
  }
  if (result.summary.null_count === result.summary.total) {
    flags.push('no_financial_data');
  }
  return flags.length ? flags : null;
}

function compactRecord(scorecard, qualityFlags, metricsResult) {
  const fys = metricsResult.fiscal_years;
  const last5 = fys.slice(-5);
  const m = metricsResult.metrics;

  function pick5(byYear, valueKey = 'value') {
    if (!byYear) return null;
    return last5.map((fy) => {
      const entry = byYear.find((r) => r.fy === fy);
      return entry ? (entry[valueKey] ?? null) : null;
    });
  }

  return {
    cik: scorecard.company.cik,
    name: scorecard.company.name,
    fiscal_years: [fys[0], fys[fys.length - 1]],
    fy_count: fys.length,
    criteria: scorecard.criteria.map((c) => ({
      id: c.id,
      pass: c.pass,
      value: c.value,
      unit: c.unit,
      not_applicable: c.not_applicable ?? undefined,
    })),
    summary: scorecard.summary,
    trend_5y: {
      years: last5,
      roe:       pick5(m.roe.by_year),
      roa:       pick5(m.roa.by_year),
      eps:       pick5(m.eps_trend.by_year),
      ni_margin: pick5(m.net_income_margin.by_year),
      gp_margin: pick5(m.gross_margin.by_year),
      ltd_ni:    pick5(m.ltd_to_ni.by_year),
      revenue:   pick5(m.revenue_vs_inflation.by_year),
      dps:       pick5(m.dividend_history.by_year, 'dps'),
      buybacks:  pick5(m.share_buybacks.by_year),
    },
    data_quality: qualityFlags,
  };
}

/**
 * Process one CIK JSON buffer. Never throws — returns an error record on failure.
 *
 * @param {Buffer} buffer
 * @param {string} filename  Entry path from the zip (used as fallback CIK label).
 * @param {object} [opts]    Passed through to computeMetrics (e.g. maxFiscalYear).
 */
function processEntry(buffer, filename, opts = {}) {
  let data;
  try {
    data = JSON.parse(buffer.toString('utf8'));
  } catch {
    return { cik: filename, name: null, error: 'parse_error', data_quality: ['parse_error'] };
  }

  const facts = data?.facts?.['us-gaap'];
  if (!facts) {
    return {
      cik: data.cik ?? filename,
      name: data.entityName ?? null,
      data_quality: ['no_us_gaap_facts'],
      summary: { pass_count: 0, null_count: 10, total: 10 },
    };
  }

  let result;
  try {
    result = computeMetrics(facts, opts);
  } catch (e) {
    return {
      cik: data.cik ?? filename,
      name: data.entityName ?? null,
      error: e.message,
      data_quality: ['computation_error'],
      summary: { pass_count: 0, null_count: 10, total: 10 },
    };
  }

  if (result.fiscal_years.length < MIN_YEARS_TO_SCORE) {
    return {
      cik: data.cik ?? filename,
      name: data.entityName ?? null,
      fy_count: result.fiscal_years.length,
      data_quality: ['insufficient_history'],
      summary: result.summary,
    };
  }

  const scorecard = buildScorecard(result, {
    entityName: data.entityName ?? 'Unknown',
    cik: data.cik,
  });

  return compactRecord(scorecard, dataQuality(result), result);
}

// ── Main ingest ────────────────────────────────────────────────────────────

/**
 * Stream a local companyfacts.zip, compute metrics for every filer, and write
 * results.json + passers.json.  The zip must already exist locally — call
 * downloadZip() first if needed.
 *
 * @param {object} opts
 * @param {string}   [opts.zipPath=DEFAULT_ZIP_PATH]  Local path to companyfacts.zip.
 * @param {string}   [opts.outDir='data']             Output directory.
 * @param {number}   [opts.passThreshold]             Min pass count to appear in passers.json.
 * @param {number}   [opts.maxFiscalYear=2025]        Exclude FY end dates after this year.
 * @param {Function} [opts.onProgress]                Called with stats per entry.
 * @param {number}   [opts.limit]                     Stop after N companies (smoke-test).
 * @returns {Promise<{ processed, passed, errors }>}
 */
async function ingest(opts = {}) {
  const {
    zipPath = DEFAULT_ZIP_PATH,
    outDir = 'data',
    passThreshold = PASS_THRESHOLD,
    maxFiscalYear = 2025,
    onProgress,
    limit = Infinity,
    // Legacy: accept `source` as an alias for zipPath so old tests still work
    source,
  } = opts;

  const resolvedZip = source ?? zipPath;
  fs.mkdirSync(outDir, { recursive: true });

  const zipStream = fs.createReadStream(resolvedZip).pipe(unzipper.Parse({ forceStream: true }));

  const results = [];
  const passers = [];
  let processed = 0;
  let passed = 0;
  let errors = 0;

  for await (const entry of zipStream) {
    const filename = entry.path;

    if (!filename.match(/CIK\d+\.json$/i)) {
      entry.autodrain();
      continue;
    }

    if (processed >= limit) {
      entry.autodrain();
      continue;
    }

    const chunks = [];
    for await (const chunk of entry) chunks.push(chunk);
    const buffer = Buffer.concat(chunks);

    const record = processEntry(buffer, filename, { maxFiscalYear });

    if (record.error || record.data_quality?.includes('computation_error') || record.data_quality?.includes('parse_error')) {
      errors++;
    }

    results.push(record);
    processed++;

    if (record.summary?.pass_count >= passThreshold) {
      passed++;
      passers.push(record);
    }

    if (onProgress) onProgress({ processed, passed, errors, name: record.name ?? filename });
  }

  results.sort((a, b) => {
    const pa = a.summary?.pass_count ?? -1;
    const pb = b.summary?.pass_count ?? -1;
    if (pb !== pa) return pb - pa;
    return (a.name ?? '').localeCompare(b.name ?? '');
  });

  const meta = {
    generated_at: new Date().toISOString(),
    pass_threshold: passThreshold,
    max_fiscal_year: maxFiscalYear,
  };

  fs.writeFileSync(
    path.join(outDir, 'results.json'),
    JSON.stringify({ ...meta, companies: results }, null, 2),
  );
  fs.writeFileSync(
    path.join(outDir, 'passers.json'),
    JSON.stringify({ ...meta, companies: passers }, null, 2),
  );

  return { processed, passed, errors };
}

module.exports = { ingest, processEntry, compactRecord, downloadZip, BULK_URL, DEFAULT_ZIP_PATH };
