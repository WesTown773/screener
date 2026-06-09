/* Browser bundle — auto-generated from src/tags.js, annualByFy.js, inflation.js,
   computeMetrics.js, scorecard.js. No Node.js dependencies. */
(function (global) {
  'use strict';

  // ── tags ──────────────────────────────────────────────────────────────────
  const TAGS = {
    revenue: ['Revenues','RevenueFromContractWithCustomerExcludingAssessedTax','SalesRevenueNet','SalesRevenueGoodsNet'],
    gross_profit: ['GrossProfit'],
    net_income: ['NetIncomeLoss','ProfitLoss','NetIncomeLossAvailableToCommonStockholdersBasic'],
    assets: ['Assets'],
    equity: ['StockholdersEquity','StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest'],
    retained_earnings: ['RetainedEarningsAccumulatedDeficit'],
    eps_diluted: ['EarningsPerShareDiluted','EarningsPerShareBasic'],
    long_term_debt: ['LongTermDebtNoncurrent','LongTermDebtAndFinanceLeaseObligationsNoncurrent','LongTermDebtAndFinanceLeaseObligations'],
    dividends_paid: ['PaymentsOfDividends','PaymentsOfDividendsCommonStock','PaymentsOfDividendsCommonStockAndPreferenceStock','DividendsCommonStockCash'],
    dividends_per_share: ['CommonStockDividendsPerShareDeclared','CommonStockDividendsPerShareCashPaid'],
    share_buybacks: ['PaymentsForRepurchaseOfCommonStock','PaymentsForRepurchaseOfEquity','RepaymentsOfCommonStocks','TreasuryStockValueAcquiredCostMethod'],
  };
  const PER_SHARE_FIELDS = new Set(['eps_diluted', 'dividends_per_share']);

  // ── annualByFy ────────────────────────────────────────────────────────────
  function annualByFy(facts, opts = {}) {
    const maxFiscalYear = String(opts.maxFiscalYear ?? 2025);
    const result = {};
    for (const [field, tagList] of Object.entries(TAGS)) {
      const byFy = new Map();
      for (const tag of tagList) {
        const concept = facts[tag];
        if (!concept) continue;
        const unitKey = PER_SHARE_FIELDS.has(field) ? 'USD/shares' : 'USD';
        const entries = concept.units?.[unitKey];
        if (!entries) continue;
        for (const entry of entries) {
          if (!['10-K', '10-K/A'].includes(entry.form)) continue;
          if (entry.fp !== 'FY') continue;
          if (entry.val == null) continue;
          const fy = entry.end.slice(0, 4);
          if (fy > maxFiscalYear) continue;
          const existing = byFy.get(fy);
          if (!existing) {
            byFy.set(fy, { val: entry.val, tag, filed: entry.filed });
          } else if (existing.tag === tag && entry.filed > existing.filed) {
            byFy.set(fy, { val: entry.val, tag, filed: entry.filed });
          }
        }
      }
      result[field] = byFy;
    }
    return result;
  }

  // ── inflation ─────────────────────────────────────────────────────────────
  const CPI = {
    2000:172.2,2001:177.1,2002:179.9,2003:184.0,2004:188.9,
    2005:195.3,2006:201.6,2007:207.3,2008:215.3,2009:214.5,
    2010:218.1,2011:224.9,2012:229.6,2013:233.0,2014:236.7,
    2015:237.0,2016:240.0,2017:245.1,2018:251.1,2019:255.7,
    2020:258.8,2021:270.9,2022:292.7,2023:304.7,2024:314.2,
  };
  function avgCpiGrowth(startYear, endYear) {
    const s = CPI[startYear];
    if (s == null) return null;
    let ey = endYear;
    while (ey > startYear && CPI[ey] == null) ey--;
    const e = CPI[ey];
    if (e == null) return null;
    const n = ey - startYear;
    if (n <= 0) return null;
    return (Math.pow(e / s, 1 / n) - 1) * 100;
  }

  // ── helpers ───────────────────────────────────────────────────────────────
  function sortedFys(fyMap) { return Array.from(fyMap.keys()).sort(); }
  function round(v, decimals = 2) {
    if (v == null) return null;
    return Math.round(v * 10 ** decimals) / 10 ** decimals;
  }
  function avg(vals) {
    const clean = vals.filter(v => v != null);
    if (!clean.length) return null;
    return clean.reduce((s, v) => s + v, 0) / clean.length;
  }
  function sumNonNull(vals) {
    const clean = vals.filter(v => v != null);
    if (!clean.length) return null;
    return clean.reduce((s, v) => s + v, 0);
  }
  function analyzeDividends(dpsByYear, fys) {
    const yoyChanges = [];
    for (let i = 1; i < dpsByYear.length; i++) {
      const prev = dpsByYear[i - 1], curr = dpsByYear[i];
      if (prev == null || curr == null) yoyChanges.push(null);
      else if (curr > prev) yoyChanges.push('increase');
      else if (curr < prev) yoyChanges.push('cut');
      else yoyChanges.push('flat');
    }
    const cuts = yoyChanges.filter(c => c === 'cut').length;
    const increases = yoyChanges.filter(c => c === 'increase').length;
    const knownChanges = yoyChanges.filter(c => c != null).length;
    const hasDividends = dpsByYear.some(v => v != null && v > 0);
    const pass = hasDividends && cuts === 0 && increases >= 7 ? true : hasDividends ? false : null;
    return {
      pass, cuts, increases, known_periods: knownChanges,
      by_year: fys.map((fy, i) => ({ fy, dps: dpsByYear[i], change: i === 0 ? null : yoyChanges[i - 1] })),
    };
  }

  // ── computeMetrics ────────────────────────────────────────────────────────
  function computeMetrics(facts, opts = {}) {
    const targetYears = opts.targetYears ?? 10;
    const annual = annualByFy(facts, { maxFiscalYear: opts.maxFiscalYear ?? 2025 });
    const allFys = sortedFys(annual.net_income);
    const recentFys = allFys.slice(-targetYears);
    const years11 = allFys.slice(-(targetYears + 1));
    const metrics = {};
    const get = (field, fy) => annual[field].get(fy)?.val ?? null;
    const getTag = (field, fy) => annual[field].get(fy)?.tag ?? null;

    function pairRatios(fys, numField, denomField, scale = 1) {
      return fys.slice(1).map((fy, i) => {
        const num = get(numField, fy);
        const d0 = get(denomField, fys[i]);
        const d1 = get(denomField, fy);
        const denom = d0 != null && d1 != null ? (d0 + d1) / 2 : null;
        return { fy, value: num != null && denom != null && denom !== 0 ? round((num / denom) * scale) : null };
      });
    }

    const roeByYear = pairRatios(years11, 'net_income', 'equity', 100);
    const roe10Avg = avg(roeByYear.map(r => r.value));
    metrics.roe = { value: round(roe10Avg), pass: roe10Avg != null ? roe10Avg >= 12 : null, by_year: roeByYear };

    const roaByYear = pairRatios(years11, 'net_income', 'assets', 100);
    const roa10Avg = avg(roaByYear.map(r => r.value));
    metrics.roa = { value: round(roa10Avg), pass: roa10Avg != null ? roa10Avg >= 12 : null, by_year: roaByYear };

    const epsByYear = recentFys.map(fy => ({ fy, value: get('eps_diluted', fy) }));
    const epsFirst = epsByYear[0]?.value ?? null;
    const epsLast = epsByYear[epsByYear.length - 1]?.value ?? null;
    metrics.eps_trend = {
      first: { fy: recentFys[0], value: epsFirst },
      last: { fy: recentFys[recentFys.length - 1], value: epsLast },
      pass: epsFirst != null && epsLast != null ? epsLast > epsFirst : null,
      by_year: epsByYear,
    };

    const niMargins = recentFys.map(fy => {
      const ni = get('net_income', fy), rev = get('revenue', fy);
      return ni == null || rev == null || rev === 0 ? null : (ni / rev) * 100;
    });
    const niMarginAvg = avg(niMargins);
    metrics.net_income_margin = {
      value: round(niMarginAvg), pass: niMarginAvg != null ? niMarginAvg > 20 : null,
      by_year: recentFys.map((fy, i) => ({ fy, value: round(niMargins[i]) })),
    };

    const gpMargins = recentFys.map(fy => {
      const gp = get('gross_profit', fy), rev = get('revenue', fy);
      return gp == null || rev == null || rev === 0 ? null : (gp / rev) * 100;
    });
    const gpAvailable = gpMargins.filter(v => v != null).length;
    const gpMarginAvg = avg(gpMargins);
    metrics.gross_margin = {
      value: round(gpMarginAvg),
      pass: gpAvailable < targetYears / 2 ? null : gpMarginAvg != null ? gpMarginAvg > 40 : null,
      not_applicable: gpAvailable < targetYears / 2,
      by_year: recentFys.map((fy, i) => ({ fy, value: round(gpMargins[i]) })),
    };

    const latestFy = recentFys[recentFys.length - 1];
    let ltdFy = null;
    for (let i = recentFys.length - 1; i >= 0; i--) {
      if (get('long_term_debt', recentFys[i]) != null && get('net_income', recentFys[i]) != null) { ltdFy = recentFys[i]; break; }
    }
    const ltd = ltdFy ? get('long_term_debt', ltdFy) : null;
    const niLatest = ltdFy ? get('net_income', ltdFy) : null;
    const ltdRatio = ltd != null && niLatest != null && niLatest > 0 ? ltd / niLatest : null;
    metrics.ltd_to_ni = {
      value: round(ltdRatio), pass: ltdRatio != null ? ltdRatio < 5 : null,
      fy: ltdFy ?? latestFy, ltd_tag: ltdFy ? getTag('long_term_debt', ltdFy) : null,
      by_year: recentFys.map(fy => { const l = get('long_term_debt', fy), n = get('net_income', fy); return { fy, value: l != null && n != null && n > 0 ? round(l / n) : null }; }),
    };

    const revByYear = recentFys.map(fy => ({ fy, value: get('revenue', fy) }));
    const revFirst = get('revenue', recentFys[0]), revLast = get('revenue', latestFy);
    const revStartYear = parseInt(recentFys[0], 10), revEndYear = parseInt(latestFy, 10);
    let revCagr = null;
    if (revFirst != null && revLast != null && revFirst > 0 && revEndYear > revStartYear)
      revCagr = (Math.pow(revLast / revFirst, 1 / (revEndYear - revStartYear)) - 1) * 100;
    const cpiGrowth = avgCpiGrowth(revStartYear, revEndYear);
    metrics.revenue_vs_inflation = {
      rev_cagr: round(revCagr), cpi_avg: round(cpiGrowth),
      pass: revCagr != null && cpiGrowth != null ? revCagr > cpiGrowth : null,
      by_year: revByYear,
    };

    const epsVals = recentFys.map(fy => get('eps_diluted', fy));
    const dpsVals = recentFys.map(fy => get('dividends_per_share', fy));
    const cumulativeEps = sumNonNull(epsVals), cumulativeDps = sumNonNull(dpsVals);
    const retainedCapital = cumulativeEps != null && cumulativeDps != null ? cumulativeEps - cumulativeDps : null;
    const epsChange = epsFirst != null && epsLast != null ? epsLast - epsFirst : null;
    const rorc = epsChange != null && retainedCapital != null && retainedCapital !== 0 ? (epsChange / retainedCapital) * 100 : null;
    metrics.return_on_retained_capital = {
      value: round(rorc), pass: rorc != null ? rorc > 11 : null,
      eps_change: round(epsChange), retained_capital: round(retainedCapital),
    };

    const dpsByYear = recentFys.map(fy => get('dividends_per_share', fy));
    metrics.dividend_history = analyzeDividends(dpsByYear, recentFys);

    const buybackVals = recentFys.map(fy => get('share_buybacks', fy));
    const buybackYears = buybackVals.filter(v => v != null && v > 0).length;
    metrics.share_buybacks = {
      years_with_buybacks: buybackYears, of_total: recentFys.length,
      pass: buybackYears >= 8,
      by_year: recentFys.map((fy, i) => ({ fy, value: buybackVals[i] })),
    };

    const passCriteria = [
      metrics.roe.pass, metrics.roa.pass, metrics.eps_trend.pass,
      metrics.net_income_margin.pass, metrics.gross_margin.pass,
      metrics.ltd_to_ni.pass, metrics.revenue_vs_inflation.pass,
      metrics.return_on_retained_capital.pass, metrics.dividend_history.pass,
      metrics.share_buybacks.pass,
    ];
    return {
      fiscal_years: recentFys, metrics,
      summary: { pass_count: passCriteria.filter(p => p === true).length, null_count: passCriteria.filter(p => p === null).length, total: passCriteria.length },
    };
  }

  // ── buildScorecard ────────────────────────────────────────────────────────
  function buildScorecard(metricsResult, meta) {
    const { fiscal_years, metrics: m, summary } = metricsResult;
    return {
      company: { name: meta.entityName, cik: meta.cik },
      fiscal_years,
      criteria: [
        { id:1, name:'ROE ≥ 12% (10-yr avg)', value:m.roe.value, unit:'%', pass:m.roe.pass },
        { id:2, name:'ROA ≥ 12% (10-yr avg)', value:m.roa.value, unit:'%', pass:m.roa.pass },
        { id:3, name:'EPS diluted trend (latest > earliest)', value:m.eps_trend.pass==null?null:`${m.eps_trend.first.value} → ${m.eps_trend.last.value}`, unit:'USD/share', pass:m.eps_trend.pass, detail:{first:m.eps_trend.first,last:m.eps_trend.last} },
        { id:4, name:'Net income margin > 20% (10-yr avg)', value:m.net_income_margin.value, unit:'%', pass:m.net_income_margin.pass },
        { id:5, name:'Gross profit margin > 40% (10-yr avg)', value:m.gross_margin.not_applicable?null:m.gross_margin.value, unit:'%', pass:m.gross_margin.pass, not_applicable:m.gross_margin.not_applicable },
        { id:6, name:'Long-term debt / net income < 5×', value:m.ltd_to_ni.value, unit:'×', pass:m.ltd_to_ni.pass, detail:{fy:m.ltd_to_ni.fy,tag:m.ltd_to_ni.ltd_tag} },
        { id:7, name:'Revenue CAGR > avg CPI growth', value:m.revenue_vs_inflation.rev_cagr, unit:'%', pass:m.revenue_vs_inflation.pass, detail:{rev_cagr:m.revenue_vs_inflation.rev_cagr,cpi_avg:m.revenue_vs_inflation.cpi_avg} },
        { id:8, name:'Return on retained capital > 11%', value:m.return_on_retained_capital.value, unit:'%', pass:m.return_on_retained_capital.pass, detail:{eps_change:m.return_on_retained_capital.eps_change,retained_capital:m.return_on_retained_capital.retained_capital} },
        { id:9, name:'Dividend history (0 cuts, ≥7/9 increases)', value:m.dividend_history.pass==null?null:`${m.dividend_history.increases} increases / ${m.dividend_history.cuts} cuts`, unit:null, pass:m.dividend_history.pass, detail:{cuts:m.dividend_history.cuts,increases:m.dividend_history.increases,periods:m.dividend_history.known_periods} },
        { id:10, name:'Share buybacks ≥ 8 of 10 years', value:`${m.share_buybacks.years_with_buybacks}/${m.share_buybacks.of_total}`, unit:'yrs', pass:m.share_buybacks.pass },
      ],
      summary: { pass_count:summary.pass_count, null_count:summary.null_count, total:summary.total },
      trend_5y: buildTrend5y(metricsResult),
    };
  }

  function buildTrend5y(metricsResult) {
    const fys = metricsResult.fiscal_years;
    const last5 = fys.slice(-5);
    const m = metricsResult.metrics;
    function pick5(byYear, valueKey = 'value') {
      if (!byYear) return null;
      return last5.map(fy => { const e = byYear.find(r => r.fy === fy); return e ? (e[valueKey] ?? null) : null; });
    }
    return {
      years: last5,
      roe: pick5(m.roe.by_year), roa: pick5(m.roa.by_year),
      eps: pick5(m.eps_trend.by_year), ni_margin: pick5(m.net_income_margin.by_year),
      gp_margin: pick5(m.gross_margin.by_year), ltd_ni: pick5(m.ltd_to_ni.by_year),
      revenue: pick5(m.revenue_vs_inflation.by_year), dps: pick5(m.dividend_history.by_year, 'dps'),
      buybacks: pick5(m.share_buybacks.by_year),
    };
  }

  global.ScreenerBrowser = { computeMetrics, buildScorecard };
})(window);
