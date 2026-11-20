// Merges the browser-test shards' raw coverage into one report (check.yml runs the
// Playwright suite in shards, each with COVERAGE_RAW=1), with the same settings a single
// run uses (coverage-options.mjs), so coverage/coverage-summary.json is what one unsharded
// run would write. Then e2e/coverage-floor.mjs checks it.
//
//   node e2e/coverage-merge.mjs RAW_DIR...     (each a shard's coverage/raw)
import { existsSync } from 'node:fs';
import { CoverageReport } from 'monocart-coverage-reports';
import { coverageOptions } from './coverage-options.mjs';

const dirs = process.argv.slice(2);
if (dirs.length === 0) {
  console.error("Usage: node e2e/coverage-merge.mjs RAW_DIR... (each shard's coverage/raw)");
  process.exit(1);
}
const missing = dirs.filter((dir) => !existsSync(dir));
if (missing.length > 0) {
  console.error(`No raw coverage in: ${missing.join(', ')}`);
  process.exit(1);
}

const options = coverageOptions();
await new CoverageReport({ name: 'Web UI tests', ...options, inputDir: dirs }).generate();
console.log(`Merged the coverage of ${dirs.length} shard(s) into coverage/.`);
