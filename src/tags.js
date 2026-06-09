'use strict';

// XBRL tag priority lists — try in order, take first hit per fiscal year.
// Mirrors the spec's tag-mapping section exactly.
const TAGS = {
  revenue: [
    'Revenues',
    'RevenueFromContractWithCustomerExcludingAssessedTax',
    'SalesRevenueNet',
    'SalesRevenueGoodsNet',
  ],
  gross_profit: ['GrossProfit'],
  net_income: [
    'NetIncomeLoss',
    'ProfitLoss',
    'NetIncomeLossAvailableToCommonStockholdersBasic',
  ],
  assets: ['Assets'],
  equity: [
    'StockholdersEquity',
    'StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest',
  ],
  retained_earnings: ['RetainedEarningsAccumulatedDeficit'],
  eps_diluted: ['EarningsPerShareDiluted', 'EarningsPerShareBasic'],
  long_term_debt: [
    'LongTermDebtNoncurrent',
    'LongTermDebtAndFinanceLeaseObligationsNoncurrent',
    'LongTermDebtAndFinanceLeaseObligations',
  ],
  dividends_paid: [
    'PaymentsOfDividends',
    'PaymentsOfDividendsCommonStock',
    'PaymentsOfDividendsCommonStockAndPreferenceStock',
    'DividendsCommonStockCash',
  ],
  dividends_per_share: [
    'CommonStockDividendsPerShareDeclared',
    'CommonStockDividendsPerShareCashPaid',
  ],
  share_buybacks: [
    'PaymentsForRepurchaseOfCommonStock',
    'PaymentsForRepurchaseOfEquity',
    'RepaymentsOfCommonStocks',
    'TreasuryStockValueAcquiredCostMethod',
  ],
};

// Unit categories for per-share tags — filter to USD/shares to avoid mixing units
const PER_SHARE_FIELDS = new Set(['eps_diluted', 'dividends_per_share']);

module.exports = { TAGS, PER_SHARE_FIELDS };
