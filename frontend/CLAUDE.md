# frontend — Coding Standards

React 19 + Vite + TypeScript + Tailwind CSS 3 + shadcn/radix-ui + `@tanstack/react-query` +
`next-themes`. These are the standards to follow when writing or editing code in this directory.
They were distilled from an explicit best-practices review of this codebase; see
`.claude/skills/standards-review/SKILL.md` for the on-demand audit that checks a file against
this same list.

## Tailwind & styling

- Use `cn()` (from `@/lib/utils`) for conditional/composed `className` strings — never manual
  template-literal concatenation (`` `foo ${bar ? 'a' : 'b'}` ``).
- Never hardcode raw color values (hex, `rgba(...)`) inline. Use the centralized CSS
  custom-property tokens declared in `src/index.css` (e.g. `rgb(var(--constellation-gold-rgb))`)
  so a future palette or theme change is a one-file edit, not a repo-wide search.
- Tailwind arbitrary-value brackets (`className="border-[...]"`) **cannot contain a literal
  space** — escape it as `_` (e.g. `border-[rgb(var(--x-rgb)_/_.2)]`). A raw space silently
  splits the class into invalid tokens with no build-time or type-time error — this has caused a
  real, hard-to-spot bug here before.
- When the same combination of Tailwind classes (or the same block of markup) repeats across a
  file or multiple files, extract it into a shared `@layer components` class (see `.card-surface`
  in `index.css`) or a shared component — don't copy-paste it.

## Components & props

- Once a component's prop list grows large and prop names naturally cluster (e.g. everything
  about "the card", "the invite link", "modal chrome"), group them into nested objects instead of
  a long flat list of individually-named props.
- Once a page or component file grows very large or covers multiple unrelated concerns, split it
  into smaller, focused files (see the `Connect.tsx` → `components/connect/*` split).
- Avoid redundant editable surfaces for the same content: once something has been edited/finalized
  at one step in a flow, a later step that only needs to *display* it for confirmation (e.g. a
  share/export dialog) should render it read-only, not offer a second, disconnected place to edit
  the same text.

## Data & state

- Prefer `@tanstack/react-query`'s `useQuery` over hand-rolled `useState` + `useEffect` + a manual
  `cancelled`-flag fetch pattern — it handles request cancellation/races and caching for you.
- Don't reimplement the same derived-state logic (e.g. a viewport/media-query check) separately in
  multiple components — extract one shared hook (`useMediaQuery`) and use it everywhere.
- When a value is meant to be shared app-wide (a user preference/toggle, auth session, etc.),
  every consumer must read it from the same shared context/hook. Never let a component keep its
  own disconnected local copy with its own default and its own one-off fetch — it will silently
  drift out of sync with the real value and with any toggle made elsewhere in the app.
- A React Context should only bundle state whose consumers legitimately need to re-render
  together. Split unrelated concerns into separate contexts (e.g. auth session vs. a TTS toggle)
  rather than growing one context to cover everything.
- Business/data logic embedded in a large component (data fetching, timers, refs, cancellation
  flags) should be extracted into a dedicated custom hook.
- Never silently swallow a failed write/mutation with an empty `.catch(() => {})` — surface it to
  the user (toast) and log it.

## Theming

- If a feature anticipates something not ready yet (e.g. light mode, before colors are
  finalized), the plumbing can exist in code — provider wired, tokens structured for it — but
  must stay inert and hidden from users: no visible toggle, and no incomplete `.class` override
  block for values that don't exist yet.

## Accessibility

- Custom non-native interactive elements consistently pair `role="button"` + `tabIndex={0}` + an
  `onKeyDown` handler for Enter/Space (see `InstagramModal.tsx`, `TwitterModal.tsx`,
  `AccomplishmentCards.tsx`, `Observations.tsx`, `Connect.tsx`). Never add a clickable `div`/`span`
  without all three — or use a native `<button>` instead, which needs none of them.
- Prefer the existing `src/components/ui/dialog.tsx` (Radix) wrapper for any new modal/dialog — it
  gives focus-trap and focus-return for free. It's currently used in only two places
  (`AdminAllowedEmails.tsx`, and internally by `command.tsx`); every other modal in the app
  (`ActivityModal.tsx`, `ProgressInsightsModal.tsx`, `StartOverButton.tsx`, `GrowthAreaSheet.tsx`,
  `connect/shared.tsx`, `Layout.tsx`'s profile panel) is hand-rolled with a manual
  `document.addEventListener('keydown', ...)` for Escape and traps/restores focus nowhere. Don't
  add another hand-rolled modal — build new ones on `ui/dialog.tsx` instead of copying the
  hand-rolled pattern.
- Images already carry meaningful `alt` text everywhere they appear in this codebase — keep that
  up for any new `<img>`.
- Every form input needs a programmatically-associated label — `<label htmlFor="id">` matching
  the input's `id`, or `aria-labelledby`/`aria-label` when a visible `<label>` isn't used. A
  placeholder alone is not a label (it disappears on input and isn't reliably announced by screen
  readers). Check this explicitly on any new form field, not just the existing hand-rolled forms
  in `Login.tsx`/`Register.tsx`/onboarding.
- Don't introduce a new text/background color pairing without checking contrast against WCAG AA
  (4.5:1 for normal text, 3:1 for large text) — this matters especially for anything using the
  custom CSS-variable color tokens in `src/index.css` at partial opacity, since a token that reads
  fine at full opacity can fail contrast once alpha is reduced.
- Keep heading levels (`<h1>`–`<h6>`) in document order per page/section — don't pick a heading
  level for its font size. Use Tailwind classes for visual sizing and reserve the heading tag
  itself for actual document structure.

## Testing

- There is currently zero test infrastructure in this codebase — no vitest/jest/testing-library/
  playwright, no `test` script in `package.json`, no `*.test.tsx`/`*.spec.tsx` files anywhere.
  Treat this as a known, flaggable gap rather than assuming coverage exists: when reviewing new
  code on a critical path (auth, forms that write user data, payment/limit flows), flag missing
  test coverage as a real finding, the same way the backend checklist does.

## Form validation

- `src/components/ui/form.tsx` (the shadcn wrapper around `react-hook-form`) and `zod`/
  `@hookform/resolvers` are already dependencies but effectively unused for forms today —
  `ui/form` is imported by zero files, and `zod` is used only once, for env-var validation in
  `src/lib/env.ts`. Every real form (`Login.tsx`, `Register.tsx`, `AdminAllowedEmails.tsx`,
  `ChildProfileStep.tsx`, `Observations.tsx`) is hand-rolled with per-field `useState` and its own
  duplicated error-string state.
- Don't add a sixth hand-rolled form. When a new form has more than a couple of fields or needs
  cross-field validation, wire it through the existing `react-hook-form` + `zod` infrastructure in
  `ui/form.tsx` rather than adding another one-off `useState`-per-field implementation.
- Surface validation/submission errors via the existing conventions only: an inline `error` string
  near the field for form-level errors (as in `Login.tsx`), or a `sonner` `toast.error(...)` for
  request-level failures. Don't introduce a third error-display pattern.

## Error boundaries & async error handling

- A top-level class-based Error Boundary in `src/App.tsx` wraps `<AppShell />` and renders a
  friendly fallback with a retry button on any render-time throw. A throw outside that boundary
  (inside `AppThemeProvider`, `QueryClientProvider`, `Router`, or `AuthProvider` setup in
  `App.tsx`) is **not** caught and will hard-crash the whole app. Be aware of this boundary when
  adding new top-level providers or setup code — don't assume everything above `<AppShell />` is
  protected.
- For a component/page whose crash shouldn't take down the whole app (an isolated modal or
  widget), follow the `ModalErrorBoundary` pattern in `src/pages/GoalsDashboard.tsx` — a scoped
  boundary around just that region — rather than relying solely on the top-level one.
- Error Boundaries never catch promise rejections/async errors — those must be handled
  per-call-site with `try/catch` and surfaced via `toast.error(...)` or inline error state (see
  Form validation above). Don't let a new async failure path only get `console.error`'d with no
  user-facing surfacing (an existing gap in `useGoalPlan.ts` on init failure) — always surface
  something to the user, not just log.

## TypeScript strictness

- `tsconfig.app.json` is intentionally strict (`strict`, `noImplicitAny`, `strictNullChecks`,
  `noUnusedLocals`/`noUnusedParameters`, `noFallthroughCasesInSwitch`, and
  `noUncheckedIndexedAccess`), and there are currently zero `: any`, `as any`, `@ts-ignore`, or
  `@ts-expect-error` occurrences anywhere in `src`. Keep it that way — never reach for `any` or a
  ts-ignore/expect-error comment as a shortcut past a type error; fix the underlying type instead.
- Catch blocks type their variable as `unknown` under `strict`, but most existing call sites
  blindly cast it (`e as Error | undefined`, `e as { status?: number; detail?: unknown }`, etc. —
  see `Login.tsx`, `Register.tsx`, `AuthContext.tsx`, `useJob.ts`) instead of narrowing with a
  runtime check. Prefer the `instanceof Error`/`instanceof ApiError` pattern already established
  in `src/lib/apiError.ts` over an unchecked `as` cast on an `unknown` catch variable or on
  loosely-typed API payloads/`location.state`.
- With `noUncheckedIndexedAccess` on, array/object index access is typed as possibly `undefined` —
  don't reach for the non-null assertion operator (`!`) to silence that; it's the same unsafe
  escape hatch as `as any` with a different spelling; handle the `undefined` case (optional
  chaining, a default, or an explicit check) instead.
