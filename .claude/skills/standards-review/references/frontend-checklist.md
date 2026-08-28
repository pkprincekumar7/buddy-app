# Frontend checklist (React / TypeScript / Tailwind)

1. **`cn()` for composed classNames** — no manual template-literal class concatenation.
2. **No hardcoded colors** — raw hex/`rgba(...)` values replaced with the centralized
   CSS custom-property tokens in `src/index.css`. Two documented exceptions, not violations:
   `AVATAR_TEXT_COLOR` in `lib/gradientColors.ts` stays a plain literal because it's baked into a
   standalone `data:image/svg+xml` document (`lib/avatarUtils.ts`) that has no access to the parent
   page's CSS custom properties; each growth area's `hue` in `lib/growthAreaData.ts` stays raw
   because it's parsed numerically by `hueToHex()` and spliced into `rgba(${hue},N)` template
   strings, not read as a CSS value. Both have an explanatory comment at their definition.
3. **Tailwind arbitrary-value spaces escaped as `_`** — a literal space inside `[...]` silently
   breaks the utility with no build or type error. Grep for this specifically:
   `grep -rnoE 'className="[^"]*-\[[^]"]* [^]"]*\][^"]*"' src` and confirm any hit is intentional
   plain text, not a broken bracket value.
4. **No duplicated class strings/markup** — repeated Tailwind combinations or markup blocks
   extracted into a shared `@layer components` class or shared component.
5. **Grouped props over long flat lists** — related props (card/, invite link/, modal chrome/)
   bundled into nested objects once a component's prop surface grows large.
6. **File size / single responsibility** — large multi-concern files split into focused ones.
7. **No redundant editable surfaces** — content already edited/finalized upstream is displayed
   read-only downstream (e.g. in a share/export confirmation dialog), not re-editable in a second,
   disconnected place.
8. **React Query over hand-rolled fetch state** — `useQuery` preferred over manual
   `useState`/`useEffect`/`cancelled`-flag patterns for server data.
9. **No duplicated derived-state logic** — shared logic like viewport/media-query checks lives in
   one hook (`useMediaQuery`), not reimplemented per component.
10. **Single source of truth for shared state** — every consumer of an app-wide value (a
    preference toggle, auth session) reads it from the same shared context/hook. Flag any
    component holding its own local copy with its own default and its own one-off fetch of the
    same data — it will silently drift from the real value and from toggles made elsewhere.
    (This exact bug happened with a TTS mute preference: one component kept a disconnected local
    copy defaulting to "on" and never learned about the shared toggle.)
11. **Context scope** — a Context bundles only state whose consumers legitimately need to
    re-render together; unrelated concerns split into separate contexts.
12. **Logic extracted into hooks** — data fetching/timers/refs/cancellation flags inside a large
    component moved into a dedicated custom hook.
13. **No silently swallowed errors** — failed writes/mutations never end in an empty
    `.catch(() => {})`; surface via toast and log.
14. **Inert-but-real future-feature scaffolding** — if a feature (e.g. light mode) isn't ready,
    its plumbing can exist in code but must stay hidden from users: no visible toggle, no
    incomplete override block for values that don't exist yet.
15. **Accessibility** — new custom interactive elements have `role="button"` + `tabIndex={0}` +
    `onKeyDown`, or use `<button>`; new modals build on `ui/dialog.tsx` (Radix) rather than a
    hand-rolled `role="dialog"` div with no focus trap/restore; images keep meaningful `alt`
    text; every form input has a programmatically-associated label (`htmlFor`/`aria-label`/
    `aria-labelledby`), not just a placeholder; new color pairings meet WCAG AA contrast; heading
    levels stay in document order rather than being picked for font size.
16. **Test coverage** — flag missing tests on new critical-path code (auth, forms writing user
    data) as a real finding, same as backend — this codebase currently has zero test
    infrastructure.
17. **Form validation consistency** — no new hand-rolled `useState`-per-field form added without
    considering the existing (currently unused) `react-hook-form`/`zod`/`ui/form.tsx`
    infrastructure (`grep -rln "ui/form" src` — currently zero hits); error display stays to the
    two existing conventions (inline error string, or `sonner` toast) — no third pattern.
18. **Error boundary awareness** — new top-level providers/setup code in `App.tsx` outside
    `<AppShell />` is flagged as unprotected by the top-level boundary; a component that shouldn't
    be able to crash the whole app follows the `ModalErrorBoundary` scoped pattern
    (`GoalsDashboard.tsx`); new async failure paths always surface to the user (toast/inline),
    never just `console.error`.
19. **TypeScript strictness** — no new `any`, `as any`, `@ts-ignore`, or `@ts-expect-error`
    (`grep -rn ": any\|as any" src` and `grep -rn "@ts-ignore\|@ts-expect-error" src` should stay
    empty); catch-block `unknown` values are narrowed with `instanceof` (as in `apiError.ts`)
    rather than blindly cast with `as`; no non-null assertion (`!`) used to silence
    `noUncheckedIndexedAccess` — handle the `undefined` case instead.
20. **Design-system values registered in `tailwind.config.ts`, not repeated inline** — a value
    that belongs in the Tailwind theme (a font family, etc.) is added to `theme.extend` once and
    applied via `className`, not repeated as a raw `style={{...}}` value at every call site.
    `fontFamily: 'Orbitron, sans-serif'` / `'Rajdhani, sans-serif'` were both `@font-face`-declared
    in `index.css` but never added to `tailwind.config.ts`'s `theme.fontFamily` — so 84 call sites
    across 12 files repeated the raw string as an inline style instead of
    `className="font-orbitron"`/`"font-rajdhani"`. Check for a repeated non-color inline style
    value the same way item 2 checks for repeated raw colors: `grep -rn "fontFamily:" src`.
