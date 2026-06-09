'use strict';

// US CPI annual averages (all items, 1982-84=100) — embedded constant.
// Source: BLS series CUUR0000SA0 annual averages.
// Extend this table as new years become available.
const CPI = {
  2000: 172.2, 2001: 177.1, 2002: 179.9, 2003: 184.0, 2004: 188.9,
  2005: 195.3, 2006: 201.6, 2007: 207.3, 2008: 215.3, 2009: 214.5,
  2010: 218.1, 2011: 224.9, 2012: 229.6, 2013: 233.0, 2014: 236.7,
  2015: 237.0, 2016: 240.0, 2017: 245.1, 2018: 251.1, 2019: 255.7,
  2020: 258.8, 2021: 270.9, 2022: 292.7, 2023: 304.7, 2024: 314.2,
};

/**
 * Compute average annual CPI growth rate between two years (inclusive).
 * If endYear is not in the table, walks back to the most recent available year.
 * Returns null if startYear is missing or the effective range is zero/negative.
 */
function avgCpiGrowth(startYear, endYear) {
  const s = CPI[startYear];
  if (s == null) return null;
  // Find the most recent available CPI year ≤ endYear
  let ey = endYear;
  while (ey > startYear && CPI[ey] == null) ey--;
  const e = CPI[ey];
  if (e == null) return null;
  const n = ey - startYear;
  if (n <= 0) return null;
  return (Math.pow(e / s, 1 / n) - 1) * 100; // percent
}

module.exports = { CPI, avgCpiGrowth };
