# frontend-app — Coding Standards (React Native)

React Native 0.85 (new architecture) + NativeWind v4 + React Navigation 7 (stack) + Reanimated 4 +
`@tanstack/react-query` + expo modules (video, font, speech-recognition, image-picker). This app is
a **phone-width port of the web app in `../frontend`** — same pages, same flows, same copy, same
colors. When a web page changes, port the change here; when in doubt about behaviour or styling,
the web file is the spec (read it at its small-screen breakpoint: ignore `sm:`/`md:`/`lg:` classes).

The general rules in `../frontend/CLAUDE.md` (data & state, a11y, error handling, TypeScript
strictness, no `any`/`!`/ts-ignore, toast on failed writes) apply here too. Below are the
RN-specific conventions.

## File map (web → mobile)

| web (`frontend/src`) | mobile (`frontend-app/src`) |
| --- | --- |
| `pages/X.tsx` | `screens/X.tsx` (default export, same name) |
| `components/**`, `hooks/**`, `lib/**`, `types/**` | same path |
| `components/ui/button.tsx`, `input`, `textarea`, `label`, `dialog` | same path, RN implementations |
| `Layout.tsx` | `components/layout/AppHeader.tsx` (stack header) + `PageBackRow` / `PageScroll` |
| `App.tsx` routes | `navigation/index.tsx` |
| `index.css` tokens | `theme/tokens.generated.js` (generated) via `theme/index.ts` + `tailwind.config.js` |

Data/prompt/hook files under `lib/` and `hooks/` are copied from the web **verbatim** — keep them
identical apart from the minimal platform edits (imports, file uploads), so future web changes can
be re-copied with a diff.

## Theme & colors — never hardcode

- The palette is generated from the web: `yarn theme:sync` reads `../frontend/src/index.css` and
  writes `src/theme/tokens.generated.js`. Never edit that file, and never type a hex/rgba value
  in a component. Colors the web itself writes inline (not as a `--x-rgb` var) go in
  `src/theme/tokens.mobile.js` once, by name.
- In order of preference:
  1. **className** — Tailwind names match the web one-for-one (`bg-background`,
     `text-muted-foreground`, `bg-primary-action`, `bg-surface-elevated`, `text-success-bright`…).
     Every web `--x-rgb` token is a plain color: web `text-[rgb(var(--constellation-cyan-rgb))]`
     → `text-constellation-cyan`, `bg-[rgb(var(--whatsapp-bright-rgb)_/_.2)]` →
     `bg-whatsapp-bright/20`.
  2. `color.x` from `@/theme` for color props (`<Icon color={color.primary} />`,
     `placeholderTextColor`, SVG `fill`).
  3. `rgb('constellation-cyan', 0.7)` / `hsl('primary', 0.2)` / `edge(0.08)` — web
     `rgb(var(--constellation-cyan-rgb) / .7)` / `hsl(var(--primary) / .2)` /
     `rgb(var(--edge-rgb) / .08)`.
  4. `css('…')` — paste a web gradient/shadow string verbatim; every `rgb(var(--x-rgb) / a)`,
     `hsl(var(--x) / a)` and `var(--bg-deep-1)` inside it is resolved:
     `boxShadow: css('0 0 16px rgb(var(--constellation-cyan-rgb) / .7)')`,
     `experimental_backgroundImage: css('linear-gradient(180deg, rgb(var(--x-rgb) / .2), transparent)')`.
     Hoist these to module-level constants, not inline in render.
- Web utility classes that are NOT plain Tailwind on RN:
  - `.border-edge*` → `border border-edge*` (RN needs the explicit `border` width class).
    `.border-b-edge` → `border-b border-edge`, etc.
  - `.bg-ghost*` → `bg-ghost*` (same names). `.bg-subtle` → **`bg-subtle-tint`** (`bg-subtle` is
    the subtle-foreground *text* color). `.bg-na-dim` → `bg-na-dim`. `.bg-overlay` → `bg-overlay`.
  - `.card-surface` → `rounded-2xl border border-edge bg-card p-6`.
  - `.form-input` → `w-full rounded-lg border border-edge-md bg-surface-input px-3 py-2 text-foreground`.
  - `.btn-primary`, `.btn-secondary`, `.btn-start-over`, `.chat-input-bar`, `.onboarding-input-pill`,
    `.orb-ring` → `style={recipe.x}` from `@/theme`. `.glow-*` → `style={{ boxShadow: glow.x }}`.
    `.orb-cyan-gradient`, `.bg-deep-navy-gradient`, `.bg-image-scrim`, `.chat-bar-panel`,
    `.onboarding-intro-veil`, `.onboarding-bg-glow`, `.orb-main`, `.orb-ambient` →
    `experimental_backgroundImage: gradient.x`.
  - `bg-gradient-to-r from-x to-y` → `experimental_backgroundImage: css('linear-gradient(to right, hsl(var(--x)), hsl(var(--y)))')`.
  - `backdrop-blur-*` has no RN equivalent — drop it (keep the translucent background).
- The app is **dark-only**, exactly like the web (`forcedTheme="dark"`). No light palette, no toggle.

## Typography

- Fonts are the web's own files (`assets/fonts`, loaded in `App.tsx`). RN resolves a custom font
  by its exact per-weight family, so map web family + weight → one class/style and **never also
  set `fontWeight`** (Android would fake-bold it):
  - `font-orbitron` (700/800) → `font-orbitron`; Orbitron 900 / `font-black` → `font-orbitron-black`
  - `font-rajdhani` 500 → `font-rajdhani`; 600 → `font-rajdhani-semibold`; 700+ → `font-rajdhani-bold`
  - or `style={font('rajdhani', 700)}` from `@/theme`.
  - `font-barlow` has no font file on the web either — drop it (system sans).
- `letterSpacing` is in px on RN: web `.22em` at 11px → `letterSpacing: 11 * 0.22`.
- rem is 16px (metro `inlineRem: 16`), so `p-4`, `text-sm`, `h-9`… are the same pixels as the web.

## Layout & components

- **No style inheritance.** `text-*`/`font-*` on a `View` does nothing — put them on the `Text`.
  Every string must be inside `<Text>`. (`<Button>` routes text classes from its `className` to
  its label automatically; plain Views don't.)
- Flexbox defaults differ: RN `View` is `flex-col` and `items-stretch`; `flex-row` must be explicit.
  `space-y-*`/`space-x-*` → `gap-*`. `grid` → `flex-row flex-wrap` with widths. `inline-flex` → `flex-row self-start`.
  `hidden sm:block` → just don't render. `fixed inset-0` → `absolute inset-0` in the screen root
  (or a `Modal` for overlays above the header).
- `onClick` → `onPress`; `<button>` → `Pressable` (or `Button`) with `accessibilityRole="button"`
  and `accessibilityLabel`; `aria-*` → `accessibility*`; `<img alt>` → `<Image accessibilityLabel>`;
  `<h1..h6>` → `<Text accessibilityRole="header">`; inputs get `accessibilityLabel`.
- Icons: `lucide-react` → `lucide-react-native`, sized/colored by props
  (`<Mail size={16} color={color['muted-foreground']} />`), not className.
- Inline SVG → `react-native-svg` (`<Svg><Path/></Svg>`, same `d`/`viewBox`). SVG gradients →
  `<Defs><LinearGradient>`.
- Scrolling: a web page scrolls the document; a screen must scroll itself. Wrap normal pages in
  `<PageScroll>` (`@/components/layout/PageScroll` — it renders the Layout's Back row first).
  Full-viewport scenes render `<PageBackRow />` themselves. Login/Register/NotFound have no Layout.
- Modals: use `@/components/ui/dialog` (RN `Modal` toggled by `visible={open}`: Android back +
  a11y modal for free). For any overlay its parent shows by conditional rendering
  (`{open && <Splash />}`) — splashes, sheets, full-screen scenes — wrap it in `<Portal>`
  (`@/components/ui/portal`), never `<Modal visible>`: on iOS, unmounting a still-presented Modal
  swallows the next touch anywhere in the app. Don't hand-roll overlays with `absolute` views
  over the header.
- Single-line `TextInput`s take a font-size-only class (`text-[16px]`), never `text-base`/`leading-*`:
  any lineHeight on a single-line iOS TextInput shifts the baseline and clips descenders.
- Pressables: import `Pressable` from `@/components/ui/pressable`, never from 'react-native' —
  NativeWind drops a function `style={({ pressed }) => …}` when `className` is also set, which
  silently loses gradients, glows and press feedback.
- Never run a *looping* animation on props inside an `<Svg>` (`useAnimatedProps` on a
  Path/Circle). Any changed prop redraws the whole Svg, in software on Android, and re-runs every
  `<Filter>` in it. The hub spokes did this and rendered at ~2 fps. Draw the SVG once in its own
  layer and loop the layer view's `opacity`/`transform` instead (see
  `personalityJourney/Spokes.tsx`, `SvgLayer.tsx`). One-off entrance animations are fine in a
  filter-free Svg. Keep `<Filter>` regions tight around the shape, not the whole viewBox.
- SVG gradient stops: `<Stop offset="0%" {...stop(rgb('x', 0.2))} />` (`@/components/ui/svg-stop`).
  react-native-svg discards the alpha of an `rgba()` stopColor, so a translucent stop renders
  opaque unless its alpha is moved into `stopOpacity`.
- Keyboard: forms inside `KeyboardAvoidingView` (`behavior="padding"` on iOS) or a ScrollView with
  `keyboardShouldPersistTaps="handled"`.

## Routing

`@/lib/router` re-implements react-router's API on React Navigation, so ported code keeps its
calls: `useNavigate()` (`navigate('/GrowthAreas/abc')`, `navigate(-1)`,
`navigate('/Home', { replace: true })`, `navigate('/Onboarding', { state: { forceNew: true } })`),
`useParams()` (`{ childId, sub }`), `useLocation()` (`pathname`, `search`, `state`),
`useSearchParams()`, `<Link to>`, `<Navigate to>`. Routes are the web page names
(`navigation/index.tsx`). Auth redirects are implicit: the navigator swaps screen sets when
`isAuthenticated`/`user.role` changes, so `navigate('/Login')` while signed in is a no-op.

Only the top two stack pages stay rendered (`navigation/withStackWindow.tsx`), like the web,
which keeps a single page mounted. A page two or more levels deep is unmounted; its route stays
in the history, and it re-mounts when it is focused again, with `location.state.fromBack` set so
its stage splash is skipped. So a page must not rely on staying mounted while it's covered.
Clean up every timer, player and listener on unmount, and keep anything that must survive a
deep navigation in react-query, context or AsyncStorage, not in component state.

## Animation

- framer-motion → Reanimated 4. Presets in `@/lib/animations` mirror the web's
  (`FADE_IN`, `PAGE_SLIDE`, `MODAL_BACKDROP`, `MODAL_SCALE`, `slideUp(delay, duration)`, `SPINNER`)
  and spread onto `Animated.View` (`entering`/`exiting`; no `AnimatePresence` needed — `exiting`
  plays on unmount).
- `animate={{...}}` driven by state → Reanimated CSS transitions on the style
  (`transitionProperty`, `transitionDuration`) or `useSharedValue` + `withTiming`.
- CSS `@keyframes` / `animate-spin` / `animate-pulse` → Reanimated CSS animations
  (`animationName`, `animationDuration`, `animationIterationCount: 'infinite'`).
- Respect reduced motion (`useReducedMotion()`) where the web honours `prefers-reduced-motion`.

## Platform services

- Toasts: `import { toast } from '@/lib/toast'` — same API as `sonner`.
- TTS: `speakText(text, { onDone })` / `stopSpeech()` from `@/lib/tts` (web `speechSynthesis`).
  Only speak when `useTts().ttsEnabled`.
- Voice input: `VoiceInput`, `InputWithVoice`, `TextareaWithVoice`, `ChatInputBar` or
  `useVoiceRecognition()`. Ambient bed: `useAmbientAudio()`. Sounds/videos: `expo-video`.
- Images/videos served from `/app-assets/*` on the web → `${env.CDN_BASE_URL}/app-assets/*`.
- File/photo pickers (web `<input type="file">`) → `expo-image-picker`; uploads take a local URI
  (`api.entities.Child.uploadAvatar(id, uri, mimeType)`, `useNinetyDayPlan().addPhotos(key, assets)`).
- `localStorage`/`sessionStorage` → `@react-native-async-storage/async-storage`.
- Clipboard / share / open URL → RN `Share` API and `Linking`.

## Commands

```
yarn typecheck     # tsc --noEmit
yarn lint          # eslint
yarn test          # jest
yarn theme:sync    # regenerate src/theme/tokens.generated.js from ../frontend/src/index.css
yarn ios / yarn android
```
