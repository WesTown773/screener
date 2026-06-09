'use strict';

const { annualByFy } = require('./annualByFy');
const { avgCpiGrowth } = require('./inflation');

/**
 * Given the parsed us-gaap facts for one company, compute all 10 criteria.
 *
 * @param {object} facts  The `facts["us-gaap"]` object from a CIK JSON.
 * @param {object} [opts]
 * @param {number} [opts.targetYears=10]     Fiscal years of operating history required.
 * @param {number} [opts.maxFiscalYear=2025] Exclude FY end dates after this year.
 * @returns {object}  Scorecard with raw values + pass/fail + by_year arrays per criterion.
 */
function computeMetrics(facts, opts = {}) {
  const targetYears = opts.targetYears ?? 10;
  const annual = annualByFy(facts, { maxFiscalYear: opts.maxFiscalYear ?? 2025 });

  const allFys = sortedFys(annual.net_income);
  const recentFys = allFys.slice(-targetYears);
  const years11 = allFys.slice(-(targetYears + 1));

  const metrics = {};

  const get = (field, fy) => annual[field].get(fy)?.val ?? null;
  const getTag = (field, fy) => annual[field].get(fy)?.tag ?? null;

  function avg(vals) {
    const clean = vals.filter((v) => v != null);
    if (clean.length === 0) return null;
    return clean.reduce((s, v) => s + v, 0) / clean.length;
  }

  function pairRatios(fys, numField, denomField, scale = 1) {
    return fys.slice(1).map((fy, i) => {
      const num = get(numField, fy);
      const d0 = get(denomField, fys[i]);
      const d1 = get(denomField, fy);
      const denom = d0 != null && d1 != null ? (d0 + d1) / 2 : null;
      return {
        fy,
        value: num != null && denom != null && denom !== 0 ? round((num / denom) * scale) : null,
      };
    });
  }

  // ── 1. ROE ───────────────────────────────────────────────────────────────
  const roeByYear = pairRatios(years11, 'net_income', 'equity', 100);
  const roe10Avg = avg(roeByYear.map((r) => r.value));
  metrics.roe = {
    value: round(roe10Avg),
    pass: roe10Avg != null ? roe10Avg >= 12 : null,
    by_year: roeByYear,
  };

  // ── 2. ROA ───────────────────────────────────────────────────────────────
  const roaByYear = pairRatios(years11, 'net_income', 'assets', 100);
  const roa10Avg = avg(roaByYear.map((r) => r.value));
  metrics.roa = {
    value: round(roa10Avg),
    pass: roa10Avg != null ? roa10Avg >= 12 : null,
    by_year: roaByYear,
  };

  // ── 3. EPS trend ─────────────────────────────────────────────────────────
  const epsByYear = recentFys.map((fy) => ({ fy, value: get('eps_diluted', fy) }));
  const epsFirst = epsByYear[0]?.value ?? null;
  const epsLast  = epsByYear[epsByYear.length - 1]?.value ?? null;
  metrics.eps_trend = {
    first: { fy: recentFys[0], value: epsFirst },
    last:  { fy: recentFys[recentFys.length - 1], value: epsLast },
    pass: epsFirst != null && epsLast != null ? epsLast > epsFirst : null,
    by_year: epsByYear,
  };

  // ── 4. Net income margin ──────────────────────────────────────────────────
  const niMargins = recentFys.map((fy) => {
    const ni = get('net_income', fy);
    const rev = get('revenue', fy);
    if (ni == null || rev == null || rev === 0) return null;
    return (ni / rev) * 100;
  });
  const niMarginAvg = avg(niMargins);
  metrics.net_income_margin = {
    value: round(niMarginAvg),
    pass: niMarginAvg != null ? niMarginAvg > 20 : null,
    by_year: recentFys.map((fy, i) => ({ fy, value: round(niMargins[i]) })),
  };

  // ── 5. Gross profit margin ────────────────────────────────────────────────
  const gpMargins = recentFys.map((fy) => {
    const gp = get('gross_profit', fy);
    const rev = get('revenue', fy);
    if (gp == null || rev == null || rev === 0) return null;
    return (gp / rev) * 100;
  });
  const gpAvailable = gpMargins.filter((v) => v != null).length;
  const gpMarginAvg = avg(gpMargins);
  metrics.gross_margin = {
    value: round(gpMarginAvg),
    pass: gpAvailable < targetYears / 2 ? null : gpMarginAvg != null ? gpMarginAvg > 40 : null,
    not_applicable: gpAvailable < targetYears / 2,
    by_year: recentFys.map((fy, i) => ({ fy, value: round(gpMargins[i]) })),
  };

  // ── 6. Long-term debt / net income ───────────────────────────────────────
  const latestFy = recentFys[recentFys.length - 1];
  let ltdFy = null;
  for (let i = recentFys.length - 1; i >= 0; i--) {
    if (get('long_term_debt', recentFys[i]) != null && get('net_income', recentFys[i]) != null) {
      ltdFy = recentFys[i]; break;
    }
  }
  const ltd = ltdFy ? get('long_term_debt', ltdFy) : null;
  const niLatest = ltdFy ? get('net_income', ltdFy) : null;
  const ltdRatio = ltd != null && niLatest != null && niLatest > 0 ? ltd / niLatest : null;
  const ltdByYear = recentFys.map((fy) => {
    const l = get('long_term_debt', fy);
    const n = get('net_income', fy);
    return { fy, value: l != null && n != null && n > 0 ? round(l / n) : null };
  });
  metrics.ltd_to_ni = {
    value: round(ltdRatio),
    pass: ltdRatio != null ? ltdRatio < 5 : null,
    fy: ltdFy ?? latestFy,
    ltd_tag: ltdFy ? getTag('long_term_debt', ltdFy) : null,
    by_year: ltdByYear,
  };

  // ── 7. Revenue growth vs inflation ───────────────────────────────────────
  const revByYear = recentFys.map((fy) => ({ fy, value: get('revenue', fy) }));
  const revFirst = get('revenue', recentFys[0]);
  const revLast  = get('revenue', latestFy);
  const revStartYear = parseInt(recentFys[0], 10);
  const revEndYear   = parseInt(latestFy, 10);
  let revCagr = null;
  if (revFirst != null && revLast != null && revFirst > 0 && revEndYear > revStartYear) {
    revCagr = (Math.pow(revLast / revFirst, 1 / (revEndYear - revStartYear)) - 1) * 100;
  }
  const cpiGrowth = avgCpiGrowth(revStartYear, revEndYear);
  metrics.revenue_vs_inflation = {
    rev_cagr: round(revCagr),
    cpi_avg: round(cpiGrowth),
    pass: revCagr != null && cpiGrowth != null ? revCagr > cpiGrowth : null,
    by_year: revByYear,
  };

  // ── 8. Return on retained capital ────────────────────────────────────────
  const epsVals = recentFys.map((fy) => get('eps_diluted', fy));
  const dpsVals = recentFys.map((fy) => get('dividends_per_share', fy));
  const cumulativeEps = sumNonNull(epsVals);
  const cumulativeDps = sumNonNull(dpsVals);
  const retainedCapital =
    cumulativeEps != null && cumulativeDps != null ? cumulativeEps - cumulativeDps : null;
  const epsChange = epsFirst != null && epsLast != null ? epsLast - epsFirst : null;
  const rorc =
    epsChange != null && retainedCapital != null && retainedCapital !== 0
      ? (epsChange / retainedCapital) * 100 : null;
  metrics.return_on_retained_capital = {
    value: round(rorc),
    pass: rorc != null ? rorc > 11 : null,
    eps_change: round(epsChange),
    retained_capital: round(retainedCapital),
  };

  // ── 9. Dividend history ───────────────────────────────────────────────────
  const dpsByYear = recentFys.map((fy) => get('dividends_per_share', fy));
  metrics.dividend_history = analyzeDividends(dpsByYear, recentFys);

  // ── 10. Share buybacks ────────────────────────────────────────────────────
  const buybackVals = recentFys.map((fy) => get('share_buybacks', fy));
  const buybackYears = buybackVals.filter((v) => v != null && v > 0).length;
  metrics.share_buybacks = {
    years_with_buybacks: buybackYears,
    of_total: recentFys.length,
    pass: buybackYears >= 8,
    by_year: recentFys.map((fy, i) => ({ fy, value: buybackVals[i] })),
  };

  // ── Summary ───────────────────────────────────────────────────────────────
  const passCriteria = [
    metrics.roe.pass, metrics.roa.pass, metrics.eps_trend.pass,
    metrics.net_income_margin.pass, metrics.gross_margin.pass,
    metrics.ltd_to_ni.pass, metrics.revenue_vs_inflation.pass,
    metrics.return_on_retained_capital.pass, metrics.dividend_history.pass,
    metrics.share_buybacks.pass,
  ];
  const passCount = passCriteria.filter((p) => p === true).length;
  const nullCount = passCriteria.filter((p) => p === null).length;

  return {
    fiscal_years: recentFys,
    metrics,
    summary: { pass_count: passCount, null_count: nullCount, total: passCriteria.length },
  };
}

function sortedFys(fyMap) { return Array.from(fyMap.keys()).sort(); }
function round(v, decimals = 2) {
  if (v == null) return null;
  return Math.round(v * 10 ** decimals) / 10 ** decimals;
}
function sumNonNull(vals) {
  const clean = vals.filter((v) => v != null);
  if (clean.length === 0) return null;
  return clean.reduce((s, v) => s + v, 0);
}
function analyzeDividends(dpsByYear, fys) {
  const yoyChanges = [];
  for (let i = 1; i < dpsByYear.length; i++) {
    const prev = dpsByYear[i - 1]; const curr = dpsByYear[i];
    if (prev == null || curr == null) yoyChanges.push(null);
    else if (curr > prev) yoyChanges.push('increase');
    else if (curr < prev) yoyChanges.push('cut');
    else yoyChanges.push('flat');
  }
  const cuts = yoyChanges.filter((c) => c === 'cut').length;
  const increases = yoyChanges.filter((c) => c === 'increase').length;
  const knownChanges = yoyChanges.filter((c) => c != null).length;
  const hasDividends = dpsByYear.some((v) => v != null && v > 0);
  const pass = hasDividends && cuts === 0 && increases >= 7 ? true : hasDividends ? false : null;
  return {
    pass, cuts, increases, known_periods: knownChanges,
    by_year: fys.map((fy, i) => ({ fy, dps: dpsByYear[i], change: i === 0 ? null : yoyChanges[i - 1] })),
  };
}

module.exports = { computeMetrics };
