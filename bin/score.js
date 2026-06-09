#!/usr/bin/env node
'use strict';

/**
 * Usage:
 *   node bin/score.js AAPL
 *   node bin/score.js 320193
 *   node bin/score.js --file path/to/CIK0000320193.json
 *   node bin/score.js AAPL --json        # machine-readable output
 *   node bin/score.js AAPL --years 7     # override targetYears (default 10)
 */

const { resolveCik, fetchCompanyFacts } = require('../src/fetchCompany');
const { computeMetrics } = require('../src/computeMetrics');
const { buildScorecard, formatText } = require('../src/scorecard');

async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
    console.log([
      'Usage: node bin/score.js <ticker|cik> [options]',
      '       node bin/score.js --file <path> [options]',
      '',
      'Options:',
      '  --file <path>   Load from a local CIK JSON file instead of EDGAR',
      '  --json          Output machine-readable JSON scorecard',
      '  --years <n>     Number of fiscal years to evaluate (default: 10)',
    ].join('\n'));
    process.exit(0);
  }

  // Parse flags
  const fileIdx = args.indexOf('--file');
  const filePath = fileIdx !== -1 ? args[fileIdx + 1] : null;
  const jsonMode = args.includes('--json');
  const yearsIdx = args.indexOf('--years');
  const targetYears = yearsIdx !== -1 ? parseInt(args[yearsIdx + 1], 10) : 10;

  // First positional arg that isn't a flag value
  const positional = args.find((a, i) => !a.startsWith('--') && args[i - 1] !== '--file' && args[i - 1] !== '--years');

  let cik = null;
  let source = filePath;

  if (filePath) {
    // File mode — CIK is parsed from the file itself
  } else if (positional) {
    try {
      if (!jsonMode) process.stderr.write(`Resolving ${positional}...\n`);
      cik = await resolveCik(positional);
      if (!jsonMode) process.stderr.write(`CIK: ${cik}\n`);
    } catch (err) {
      console.error(`Error: ${err.message}`);
      process.exit(1);
    }
  } else {
    console.error('Error: provide a ticker/CIK or --file <path>');
    process.exit(1);
  }

  // Load company facts
  let data;
  try {
    if (!jsonMode) process.stderr.write('Fetching company facts...\n');
    data = await fetchCompanyFacts(cik, source);
  } catch (err) {
    console.error(`Error fetching data: ${err.message}`);
    process.exit(1);
  }

  const facts = data?.facts?.['us-gaap'];
  if (!facts) {
    console.error('Error: no us-gaap facts found in the response');
    process.exit(1);
  }

  // Compute
  const metricsResult = computeMetrics(facts, { targetYears });
  const scorecard = buildScorecard(metricsResult, {
    entityName: data.entityName ?? data.name ?? 'Unknown',
    cik: data.cik ?? cik,
  });

  if (jsonMode) {
    console.log(JSON.stringify(scorecard, null, 2));
  } else {
    console.log(formatText(scorecard));
  }
}

main().catch((err) => {
  console.error('Unexpected error:', err);
  process.exit(1);
});
