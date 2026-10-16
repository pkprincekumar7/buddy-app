# Frontend-app checklist (React Native / NativeWind)

`frontend-app/` is a phone-width port of `frontend/` — the web file is the spec. The RN-specific
rules come from `frontend-app/CLAUDE.md`. Run every grep from `frontend-app/`.

## Web parity

1. **Port parity** — a change to a web page/component/hook has its mobile counterpart updated
   (file map: web `pages/X.tsx` → `screens/X.tsx`; `components/**`, `hooks/**`, `lib/**`,
   `types/**` same path). For a pending-changes review, flag any `frontend/src/**` change in
   `git diff` whose mobile counterpart is untouched, unless the change is web-only (a `sm:`/`md:`/
   `lg:` breakpoint, browser-only API).
2. **`lib/` and `hooks/` stay verbatim copies** — they differ from the web only by minimal
   platform edits (imports, `lucide-react-native`, `css(...)` color wrapping, file uploads,
   storage). The two apps use different Prettier configs, so a raw `diff` is mostly formatting
   noise: copy the web file to a scratch dir, format it with this app's config
   (`npx prettier --config .prettierrc.js --write <copy>`), then `diff <copy> src/lib/<file>`.
   Flag any remaining difference that isn't a platform edit (copy, prompt text, data, or logic
   drift) — it breaks re-copying future web changes with a diff. Pure data files with no platform
   imports (e.g. `startJourneyPlans.ts`) should come out identical. `diff -rq ../frontend/src/lib
   src/lib` lists the candidates; files present on only one side (web-only `NavigationTracker.tsx`,
   app-only `classNames.ts`, `useVoiceRecognition.ts`…) are expected.
3. **Routes match web page names** — new screens are registered in `navigation/index.tsx` under
   the web route name, and code navigates through `@/lib/router` (`useNavigate`, `useParams`,
   `<Link to>`), not React Navigation's API directly.

## Theme & typography

4. **No hardcoded colors** — no hex/`rgba(...)` literal in a component. Use, in order: a
   `className` token, `color.x`, `rgb('x', a)` / `hsl('x', a)` / `edge(a)`, or `css('…')`.
   Colors the web writes inline go in `src/theme/tokens.mobile.js` once, by name.
   `grep -rnE "'#[0-9a-fA-F]{3,8}'|\"#[0-9a-fA-F]{3,8}\"|rgba?\([0-9]" src | grep -v "^src/theme/"`
   — hits inside comments that quote the web value are fine; flag the rest (including black
   shadow `rgba(0,0,0,…)` literals, which belong in a named shadow/`glow` recipe).
5. **Generated palette untouched** — `src/theme/tokens.generated.js` is never hand-edited.
   `yarn theme:sync && git diff --exit-code src/theme/tokens.generated.js` must be clean; a diff
   means either a hand edit or a web `index.css` change that wasn't synced.
6. **Custom fonts by exact family, never `fontWeight`** — weight comes from the family class
   (`font-rajdhani-semibold`, `font-orbitron-black`) or `font('rajdhani', 700)`; setting
   `fontWeight` alongside a custom font makes Android fake-bold it. Italic Playfair uses
   `SERIF_ITALIC`, never `fontStyle: 'italic'`. `grep -rn "fontWeight" src` and confirm each hit
   is on system-font text (no custom `fontFamily`/font class on that `Text`).
7. **`letterSpacing` in px** — web `em` spacing converted as `fontSize * em` (e.g. `11 * 0.22`),
   not copied as the bare `em` number.

## Layout & components

8. **Text only inside `<Text>`** — no bare strings in a `View`; `text-*`/`font-*` classes sit on
   the `Text`, not on a wrapping `View` (RN has no style inheritance).
9. **`Pressable` from `@/components/ui/pressable`** — never from `'react-native'` (NativeWind
   drops a function `style` when `className` is also set, silently losing gradients, glows and
   press feedback). `grep -rnE "import \{[^}]*\bPressable\b[^}]*\} from 'react-native'" src`
   should only hit `components/ui/pressable`.
10. **Overlays** — modals use `@/components/ui/dialog`; anything shown by conditional rendering
    (`{open && <X />}`: splashes, sheets, full-screen scenes) is wrapped in `<Portal>`, never a
    `<Modal visible>` (on iOS, unmounting a still-presented Modal swallows the next touch app-wide).
    No hand-rolled `absolute` overlays over the header. `grep -rln "<Modal\b" src` — every hit
    outside `ui/dialog.tsx` / `ui/portal.tsx` must be justified (a Modal that stays mounted and is
    toggled only through `visible`).
11. **Accessibility** — every `Pressable`/`Button` has `accessibilityRole="button"` and an
    `accessibilityLabel` (icon-only buttons especially); headings are
    `<Text accessibilityRole="header">`; `<Image>` has `accessibilityLabel`; every `TextInput` has
    `accessibilityLabel`; animations respect `useReducedMotion()` where the web honours
    `prefers-reduced-motion`; new color pairings meet WCAG AA contrast.
12. **Single-line `TextInput` sizing** — font-size-only class (`text-[16px]`), never `text-base`
    or `leading-*` (any lineHeight shifts the iOS baseline and clips descenders).
13. **Screens scroll themselves** — normal pages render inside `<PageScroll>`; full-viewport
    scenes render `<PageBackRow />` themselves. Forms sit in a `KeyboardAvoidingView`
    (`behavior="padding"` on iOS) or a ScrollView with `keyboardShouldPersistTaps="handled"`.
14. **Icons** — `lucide-react-native`, sized and colored by props (`size`, `color={color.x}`), not
    className. `grep -rn "from 'lucide-react'" src` must be empty.

## SVG & animation

15. **No looping animation on SVG props** — no `useAnimatedProps` driving a repeating animation
    on a `Path`/`Circle` inside an `<Svg>` (redraws the whole Svg in software on Android and
    re-runs every `<Filter>`; the hub spokes rendered at ~2 fps this way). Loop the layer view's
    `opacity`/`transform` instead (`personalityJourney/Spokes.tsx`, `SvgLayer.tsx`). One-off
    entrance animations in a filter-free Svg are fine. `grep -rln "useAnimatedProps" src` and
    check each hit is one-off, or filter-free. Keep `<Filter>` regions tight around the shape.
16. **Translucent SVG gradient stops** — use `{...stop(rgb('x', a))}` from
    `@/components/ui/svg-stop`; a translucent `stopColor={rgb('x', a)}` with `a < 1` renders
    opaque (react-native-svg drops the alpha). `grep -rn "stopColor=" src` — an opaque
    `rgb('x')` with no alpha is fine.
17. **Animation API** — framer-motion ports use Reanimated 4 and the `@/lib/animations` presets
    (`FADE_IN`, `PAGE_SLIDE`, `MODAL_SCALE`, `slideUp(...)`…) via `entering`/`exiting`; CSS
    keyframes become Reanimated CSS animations. Hoist `css('…')` gradient/shadow strings to
    module-level constants, not inline in render.

## Lifecycle, state & platform

18. **Unmount-safe screens** — only the top two stack pages stay mounted, so a screen two levels
    deep is unmounted and re-mounted later (`location.state.fromBack` set). Every timer, player,
    audio/TTS call and listener is cleaned up in an effect cleanup; anything that must survive a
    deep navigation lives in react-query, context or AsyncStorage, not component state.
19. **Platform services** — toasts from `@/lib/toast`; TTS via `speakText`/`stopSpeech`, gated on
    `useTts().ttsEnabled`; storage via AsyncStorage (`grep -rn "localStorage\|sessionStorage" src`
    must be empty); `/app-assets/*` via `${env.CDN_BASE_URL}`; pickers via `expo-image-picker`;
    clipboard/share/open-URL via `Share`/`Linking`. No web-only API (`window`, `document`,
    `onClick`) left over from a port:
    `grep -rnE "onClick=|\bdocument\.[a-zA-Z]|\bwindow\.[a-zA-Z]" src | grep -vE "^[^:]+:[0-9]+:\s*(//|\*|/\*)"`
    (the second grep drops comment lines) should be empty.
20. **Dark-only** — no light palette, no theme toggle, matching the web's `forcedTheme="dark"`.

## Shared with the web checklist

21. **General rules from `references/frontend-checklist.md` that apply unchanged** — React Query
    over hand-rolled fetch state (8), no duplicated derived-state logic (9), single source of truth
    for shared state (10), context scope (11), logic extracted into hooks (12), no silently
    swallowed errors (13), error-boundary awareness (18), and TypeScript strictness (19): no
    `any`/`as any`/`@ts-ignore`/`@ts-expect-error`, no `!` to silence `noUncheckedIndexedAccess`.
    Load that file and apply those items when the scope is `frontend-app`.
22. **Test coverage** — Jest + React Native Testing Library exist (`yarn test`, run in CI), but
    only a handful of tests (router, theme, portal, stack window…). Flag missing tests on new
    critical-path code (auth, forms writing user data, routing/stack behaviour) as a real finding.
