'use strict';

const path = require('path');
const { fetchCompanyFacts, resolveCik } = require('../src/fetchCompany');

// ── Local file loading ────────────────────────────────────────────────────

describe('fetchCompanyFacts — local file', () => {
  test('loads AAPL fixture from disk', async () => {
    const filePath = path.join(__dirname, 'fixtures', 'AAPL.json');
    const data = await fetchCompanyFacts(null, filePath);
    expect(data.entityName).toBe('Apple Inc.');
    expect(data.facts['us-gaap']).toBeDefined();
  });

  test('loads KO fixture from disk', async () => {
    const filePath = path.join(__dirname, 'fixtures', 'KO.json');
    const data = await fetchCompanyFacts(null, filePath);
    expect(data.entityName).toMatch(/coca.cola/i);
  });

  test('rejects a missing file path', async () => {
    await expect(fetchCompanyFacts(null, '/no/such/file.json')).rejects.toThrow();
  });
});

// ── CIK normalisation ─────────────────────────────────────────────────────

describe('resolveCik', () => {
  test('pads a bare CIK number to 10 digits', async () => {
    // Does not make a network request — numeric path is pure string manipulation
    const cik = await resolveCik('320193');
    expect(cik).toBe('0000320193');
  });

  test('already-padded CIK passes through', async () => {
    const cik = await resolveCik('0000320193');
    expect(cik).toBe('0000320193');
  });
});

// ── Live EDGAR fetch (skipped in CI when no network) ──────────────────────

const LIVE = process.env.TEST_LIVE === '1';

describe('fetchCompanyFacts — live EDGAR', () => {
  // These tests hit SEC EDGAR; run only when TEST_LIVE=1 is set.
  const maybeTest = LIVE ? test : test.skip;

  maybeTest('resolves AAPL ticker to correct CIK (hits www.sec.gov)', async () => {
    const cik = await resolveCik('AAPL');
    expect(cik).toBe('0000320193');
  }, 15000);

  maybeTest('fetches Apple company facts live', async () => {
    const cik = '0000320193';
    const data = await fetchCompanyFacts(cik);
    expect(data.entityName).toBe('Apple Inc.');
    expect(data.facts['us-gaap']['NetIncomeLoss']).toBeDefined();
  }, 30000);

  maybeTest('resolves KO ticker', async () => {
    const cik = await resolveCik('KO');
    expect(cik).toBe('0000021344');
  }, 15000);
});
