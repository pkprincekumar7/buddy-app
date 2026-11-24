// The coverage ratchet (docs/web-ui-test-plan.md, section 10): after
// `npm run test:e2e:coverage`, fail when the lines the browser tests run in src/ fall below
// the floor. Raise FLOOR when coverage rises (a ratchet only goes up); never lower it to
// make a change pass: add the tests the change needs.
import { readFileSync } from 'node:fs';

// From coverage-summary.json, which counts lines its own way (the console table shows ~2 points more).
const FLOOR = 90;
const summary = JSON.parse(
  readFileSync(new URL('../coverage/coverage-summary.json', import.meta.url), 'utf8'),
);
const lines = summary.total?.lines?.pct;
if (typeof lines !== 'number') {
  console.error('No coverage summary: run npm run test:e2e:coverage first.');
  process.exit(1);
}
console.log(`Browser-test coverage: ${lines}% of lines (floor ${FLOOR}%).`);
if (lines < FLOOR) {
  console.error(
    `Below the floor: add tests for what changed (open coverage/index.html for the gaps).`,
  );
  process.exit(1);
}
