// The browser tests' coverage settings, in one place for both their users:
// playwright.config.ts (monocart-reporter, every run with COVERAGE=1) and
// e2e/coverage-merge.mjs (check.yml merges the shards' raw coverage into one report).
// Plain JS, so node runs the merge script without a TypeScript step; types in the .d.mts.

/** The Vite dev server's port for the browser tests. */
export const E2E_PORT = 5288;

/**
 * The monocart coverage options. `raw` adds the raw V8 data (coverage/raw), which a sharded
 * run writes so the shards can be merged with the same settings.
 * @param {{ raw?: boolean }} [options]
 */
export function coverageOptions({ raw = false } = {}) {
  return {
    outputDir: './coverage',
    // One self-contained HTML file: otherwise its scripts land in ./assets, outside it.
    inline: true,
    entryFilter: (entry) =>
      entry.url.includes(`127.0.0.1:${E2E_PORT}/src/`) && !entry.url.includes('/node_modules/'),
    // Vite's dev source maps name a source by its file name alone ("account.ts"), so
    // put it back in its module's folder, then keep the app's own code.
    sourcePath: (file, info) => {
      const dir = (info.distFile ?? '').replace(/^.*?\/src\//, 'src/').replace(/[^/]*$/, '');
      return file.includes('/') ? file : `${dir}${file}`;
    },
    sourceFilter: (path) => !path.includes('node_modules'),
    outputFilter: (file) =>
      file.sourcePath.startsWith('src/') &&
      !/^src\/(api\/generated|components\/ui|test)\//.test(file.sourcePath),
    // Count the files no test loads too (as 0%), so the number isn't flattered. They're
    // TypeScript, so Vite's own transform makes them parseable.
    all: {
      dir: ['./src'],
      filter: (path) =>
        /\.(ts|tsx)$/.test(path) &&
        !/(\.test\.|\.d\.ts$|\/test\/|\/api\/generated\/|\/components\/ui\/)/.test(path),
      transformer: async (entry) => {
        const { transformWithOxc } = await import('vite');
        const out = await transformWithOxc(entry.source, entry.url, { sourcemap: true });
        entry.source = out.code;
        entry.sourceMap = out.map;
      },
    },
    reports: ['v8', 'console-summary', 'json-summary', ...(raw ? ['raw'] : [])],
  };
}
