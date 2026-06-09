'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { buildZip } = require('./makeTestZip');
const { ingest, processEntry } = require('../src/ingest');

// ── Fixtures ───────────────────────────────────────────────────────────────

const AAPL = require('./fixtures/AAPL.json');
const KO = require('./fixtures/KO.json');
const JPM = require('./fixtures/JPM.json');

// A company with very little history (2 years) — should get insufficient_history
const SPARSE = {
  entityName: 'Sparse Corp',
  cik: 9999999,
  facts: {
    'us-gaap': {
      NetIncomeLoss: {
        units: {
          USD: [
            { form: '10-K', fp: 'FY', end: '2023-12-31', val: 1e8, filed: '2024-02-01' },
            { form: '10-K', fp: 'FY', end: '2024-12-31', val: 1.1e8, filed: '2025-02-01' },
          ],
        },
      },
    },
  },
};

// A completely empty filer (no us-gaap)
const EMPTY_FILER = {
  entityName: 'Shell Co',
  cik: 8888888,
  facts: {},
};

// A filer that is not a company (e.g. investment trust with no revenue)
const NO_GAAP = {
  entityName: 'Weird Trust',
  cik: 7777777,
};

function makeZip(companies) {
  const entries = companies.map((c) => ({
    name: `CIK${String(c.cik).padStart(10, '0')}.json`,
    data: JSON.stringify(c),
  }));
  // Add a non-CIK file that should be skipped
  entries.push({ name: 'readme.txt', data: 'ignore me' });
  return buildZip(entries);
}

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'screener-test-'));
}

// ── processEntry unit tests ────────────────────────────────────────────────

describe('processEntry', () => {
  test('produces a compact record for AAPL', () => {
    const buf = Buffer.from(JSON.stringify(AAPL));
    const rec = processEntry(buf, 'CIK0000320193.json');
    expect(rec.name).toBe('Apple Inc.');
    expect(rec.criteria).toHaveLength(10);
    expect(rec.summary.total).toBe(10);
    expect(rec.fiscal_years).toHaveLength(2); // [first, last]
  });

  test('handles invalid JSON without throwing', () => {
    const rec = processEntry(Buffer.from('{not valid json'), 'bad.json');
    expect(rec.data_quality).toContain('parse_error');
  });

  test('handles missing us-gaap facts', () => {
    const rec = processEntry(Buffer.from(JSON.stringify(EMPTY_FILER)), 'CIK0008888888.json');
    expect(rec.data_quality).toContain('no_us_gaap_facts');
    expect(rec.name).toBe('Shell Co');
  });

  test('handles missing facts key entirely', () => {
    const rec = processEntry(Buffer.from(JSON.stringify(NO_GAAP)), 'CIK0007777777.json');
    expect(rec.data_quality).toContain('no_us_gaap_facts');
  });

  test('marks sparse companies with insufficient_history', () => {
    const rec = processEntry(Buffer.from(JSON.stringify(SPARSE)), 'CIK0009999999.json');
    expect(rec.data_quality).toContain('insufficient_history');
  });

  test('JPM record has gross_margin not_applicable', () => {
    const rec = processEntry(Buffer.from(JSON.stringify(JPM)), 'CIK0000019617.json');
    const gm = rec.criteria.find((c) => c.id === 5);
    expect(gm.pass).toBeNull();
    expect(gm.not_applicable).toBe(true);
  });

  test('data_quality is null for a clean well-known company', () => {
    // KO has good data
    const rec = processEntry(Buffer.from(JSON.stringify(KO)), 'CIK0000021344.json');
    expect(rec.data_quality).toBeNull();
  });
});

// ── ingest integration tests ───────────────────────────────────────────────

describe('ingest — local zip', () => {
  let outDir;
  let zipPath;

  beforeAll(() => {
    outDir = tempDir();
    zipPath = path.join(outDir, 'test.zip');
    const zipBuf = makeZip([AAPL, KO, JPM, SPARSE, EMPTY_FILER]);
    fs.writeFileSync(zipPath, zipBuf);
  });

  afterAll(() => {
    fs.rmSync(outDir, { recursive: true, force: true });
  });

  test('runs without throwing', async () => {
    await expect(ingest({ source: zipPath, outDir, passThreshold: 7 })).resolves.toBeDefined();
  });

  test('writes results.json and passers.json', async () => {
    await ingest({ source: zipPath, outDir, passThreshold: 7 });
    expect(fs.existsSync(path.join(outDir, 'results.json'))).toBe(true);
    expect(fs.existsSync(path.join(outDir, 'passers.json'))).toBe(true);
  });

  test('results.json contains all scoreable companies', async () => {
    const { processed } = await ingest({ source: zipPath, outDir, passThreshold: 10 });
    // All 5 companies processed; the readme.txt entry is skipped
    expect(processed).toBe(5);

    const results = JSON.parse(fs.readFileSync(path.join(outDir, 'results.json'), 'utf8'));
    expect(results.companies).toHaveLength(5);
    expect(results.pass_threshold).toBe(10);
    expect(results.generated_at).toMatch(/^\d{4}/);
  });

  test('results are sorted passers-first by pass_count descending', async () => {
    await ingest({ source: zipPath, outDir, passThreshold: 10 });
    const results = JSON.parse(fs.readFileSync(path.join(outDir, 'results.json'), 'utf8'));
    const counts = results.companies
      .map((c) => c.summary?.pass_count ?? -1);
    for (let i = 1; i < counts.length; i++) {
      expect(counts[i]).toBeLessThanOrEqual(counts[i - 1]);
    }
  });

  test('passers.json only contains companies at or above threshold', async () => {
    await ingest({ source: zipPath, outDir, passThreshold: 7 });
    const passers = JSON.parse(fs.readFileSync(path.join(outDir, 'passers.json'), 'utf8'));
    for (const c of passers.companies) {
      expect(c.summary.pass_count).toBeGreaterThanOrEqual(7);
    }
  });

  test('progress callback is called for each entry', async () => {
    const calls = [];
    await ingest({ source: zipPath, outDir, onProgress: (p) => calls.push(p) });
    expect(calls.length).toBe(5);
    expect(calls[calls.length - 1].processed).toBe(5);
  });

  test('limit option stops early', async () => {
    const { processed } = await ingest({ source: zipPath, outDir, limit: 2 });
    expect(processed).toBe(2);
  });

  test('errors counter increments for parse failures', async () => {
    // Add a broken entry
    const entries = [
      { name: 'CIK0000320193.json', data: JSON.stringify(AAPL) },
      { name: 'CIK9999999999.json', data: '{broken json' },
    ];
    const brokenZip = buildZip(entries);
    const brokenZipPath = path.join(outDir, 'broken.zip');
    fs.writeFileSync(brokenZipPath, brokenZip);

    const { processed, errors } = await ingest({ source: brokenZipPath, outDir });
    expect(processed).toBe(2);
    expect(errors).toBe(1);
  });

  test('results.json is valid JSON after a run with errors', async () => {
    const entries = [
      { name: 'CIK0000320193.json', data: JSON.stringify(AAPL) },
      { name: 'CIK9999999999.json', data: 'not json at all' },
    ];
    const z = buildZip(entries);
    fs.writeFileSync(path.join(outDir, 'broken2.zip'), z);
    await ingest({ source: path.join(outDir, 'broken2.zip'), outDir });
    expect(() =>
      JSON.parse(fs.readFileSync(path.join(outDir, 'results.json'), 'utf8')),
    ).not.toThrow();
  });
});
