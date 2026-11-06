// Node's fs and path, typed just enough here: the app's tsconfig keeps Node's types
// out of app code (`types: ["jest"]`), and jest runs this in Node.
const fs = require('fs') as {
  readdirSync(
    dir: string,
    options: { withFileTypes: true },
  ): { name: string; isDirectory(): boolean }[];
  readFileSync(file: string, encoding: 'utf8'): string;
};
// This file's folder, from CommonJS (jest).
declare const __dirname: string;
const path = require('path') as {
  join(...parts: string[]): string;
  relative(from: string, to: string): string;
};

// Build plan 7.9: neither app calls a path the split removed. A string literal that
// starts with one of them (with or without /api/v1) is a call to it; asset paths such
// as `../../assets/audio/…` don't start with one, so they don't match.
const REMOVED =
  /['"`](?:\/api\/v1)?\/(?:user|admin|jobs|llm|audio)(?:[/?'"`]|\$\{)/;

function sources(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      return ['generated', '__tests__', 'node_modules'].includes(entry.name)
        ? []
        : sources(full);
    }
    return /\.(ts|tsx)$/.test(entry.name) ? [full] : [];
  });
}

describe('removed API paths (build plan 7.9)', () => {
  const apps = {
    mobile: path.join(__dirname, '..'),
    web: path.join(__dirname, '../../../frontend/src'),
  };

  it.each(Object.entries(apps))('the %s app calls none of them', (_, dir) => {
    const files = sources(dir);
    expect(files.length).toBeGreaterThan(50); // the scan really read the app
    const calls = files.flatMap(file =>
      fs
        .readFileSync(file, 'utf8')
        .split('\n')
        .flatMap((line, i) =>
          REMOVED.test(line) ? [`${path.relative(dir, file)}:${i + 1}`] : [],
        ),
    );
    expect(calls).toEqual([]);
  });

  it('catches a call to one', () => {
    expect(REMOVED.test("request('/jobs', {")).toBe(true);
    expect(REMOVED.test('request(`/user/observations?child_id=${id}`)')).toBe(
      true,
    );
    expect(REMOVED.test("fetch('/api/v1/audio/transcribe')")).toBe(true);
    expect(REMOVED.test("require('../../assets/audio/orb-voice.mp3')")).toBe(
      false,
    );
    expect(REMOVED.test("'/api/v1/users/me/profile'")).toBe(false);
  });
});
