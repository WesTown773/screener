'use strict';

const fs = require('fs');

/**
 * Load passers from a JSON file path.
 * Returns an empty companies array if the file doesn't exist (first run).
 */
function loadPassers(filePath) {
  if (!filePath || !fs.existsSync(filePath)) {
    return { companies: [], generated_at: null, pass_threshold: null };
  }
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

/**
 * Compare two passers snapshots and return the diff.
 *
 * @param {object} prev  Previous passers snapshot (from loadPassers)
 * @param {object} curr  Current passers snapshot (from loadPassers)
 * @returns {{ newly_passing: object[], dropped: object[], unchanged: object[] }}
 */
function diffPassers(prev, curr) {
  const prevByCik = new Map((prev.companies ?? []).map((c) => [String(c.cik), c]));
  const currByCik = new Map((curr.companies ?? []).map((c) => [String(c.cik), c]));

  const newly_passing = [];
  const dropped = [];
  const unchanged = [];

  for (const [cik, company] of currByCik) {
    if (prevByCik.has(cik)) {
      unchanged.push(company);
    } else {
      newly_passing.push(company);
    }
  }

  for (const [cik, company] of prevByCik) {
    if (!currByCik.has(cik)) {
      dropped.push(company);
    }
  }

  return { newly_passing, dropped, unchanged };
}

module.exports = { loadPassers, diffPassers };
