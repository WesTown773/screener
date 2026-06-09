'use strict';

const { computeMetrics } = require('../src/computeMetrics');
const { annualByFy } = require('../src/annualByFy');

const AAPL = require('./fixtures/AAPL.json');
const KO = require('./fixtures/KO.json');
const JPM = require('./fixtures/JPM.json');

// ── Helpers ────────────────────────────────────────────────────────────────

function gaap(fixture) {
  return fixture.facts['us-gaap'];
}

// ── annualByFy ─────────────────────────────────────────────────────────────

describe('annualByFy', () => {
  test('extracts 10-K FY entries only (AAPL net income)', () => {
    const annual = annualByFy(gaap(AAPL));
    const ni = annual.net_income;

    // Every key should be a 4-digit year
    for (const fy of ni.keys()) {
      expect(fy).toMatch(/^\d{4}$/);
    }

    // Should have at least 10 fiscal years
    expect(ni.size).toBeGreaterThanOrEqual(10);
  });

  test('records which tag was used', () => {
    const annual = annualByFy(gaap(AAPL));
    for (const [, entry] of annual.net_income) {
      expect(entry.tag).toBeTruthy();
      expect(entry.filed).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  test('per-share fields use USD/shares unit (AAPL EPS)', () => {
    const annual = annualByFy(gaap(AAPL));
    // EPS values should be single-digit (dollars per share), not billions
    for (const [, entry] of annual.eps_diluted) {
      expect(Math.abs(entry.val)).toBeLessThan(200);
    }
  });

  test('JPM has no GrossProfit data', () => {
    const annual = annualByFy(gaap(JPM));
    expect(annual.gross_profit.size).toBe(0);
  });
});

// ── computeMetrics — structure ────────────────────────────────────────────

describe('computeMetrics — output structure', () => {
  let result;
  beforeAll(() => { result = computeMetrics(gaap(AAPL)); });

  test('returns fiscal_years array of length 10', () => {
    expect(result.fiscal_years).toHaveLength(10);
    expect(result.fiscal_years[0]).toMatch(/^\d{4}$/);
  });

  test('summary counts sum to 10', () => {
    const { pass_count, null_count, total } = result.summary;
    expect(total).toBe(10);
    expect(pass_count + null_count).toBeLessThanOrEqual(total);
  });

  test('all 10 criterion keys are present', () => {
    const keys = ['roe', 'roa', 'eps_trend', 'net_income_margin', 'gross_margin',
      'ltd_to_ni', 'revenue_vs_inflation', 'return_on_retained_capital',
      'dividend_history', 'share_buybacks'];
    for (const k of keys) {
      expect(result.metrics).toHaveProperty(k);
    }
  });

  test('every criterion has a pass field (true, false, or null)', () => {
    for (const [, m] of Object.entries(result.metrics)) {
      expect([true, false, null]).toContain(m.pass);
    }
  });
});

// ── AAPL ──────────────────────────────────────────────────────────────────

describe('AAPL metrics', () => {
  let r;
  beforeAll(() => { r = computeMetrics(gaap(AAPL)); });

  test('ROE is very high (Apple has negative equity some years — average > 12%)', () => {
    // Apple's buybacks drove equity negative, pushing ROE > 100%
    expect(r.metrics.roe.value).toBeGreaterThan(12);
    expect(r.metrics.roe.pass).toBe(true);
  });

  test('ROA ≥ 12% (asset-light model)', () => {
    expect(r.metrics.roa.value).toBeGreaterThanOrEqual(12);
    expect(r.metrics.roa.pass).toBe(true);
  });

  test('Gross margin > 40%', () => {
    expect(r.metrics.gross_margin.value).toBeGreaterThan(40);
    expect(r.metrics.gross_margin.pass).toBe(true);
    expect(r.metrics.gross_margin.not_applicable).toBe(false);
  });

  test('Net income margin > 20%', () => {
    expect(r.metrics.net_income_margin.value).toBeGreaterThan(20);
    expect(r.metrics.net_income_margin.pass).toBe(true);
  });

  test('LTD/NI well under 5×', () => {
    expect(r.metrics.ltd_to_ni.value).toBeLessThan(5);
    expect(r.metrics.ltd_to_ni.pass).toBe(true);
  });

  test('Revenue CAGR beats inflation', () => {
    expect(r.metrics.revenue_vs_inflation.rev_cagr).toBeGreaterThan(0);
    expect(r.metrics.revenue_vs_inflation.cpi_avg).toBeGreaterThan(0);
    expect(r.metrics.revenue_vs_inflation.pass).toBe(true);
  });

  test('Buybacks every year for 10 years', () => {
    expect(r.metrics.share_buybacks.years_with_buybacks).toBe(10);
    expect(r.metrics.share_buybacks.pass).toBe(true);
  });

  test('No null pass values (all 10 criteria have enough data)', () => {
    expect(r.summary.null_count).toBe(0);
  });
});

// ── KO ────────────────────────────────────────────────────────────────────

describe('KO (Coca-Cola) metrics', () => {
  let r;
  beforeAll(() => { r = computeMetrics(gaap(KO)); });

  test('Gross margin > 40% (consumer brand premium)', () => {
    expect(r.metrics.gross_margin.value).toBeGreaterThan(40);
    expect(r.metrics.gross_margin.pass).toBe(true);
    expect(r.metrics.gross_margin.not_applicable).toBe(false);
  });

  test('ROE > 12%', () => {
    expect(r.metrics.roe.value).toBeGreaterThan(12);
    expect(r.metrics.roe.pass).toBe(true);
  });

  test('Dividend aristocrat — 0 cuts, ≥7 increases', () => {
    expect(r.metrics.dividend_history.cuts).toBe(0);
    expect(r.metrics.dividend_history.increases).toBeGreaterThanOrEqual(7);
    expect(r.metrics.dividend_history.pass).toBe(true);
  });

  test('Net income margin > 20%', () => {
    expect(r.metrics.net_income_margin.value).toBeGreaterThan(20);
    expect(r.metrics.net_income_margin.pass).toBe(true);
  });
});

// ── JPM ───────────────────────────────────────────────────────────────────

describe('JPM (bank) — gross margin handling', () => {
  let r;
  beforeAll(() => { r = computeMetrics(gaap(JPM)); });

  test('Gross margin is marked not_applicable for a bank', () => {
    expect(r.metrics.gross_margin.not_applicable).toBe(true);
    expect(r.metrics.gross_margin.pass).toBeNull();
  });

  test('Gross margin not_applicable does NOT count as a false (summary)', () => {
    // null_count should include the gross_margin slot
    expect(r.summary.null_count).toBeGreaterThanOrEqual(1);
  });

  test('ROE > 12% for a major bank', () => {
    expect(r.metrics.roe.value).toBeGreaterThan(12);
    expect(r.metrics.roe.pass).toBe(true);
  });

  test('ROA typically < 12% for a bank (asset-heavy)', () => {
    // Banks are capital-heavy; ROA is typically 1-2%, not 12%
    expect(r.metrics.roa.value).toBeLessThan(12);
    expect(r.metrics.roa.pass).toBe(false);
  });

  test('Has at least 10 fiscal years of data', () => {
    expect(r.fiscal_years).toHaveLength(10);
  });
});

// ── Edge cases / robustness ───────────────────────────────────────────────

describe('Edge cases', () => {
  test('Empty facts object returns all nulls without throwing', () => {
    expect(() => computeMetrics({})).not.toThrow();
    const r = computeMetrics({});
    expect(r.fiscal_years).toHaveLength(0);
    expect(r.summary.pass_count).toBe(0);
  });

  test('Minimal facts with only net_income does not throw', () => {
    // Construct bare-minimum facts that have just net income
    const minimal = {
      NetIncomeLoss: {
        units: {
          USD: [
            { form: '10-K', fp: 'FY', end: '2020-12-31', val: 1e9, filed: '2021-02-01' },
            { form: '10-K', fp: 'FY', end: '2021-12-31', val: 1.1e9, filed: '2022-02-01' },
          ],
        },
      },
    };
    expect(() => computeMetrics(minimal)).not.toThrow();
    const r = computeMetrics(minimal);
    // All criteria except where we have no denominators should be null
    expect(r.metrics.roe.pass).toBeNull();
    expect(r.metrics.gross_margin.pass).toBeNull();
  });

  test('Negative net income does not crash LTD/NI check', () => {
    const facts = {
      NetIncomeLoss: {
        units: {
          USD: [{ form: '10-K', fp: 'FY', end: '2023-12-31', val: -5e8, filed: '2024-02-01' }],
        },
      },
      LongTermDebtNoncurrent: {
        units: {
          USD: [{ form: '10-K', fp: 'FY', end: '2023-12-31', val: 2e9, filed: '2024-02-01' }],
        },
      },
    };
    const r = computeMetrics(facts);
    // LTD/NI with negative NI → ratio should be null (not pass, since NI ≤ 0)
    expect(r.metrics.ltd_to_ni.pass).toBeNull();
  });
});
