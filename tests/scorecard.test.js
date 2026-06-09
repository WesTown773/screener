'use strict';

const { computeMetrics } = require('../src/computeMetrics');
const { buildScorecard, formatText } = require('../src/scorecard');

const AAPL = require('./fixtures/AAPL.json');
const KO = require('./fixtures/KO.json');
const JPM = require('./fixtures/JPM.json');

function gaap(f) { return f.facts['us-gaap']; }

function scorecard(fixture) {
  const result = computeMetrics(gaap(fixture));
  return buildScorecard(result, { entityName: fixture.entityName, cik: fixture.cik });
}

// ── buildScorecard structure ───────────────────────────────────────────────

describe('buildScorecard', () => {
  test('produces exactly 10 criteria entries', () => {
    const sc = scorecard(AAPL);
    expect(sc.criteria).toHaveLength(10);
    expect(sc.criteria.map((c) => c.id)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });

  test('company block carries name and CIK', () => {
    const sc = scorecard(AAPL);
    expect(sc.company.name).toBe('Apple Inc.');
    expect(sc.company.cik).toBeTruthy();
  });

  test('every criterion has pass field (true/false/null)', () => {
    for (const fixture of [AAPL, KO, JPM]) {
      const sc = scorecard(fixture);
      for (const c of sc.criteria) {
        expect([true, false, null]).toContain(c.pass);
      }
    }
  });

  test('JPM criterion 5 (gross margin) is null pass with not_applicable flag', () => {
    const sc = scorecard(JPM);
    const gm = sc.criteria.find((c) => c.id === 5);
    expect(gm.pass).toBeNull();
    expect(gm.not_applicable).toBe(true);
    expect(gm.value).toBeNull();
  });

  test('summary totals are consistent', () => {
    for (const fixture of [AAPL, KO, JPM]) {
      const sc = scorecard(fixture);
      expect(sc.summary.total).toBe(10);
      expect(sc.summary.pass_count).toBeGreaterThanOrEqual(0);
      expect(sc.summary.pass_count + sc.summary.null_count).toBeLessThanOrEqual(10);
    }
  });

  test('fiscal_years carried through from metrics result', () => {
    const sc = scorecard(KO);
    expect(sc.fiscal_years).toHaveLength(10);
  });
});

// ── formatText ─────────────────────────────────────────────────────────────

describe('formatText', () => {
  let text;
  beforeAll(() => { text = formatText(scorecard(AAPL)); });

  test('contains company name', () => {
    expect(text).toContain('Apple Inc.');
  });

  test('contains 10 criterion rows', () => {
    const passMarks = (text.match(/[✓✗—]/g) || []).length;
    expect(passMarks).toBeGreaterThanOrEqual(10);
  });

  test('shows score line', () => {
    expect(text).toMatch(/Score:\s+\d+\s*\/\s*\d+/);
  });

  test('PASS/FAIL/N/A labels are present', () => {
    expect(text).toMatch(/PASS/);
    expect(text).toMatch(/FAIL/);
  });

  test('JPM shows N/A for gross margin row', () => {
    const jpmText = formatText(scorecard(JPM));
    expect(jpmText).toContain('N/A (no data)');
    expect(jpmText).toContain('N/A ');
  });
});

// ── JSON output round-trip ─────────────────────────────────────────────────

describe('JSON round-trip', () => {
  test('scorecard is JSON-serializable without errors', () => {
    for (const fixture of [AAPL, KO, JPM]) {
      const sc = scorecard(fixture);
      expect(() => JSON.stringify(sc)).not.toThrow();
      const parsed = JSON.parse(JSON.stringify(sc));
      expect(parsed.criteria).toHaveLength(10);
    }
  });
});
