# Fundamental Quality Screener — Project Brief

## Goal
A scheduled pipeline that screens the universe of US-listed companies against a fixed 10-point fundamental-quality test using SEC EDGAR data, and emails me when a company newly passes. A lightweight dashboard displays the latest results. This is a screening/calculation tool, not investment advice.

## Architecture (chosen for $0 hosting, no always-on server)
- **Language:** Node.js (TypeScript optional).
- **Scheduler:** GitHub Actions cron (weekly). Chosen over a Cloudflare Worker because the data ingest reads a multi-GB zip, which exceeds Worker CPU/time limits but is trivial on an Actions runner (hours of CPU, plenty of disk).
- **Data source:** SEC EDGAR bulk dump `companyfacts.zip` (one nightly archive containing one JSON per filer, named `CIK##########.json`). We hit SEC **once per run**, never per ticker — this avoids the per-IP rate limit entirely. Confirm the current bulk URL from sec.gov/developer at build time.
- **Storage / output:** a small committed JSON file (e.g. `data/results.json`) with the full scored universe, plus `data/passers.json` with the current pass list. Published via GitHub Pages so the dashboard can read it.
- **Dashboard:** reuse the existing standalone `index.html` screener, modified to load `results.json` and show qualifying companies + their scorecards. No live SEC calls.
- **Alerts:** email via a transactional email API (Resend or similar) using an API key stored as a GitHub Actions secret. Only alert on **newly** passing companies (diff against the previous run).

## The 10 criteria (all per-company, computed from 10-K / 10-K/A annual XBRL, FY period, latest-filed value per fiscal year)
Use the most recent 10 completed fiscal years; pull 11 years of balance-sheet data so ROE/ROA get a true prior-year average. Convert nothing to advice — just pass/fail + the value.

1. **ROE** = Net Income / average Shareholders' Equity. Pass if 10-yr average ≥ 12%.
2. **ROA** = Net Income / average Total Assets × 100. Pass if 10-yr average ≥ 12%.
3. **EPS (diluted, pulled directly)** — Pass if upward over 10 years (latest > earliest).
4. **Net Income Margin** = Net Income / Revenue × 100. Pass if 10-yr average > 20%.
5. **Gross Profit Margin** = Gross Profit / Revenue × 100. Pass if 10-yr average > 40%. (Not meaningful for banks/insurers — see caveats.)
6. **Long-Term Debt / Net Income** — Pass if latest year < 5×.
7. **Revenue growth vs inflation** — Pass if average annual revenue growth > average US CPI over the period.
8. **Return on Retained Capital** = (latest EPS − first EPS) / (cumulative EPS − cumulative dividends/share) × 100. Pass if > 11%. (Per-share definition; keep a toggle for the Net-Income ÷ avg-retained-earnings alternative.)
9. **Dividend history** — Pass if dividends per share rose consistently (0 cuts, ≥ 7 of 9 year-over-year increases).
10. **Share buybacks** — Pass if repurchasing in ≥ 8 of 10 years.

**Pass threshold for an alert must be configurable** (`PASS_THRESHOLD`, default = all 10). All-10 will produce a very small list and excludes all non-dividend-payers and asset-heavy businesses by design; expect to tune toward "N of 10".

## XBRL tag mapping (try in priority order; record which tag was used per field)
- revenue: Revenues, RevenueFromContractWithCustomerExcludingAssessedTax, SalesRevenueNet, SalesRevenueGoodsNet
- gross_profit: GrossProfit
- net_income: NetIncomeLoss, ProfitLoss, NetIncomeLossAvailableToCommonStockholdersBasic
- assets: Assets
- equity: StockholdersEquity, StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest
- retained_earnings: RetainedEarningsAccumulatedDeficit
- eps_diluted: EarningsPerShareDiluted (unit USD/shares); fallback EarningsPerShareBasic
- long_term_debt: LongTermDebtNoncurrent, LongTermDebtAndFinanceLeaseObligationsNoncurrent, LongTermDebtAndFinanceLeaseObligations
- dividends_paid: PaymentsOfDividends, PaymentsOfDividendsCommonStock, PaymentsOfDividendsCommonStockAndPreferenceStock, DividendsCommonStockCash
- dividends_per_share: CommonStockDividendsPerShareDeclared, CommonStockDividendsPerShareCashPaid (unit USD/shares)
- share_buybacks: PaymentsForRepurchaseOfCommonStock, PaymentsForRepurchaseOfEquity, RepaymentsOfCommonStocks, TreasuryStockValueAcquiredCostMethod
- inflation: external US CPI table (embedded constant, not from filings)

Filter facts to form in [10-K, 10-K/A] and fp == "FY". Per fiscal year, keep the highest-priority tag that has a value, latest-filed wins. (This logic already exists in the prototype `buildMetrics`/`annualByFy` — reuse it.)

## Milestones (build in this order; get each working before the next)
1. **Core library** — port the existing metric computation into a clean Node module with unit tests on 2–3 known tickers (AAPL, KO, a bank like JPM to confirm gross-margin handling).
2. **Single-company path** — given a CIK JSON, output the scorecard. Verify against the existing prototype.
3. **Universe ingest** — stream `companyfacts.zip`, compute metrics for every filer, write `results.json`. Handle missing tags, <10-year history, and non-operating filers gracefully (don't crash; mark fields null).
4. **Diff + alert** — compare to previous run, email new passers via the email API.
5. **GitHub Actions cron** — weekly schedule; commit/publish outputs; store the email key as a secret.
6. **Dashboard** — point the existing HTML at `results.json`.

## Caveats to bake in (not optional)
- This is a screen, not advice. A passing company means "open the 10-K," nothing more.
- Bulk data has tagging noise: banks/insurers lack a clean GrossProfit; some firms tag buybacks/dividends unusually; recent IPOs lack 10 years. These must degrade to null/"insufficient data", never a false pass/fail. Track and surface a `data_quality` flag per company.
- Always keep the tag-used audit per field so a borderline pass can be verified against the actual filing.
- Respect SEC fair access: declare a real User-Agent ("Name email") on any direct SEC fetch; the weekly bulk download is one request.

## Non-goals
- No valuation, price, or buy/sell logic.
- No live per-ticker SEC calls in the scheduled job (interactive per-ticker lookups can stay in the separate existing worker).
