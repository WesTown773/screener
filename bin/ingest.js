#!/usr/bin/env node
'use strict';

/**
 * Two-step ingest pipeline:
 *
 *   Step 1 — download (once):
 *     node bin/ingest.js --download
 *     node bin/ingest.js --download --force          # re-download even if cached
 *     node bin/ingest.js --download --zip data/companyfacts.zip
 *
 *   Step 2 — process (reads the local zip):
 *     node bin/ingest.js --process
 *     node bin/ingest.js --process --zip data/companyfacts.zip --out data/
 *     node bin/ingest.js --process --threshold 8
 *     node bin/ingest.js --process --limit 500       # smoke-test first 500 companies
 *
 *   Combined (download if missing, then process):
 *     node bin/ingest.js --download --process
 */

const { downloadZip, ingest, BULK_URL, DEFAULT_ZIP_PATH } = require('../src/ingest');

const args = process.argv.slice(2);
function flag(name) { const i = args.indexOf(name); return i !== -1 ? args[i + 1] : null; }
const has = (name) => args.includes(name);

const doDownload = has('--download');
const doProcess  = has('--process');
const forceDownload = has('--force');
const zipPath    = flag('--zip')       ?? DEFAULT_ZIP_PATH;
const outDir     = flag('--out')       ?? 'data';
const limit      = flag('--limit')     ? parseInt(flag('--limit'), 10) : Infinity;
const threshold  = flag('--threshold') ? parseInt(flag('--threshold'), 10) : undefined;
const maxFy      = flag('--max-fy')    ? parseInt(flag('--max-fy'), 10) : 2025;

if (!doDownload && !doProcess) {
  console.error([
    'Usage:',
    '  node bin/ingest.js --download [--force] [--zip <path>]',
    '  node bin/ingest.js --process  [--zip <path>] [--out <dir>] [--threshold N] [--limit N] [--max-fy YYYY]',
    '  node bin/ingest.js --download --process',
  ].join('\n'));
  process.exit(1);
}

async function main() {
  // ── Download step ────────────────────────────────────────────────────────
  if (doDownload) {
    let lastLog = 0;
    const { dest, downloaded } = await downloadZip({
      dest: zipPath,
      force: forceDownload,
      onProgress(bytes) {
        const now = Date.now();
        if (now - lastLog > 5000) {
          process.stderr.write(`  Downloaded ${(bytes / 1e6).toFixed(0)} MB…\n`);
          lastLog = now;
        }
      },
    });

    if (downloaded) {
      console.error(`Downloaded → ${dest}`);
    } else {
      console.error(`Zip already cached at ${dest} (use --force to re-download)`);
    }
  }

  // ── Process step ─────────────────────────────────────────────────────────
  if (doProcess) {
    console.error(`\nProcessing ${zipPath}`);
    console.error(`  Out dir      : ${outDir}`);
    console.error(`  Max FY       : ${maxFy}`);
    console.error(`  Pass threshold: ${threshold ?? process.env.PASS_THRESHOLD ?? 10}`);
    if (limit !== Infinity) console.error(`  Limit        : ${limit}`);
    console.error('');

    const start = Date.now();
    let lastLog = 0;

    const { processed, passed, errors } = await ingest({
      zipPath,
      outDir,
      passThreshold: threshold,
      maxFiscalYear: maxFy,
      limit,
      onProgress({ processed, passed, errors, name }) {
        const now = Date.now();
        if (processed % 500 === 0 || now - lastLog > 10000) {
          const elapsed = ((now - start) / 1000).toFixed(0);
          process.stderr.write(
            `[${elapsed}s] processed=${processed} passed=${passed} errors=${errors} last="${name}"\n`,
          );
          lastLog = now;
        }
      },
    });

    const elapsed = ((Date.now() - start) / 1000).toFixed(1);
    console.error(`\nDone in ${elapsed}s — processed=${processed} passed=${passed} errors=${errors}`);
    console.error(`Written: ${outDir}/results.json  ${outDir}/passers.json`);
  }
}

main().catch((err) => {
  console.error('Fatal error:', err.message);
  process.exit(1);
});
