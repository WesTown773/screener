'use strict';

const { TAGS, PER_SHARE_FIELDS } = require('./tags');

/**
 * Extract one value per fiscal year for every field defined in TAGS.
 *
 * Rules (per spec):
 *  - Filter to form in [10-K, 10-K/A], fp == "FY".
 *  - Exclude fiscal years whose period-end date falls after maxFiscalYear
 *    (default 2025 — keeps analysis on completed, filed years only).
 *  - For each field, try tags in priority order; take the first tag that has
 *    ANY value for that fiscal year.
 *  - Within a tag+FY, if multiple filings exist (amended 10-K/A), take the
 *    most recently filed (highest `filed` date string — ISO comparison works).
 *  - Record which tag was used for the audit trail.
 *
 * @param {object} facts  The `facts["us-gaap"]` object from a CIK JSON.
 * @param {object} [opts]
 * @param {number} [opts.maxFiscalYear=2025]  Exclude FY end dates after this year.
 * @returns {object}  { <field>: Map<fy_string, { val, tag, filed }> }
 */
function annualByFy(facts, opts = {}) {
  const maxFiscalYear = String(opts.maxFiscalYear ?? 2025);
  const result = {};

  for (const [field, tagList] of Object.entries(TAGS)) {
    const byFy = new Map(); // fy (e.g. "2023") => { val, tag, filed }

    for (const tag of tagList) {
      const concept = facts[tag];
      if (!concept) continue;

      // EPS and DPS live under USD/shares; monetary tags live under USD.
      const unitKey = PER_SHARE_FIELDS.has(field) ? 'USD/shares' : 'USD';
      const entries = concept.units?.[unitKey];
      if (!entries) continue;

      for (const entry of entries) {
        if (!['10-K', '10-K/A'].includes(entry.form)) continue;
        if (entry.fp !== 'FY') continue;
        if (entry.val == null) continue;

        // Derive fiscal year from the end date (last 4 chars not reliable if
        // the period straddles year boundary; use `end` field year instead).
        const fy = entry.end.slice(0, 4);

        // Skip fiscal years beyond the analysis cutoff.
        if (fy > maxFiscalYear) continue;

        const existing = byFy.get(fy);
        if (!existing) {
          // First hit for this FY under this field — claim the slot.
          byFy.set(fy, { val: entry.val, tag, filed: entry.filed });
        } else if (existing.tag === tag && entry.filed > existing.filed) {
          // Same tag, later amendment — prefer it.
          byFy.set(fy, { val: entry.val, tag, filed: entry.filed });
        }
        // If existing.tag is a higher-priority tag, don't overwrite.
      }

      // If we captured at least one FY for this tag, we're done with the
      // priority loop for years that this tag covers. However, a lower-priority
      // tag may cover fiscal years the higher-priority tag does not. Continue
      // iterating tags but don't overwrite years already populated.
    }

    result[field] = byFy;
  }

  return result;
}

module.exports = { annualByFy };
