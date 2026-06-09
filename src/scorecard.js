'use strict';

/**
 * Build a structured scorecard from computeMetrics output + company metadata.
 *
 * @param {object} metricsResult  Return value of computeMetrics()
 * @param {object} meta           { entityName, cik }
 * @returns {object}  Scorecard ready to JSON.stringify or pass to formatText()
 */
function buildScorecard(metricsResult, meta) {
  const { fiscal_years, metrics, summary } = metricsResult;
  const m = metrics;

  return {
    company: {
      name: meta.entityName,
      cik: meta.cik,
    },
    fiscal_years,
    criteria: [
      {
        id: 1,
        name: 'ROE ≥ 12% (10-yr avg)',
        value: m.roe.value,
        unit: '%',
        pass: m.roe.pass,
      },
      {
        id: 2,
        name: 'ROA ≥ 12% (10-yr avg)',
        value: m.roa.value,
        unit: '%',
        pass: m.roa.pass,
      },
      {
        id: 3,
        name: 'EPS diluted trend (latest > earliest)',
        value: m.eps_trend.pass == null ? null
          : `${m.eps_trend.first.value} → ${m.eps_trend.last.value}`,
        unit: 'USD/share',
        pass: m.eps_trend.pass,
        detail: { first: m.eps_trend.first, last: m.eps_trend.last },
      },
      {
        id: 4,
        name: 'Net income margin > 20% (10-yr avg)',
        value: m.net_income_margin.value,
        unit: '%',
        pass: m.net_income_margin.pass,
      },
      {
        id: 5,
        name: 'Gross profit margin > 40% (10-yr avg)',
        value: m.gross_margin.not_applicable ? null : m.gross_margin.value,
        unit: '%',
        pass: m.gross_margin.pass,
        not_applicable: m.gross_margin.not_applicable,
      },
      {
        id: 6,
        name: 'Long-term debt / net income < 5× (latest yr)',
        value: m.ltd_to_ni.value,
        unit: '×',
        pass: m.ltd_to_ni.pass,
        detail: { fy: m.ltd_to_ni.fy, tag: m.ltd_to_ni.ltd_tag },
      },
      {
        id: 7,
        name: 'Revenue CAGR > avg CPI growth',
        value: m.revenue_vs_inflation.rev_cagr,
        unit: '%',
        pass: m.revenue_vs_inflation.pass,
        detail: { rev_cagr: m.revenue_vs_inflation.rev_cagr, cpi_avg: m.revenue_vs_inflation.cpi_avg },
      },
      {
        id: 8,
        name: 'Return on retained capital > 11%',
        value: m.return_on_retained_capital.value,
        unit: '%',
        pass: m.return_on_retained_capital.pass,
        detail: {
          eps_change: m.return_on_retained_capital.eps_change,
          retained_capital: m.return_on_retained_capital.retained_capital,
        },
      },
      {
        id: 9,
        name: 'Dividend history (0 cuts, ≥7/9 increases)',
        value: m.dividend_history.pass == null ? null
          : `${m.dividend_history.increases} increases / ${m.dividend_history.cuts} cuts`,
        unit: null,
        pass: m.dividend_history.pass,
        detail: {
          cuts: m.dividend_history.cuts,
          increases: m.dividend_history.increases,
          periods: m.dividend_history.known_periods,
        },
      },
      {
        id: 10,
        name: 'Share buybacks ≥ 8 of 10 years',
        value: `${m.share_buybacks.years_with_buybacks}/${m.share_buybacks.of_total}`,
        unit: 'yrs',
        pass: m.share_buybacks.pass,
      },
    ],
    summary: {
      pass_count: summary.pass_count,
      null_count: summary.null_count,
      total: summary.total,
    },
  };
}

const PASS_LABEL = { true: 'PASS', false: 'FAIL', null: 'N/A ' };
const PASS_MARK  = { true: '✓', false: '✗', null: '—' };

/**
 * Render a scorecard as a human-readable text block.
 */
function formatText(scorecard) {
  const { company, fiscal_years, criteria, summary } = scorecard;
  const fyRange = `${fiscal_years[0]}–${fiscal_years[fiscal_years.length - 1]}`;

  const lines = [
    '',
    `  ${company.name}  (CIK ${company.cik})`,
    `  Fiscal years: ${fyRange}`,
    '',
    '  #  Criterion                                     Value           Result',
    '  ' + '─'.repeat(78),
  ];

  for (const c of criteria) {
    const mark = PASS_MARK[String(c.pass)];
    const label = PASS_LABEL[String(c.pass)];

    let valStr = '';
    if (c.not_applicable) {
      valStr = 'N/A (no data)';
    } else if (c.value == null) {
      valStr = '—';
    } else if (typeof c.value === 'number') {
      valStr = `${c.value}${c.unit ? ' ' + c.unit : ''}`;
    } else {
      valStr = String(c.value);
      if (c.unit && c.unit !== 'USD/share') valStr += ' ' + c.unit;
    }

    const name = c.name.padEnd(44);
    const val = valStr.padEnd(16);
    lines.push(`  ${String(c.id).padStart(2)}  ${name}  ${val}  ${mark} ${label}`);
  }

  lines.push('  ' + '─'.repeat(78));
  lines.push(`      Score: ${summary.pass_count} / ${summary.total - summary.null_count} applicable criteria`);
  lines.push('');

  return lines.join('\n');
}

module.exports = { buildScorecard, formatText };
