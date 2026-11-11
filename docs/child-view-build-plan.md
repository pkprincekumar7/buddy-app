# Child view: build plan

**Status:** not started.
**What this is:** the order in which to build **multiple children** (a "+ Add Child" item in the
profile menu, and switching between children) and a **child view**: a mode a signed-in parent
switches to from the profile button, in which each circle opens a child-friendly page instead of
the parent's. It adapts the design prototype *Superpower version, 4th November* (a bundled HTML file,
not in this repo) to this application. Each task is one PR. Tick its box when the PR is merged,
and update the progress table.
**Starting point:** parent view as it is today. Children have no logins; they're records the
parent owns (children service, at most 10 per parent). The backend already supports several
children, but both Home pages hide the children section (`{false && …}` on web,
`SHOW_CHILDREN_SECTION = false` on mobile), so the apps only ever use the newest child. Nothing
stores stars, quests, mini-game results or moods yet.

---

## How to use this file

- **One task = one PR.** Each task lists what it delivers, what it needs first, and how it's
  checked.
- **Ticking:** `- [ ]` → `- [x]` when the PR is merged; add the PR link after the title. A task in
  progress gets *(in progress)* after its title.
- **Order:** a task may start once everything in its **Needs** line is ticked. Tasks marked
  *parallel* can run alongside their neighbours.
- **Web and mobile:** there's no shared JS package. `frontend-app` is a manual port of `frontend`
  (`frontend-app/CLAUDE.md` has the file map), so every client task lands in both apps, in the
  same PR unless it says otherwise.
- **Every PR:**
  - includes its tests and runs the narrow checks in **Check**. The full `./check.sh` runs at each
    phase gate, or when asked;
  - updates `backend/openapi/*.json` and regenerates the typed clients
    (`node scripts/sync-api-clients.mjs`) when it changes an endpoint;
  - follows **Theming** (below) for any client code: no colour, font, shadow or gradient literal
    in a component; a colour that isn't a token yet is added to `index.css` first;
  - updates this file if the implementation has to differ from it.
- **Phase gates:** at the end of each phase, run the gate check and stop for a review.

## Progress

| Phase | What | Tasks | Done |
|---|---|---|---|
| 0 | Multiple children: + Add Child and switching | 3 | 0 |
| P | Decisions | 4 | 0 |
| 1 | View mode, profile menu and route guard | 4 | 0 |
| 2 | Kids theme, kids page shell, Release and Discover | 7 | 0 |
| 3 | Transform quests and Grow worlds | 6 | 0 |
| 4 | Connect, hardening and launch | 4 | 0 |
| | **Total** | **28** | **0** |

Phase 0 doesn't depend on the decisions or on child view, and can ship on its own first.

---

## How the design works

```
Profile button ─► menu: parent ("sees everything")
                        each child ("Child · age N")
       │ pick one
       ▼
view = parent | child (with that child), kept on the device
       │
Hub, the circles ─ a tap opens:
  parent view → today's pages: PersonalityProfile, GrowthAreas, LifePathway, Connect, Observations
  child view  → the kids page at that circle: discover, grow, transform, connect, release
```

- The button shows the name, and under it **"Parent view"** or **"Child view"**.
- The hub looks the same in both views; only the destination of each circle changes. In child
  view the Discover reveal has no "Continue" button.
- The kids page is one page with five tabs, a star counter, read-aloud, confetti and short toasts:

| Circle | What the child does | What's kept |
|---|---|---|
| Discover | Seven "powers" around the avatar, each with a level of 3–5. A tap flips one (+1 star) and opens a mini game (tap the light, find the planets, tap in order, draw, climb, hold to grow, pop bubbles); the best time is kept. "Try this today" gives +1 star once a day; flipping all seven gives a badge (+3). | flipped powers, stars, awards, best times |
| Transform | Pick an interest (football, drawing, music…); each has 3 quests, and the child logs how often they did each. The default interest is the one the parent chose in their Transform plan. | quest counts with dates, picked interests |
| Grow | Six worlds (Life Ambition, Self Care, Critical Thinking, Creativity, Physical Wellness, Social Skills), each three quick games (tap, sort, catch, timing) giving a score. | each world's runs: total and per-game scores |
| Connect | Pick a win and send it. | nothing |
| Release | "How do you feel today?": five moods, an optional note, and a daily streak. | the mood for each day, the note |

**The child's activity shows in parent view:** the parent's Transform page shows the child's
quest counts ("every number here came from something he actually did"), and the parent's Growth
page shows the latest world scores with "Build on" and "Support" suggestions. The prototype keeps
all of this in the browser's storage on one device; here it's kept on the server, with the
service that owns each circle.

## What changes, in one place

| Area | Today | With child view |
|---|---|---|
| Profile menu ([Layout.tsx](../frontend/src/Layout.tsx), [AppHeader.tsx](../frontend-app/src/components/layout/AppHeader.tsx)) | Home, Account settings, Sign out | Each child (to open in parent view, or hand over in child view), "+ Add Child", then Home, Account settings, Sign out; the view label under the name. In child view: only "Back to parent view". |
| Current child | The `:childId` route parameter; Home and onboarding fall back to the newest child | The route parameter, chosen from the menu (Phase 0). In child view, the device's view mode fixes the child. |
| Home | One "Start" or "Continue" button for the newest child; a hidden children section | The hidden section and its card removed; one button per child when there are several (0.1). |
| Routes | Parent pages only | Adds `/Kids/:childId/:area` (web) and a `Kids` screen (mobile). A guard keeps child view on the kids page and the hub. |
| Backend | No child activity | Kids endpoints in children, discover, transform and grow (2.1, 2.5, 3.1, 3.4); a parent PIN in auth (1.4). |
| Parent pages | — | Transform and Growth gain a section showing the child's activity (3.3, 3.6). |

---

## Theming

The prototype writes every colour as a literal (`#4be9ff`, `rgba(75,233,255,.14)`, a `soft(hex, a)`
helper) and every font as an inline `font-family`. None of that is copied. Child view follows the
app's existing theme rules ([frontend/CLAUDE.md](../frontend/CLAUDE.md) "Tailwind & styling",
[frontend-app/CLAUDE.md](../frontend-app/CLAUDE.md) "Theme & colors", "Typography"):

- **Dark only.** The app is forced dark on web (`next-themes`, `forcedTheme="dark"`) and dark-only
  on mobile. Child view adds no light palette and no toggle.
- **Tokens in one file.** Every colour is a `--x-rgb` custom property in
  [index.css](../frontend/src/index.css), inside the existing `@layer base { :root { … } }`
  block with the other tokens. Nothing else in either app holds a colour value: no hex, no
  `rgb(…)`/`rgba(…)`/`hsl(…)` with numbers, in a class, a style object, a gradient string or a
  canvas call.
- **className first, on both apps.** Today the web doesn't expose its `--x-rgb` tokens to
  Tailwind, which is why its pages write `rgb(var(--constellation-cyan-rgb))` in style objects
  (over 800 times). The kids tokens don't repeat that: register them in
  [tailwind.config.ts](../frontend/tailwind.config.ts) under `colors.kids` as
  `'rgb(var(--kids-x-rgb) / <alpha-value>)'`, so the web writes `bg-kids-transform`,
  `bg-kids-transform/15` (the prototype's `soft(hex, .15)`), `text-kids-ink`. Mobile already
  turns every `--x-rgb` token into a Tailwind colour of the same name (via `yarn theme:sync`),
  so the same class names work there. A `style` object is for what className can't say:
  positions and sizes computed at run time (a power's place on the orbit, a meter's width), and
  the few shadows and gradients that use a token through `rgb(var(--x-rgb) / a)` (web) or
  `css('…')` (mobile).
- **Radii, spacing and type sizes from the Tailwind scale** (`rounded-full`, `rounded-2xl`,
  `p-4`, `text-sm`…), at the nearest step to the prototype's pixels, not arbitrary `[18px]`
  values, unless the nearest step visibly breaks the layout.
- **Reuse before adding.** Many prototype colours are already tokens, from the hub and the
  circle pages:

  | Prototype | Existing token |
  |---|---|
  | `#4be9ff` (cyan, Discover and Grow) | `--constellation-cyan-rgb` |
  | `#1ec4e8`, `#eafdff`, `#0a5b74` | `--constellation-cyan-bright-rgb`, `-cyan-pale-rgb`, `-cyan-deep-rgb` |
  | `#f0c98a`, `#ffd98a`, `#fff6e2` (gold, the parent's avatar) | `--constellation-gold-rgb`, `-gold-bright-rgb`, `-gold-cream2-rgb` |
  | `#05131a`, `#05070f` (ink, page background) | `--constellation-navy-rgb`, `-navy-deep-rgb` |
  | `#7f97a8`, `#6f8697`, `#e7f5f9` (menu text) | `--constellation-slate-warm-rgb`, `-slate-mute-rgb`, `-text-frost-rgb` |

- **New tokens, named by role.** The kids page's own colours aren't in the palette yet. Add them
  to `index.css` once, as a `--kids-*` group with a comment like the constellation group's, named
  for what they do rather than their hue:
  - each area's colour and the darker "shade" its chunky buttons sit on: Transform `#ffc94b` /
    `#b3861c`, Connect `#ff8fb1` / `#b3526f`, Release `#9d8cff` / `#5a4aa8`, and the cyan
    areas' shade `#1b8aa3`;
  - the two extra power colours, teal `#3ce1be` / `#1d8f77` and orange `#ff9f5a` / `#b3642a`
    (the powers cycle through six colour pairs);
  - the moods' colours, which reuse the pairs above (Great teal, Good cyan, Okay gold, Low
    violet, Upset pink);
  - the control surfaces: `#1a2442` / `#0c1328` (an off button and its shade), `#08101f` (ink on
    a lit button) and `#f2fbff` (text on an off button).
  - The prototype's dark drop shadows (`rgba(2,6,15,.7)` and similar) reuse
    `--constellation-void-deep-rgb` (2 6 15) at that alpha; no new token.
- **The area's colour as a variable, not a computed hex.** The prototype recolours the page per
  tab (`areaColor`).
  - **Web:** the page's root sets two variables to the area's tokens,
    `style={{ '--kids-area-rgb': 'var(--kids-transform-rgb)', '--kids-area-shade-rgb': 'var(--kids-transform-shade-rgb)' } as CSSProperties}`
    (Home's pillar cards set `--pillar-glow` the same way), and everything below uses
    `bg-kids-area`, `text-kids-area`, `border-kids-area/40` (registered like the others).
  - **Mobile:** no CSS variables, and NativeWind needs whole class names, never built from
    strings. A `KIDS_AREA` map in `components/kids/palette.ts` gives each area its full class
    names (`{ bg: 'bg-kids-transform', text: 'text-kids-transform' }`) and its token names for
    `rgb(name, a)`.
- **Repeated styles become shared classes.** The chunky button, the kids card and the chip
  repeat on every tab.
  - **Web:** `@layer components` classes in `index.css`, like `.card-surface`: `.kids-btn` (fill
    `rgb(var(--kids-area-rgb))`, shadow `0 6px 0 rgb(var(--kids-area-shade-rgb))`), with
    `.kids-btn-off` switching both variables to the off pair; `.kids-card`; `.kids-chip`.
  - **Mobile:** matching entries in `recipe` in [src/theme/index.ts](../frontend-app/src/theme/index.ts),
    as functions of the area where the colour depends on it (`recipe.kidsBtn(area)`), built
    with `rgb(…)` from the token names.
- **Mobile follows the web.** After the `index.css` change, `yarn theme:sync` regenerates
  `src/theme/tokens.generated.js` (never edited by hand), so the same Tailwind names work
  (`bg-kids-transform`, `text-kids-ink`). Colour props use `color.x`; translucent ones `rgb('x', a)`;
  pasted web gradients and shadows `css('…')`, hoisted to module constants. Anything the web keeps
  as a literal goes in `src/theme/tokens.mobile.js` once, with feature names in a
  `components/kids/palette.ts`, as the other features do.
- **Fonts.** Orbitron and Rajdhani are already loaded: `font-orbitron` / `font-rajdhani` on web,
  and on mobile the per-weight classes (`font-orbitron-black`, `font-rajdhani-bold`…) without
  `fontWeight`. The prototype's inline `font-family` and its `letter-spacing` in `em` become those
  classes, and px letter-spacing on mobile.
- **Canvas and SVG colours.** Confetti and the mini games draw with colours too.
  - **Web:** a small helper, `tokenRgb(name, alpha?)` in `src/lib/themeTokens.ts`, reads the
    token's channels once with `getComputedStyle(document.documentElement)` and returns
    `rgb(r g b / a)`; canvas code calls it, never a literal. It's web-only: mobile has `rgb()`.
    (The existing `Starfield.tsx` still draws with a literal; it isn't part of this work.)
  - **Mobile:** `color.x` / `rgb('x', a)`. SVG gradient stops use `stop(rgb('x', a))`
    (`@/components/ui/svg-stop`), because react-native-svg drops an `rgba()` stop's alpha.
- **Mobile performance and overlays.** The powers' orbit and the games animate continuously, so
  they follow the hub's rule: no looping animation on props inside an `<Svg>`; draw it once and
  loop the layer's `transform` / `opacity`. The game overlay, confetti and toasts render in a
  `<Portal>`, not `<Modal visible>`. Pressables come from `@/components/ui/pressable`, and
  `backdrop-blur` is dropped.
- **Contrast.** The new pairs are checked against WCAG AA (4.5:1 for text, 3:1 for large text and
  controls), including at the partial opacities the page uses: dark ink on each bright button,
  and light text on the off buttons and cards.
- **Enforced, not just written down.** Nothing in either app's lint stops a literal today (the web
  still has a few, e.g. in `StartJourneyModal.tsx`). 2.0 adds a lint rule, scoped to the new
  kids files so existing code isn't affected: in [eslint.config.ts](../frontend/eslint.config.ts)
  and [frontend-app/.eslintrc.js](../frontend-app/.eslintrc.js), `no-restricted-syntax` on string
  and template literals matching a hex colour or `rgb`/`rgba`/`hsl`/`hsla` with a number, and on
  a `fontFamily` property (plus `fontWeight` on mobile), for `src/components/kids/**` and the kids
  page and screen. The tokens file, `tailwind.config.ts` and the theme folder stay outside it.

---

## Phase 0 — Multiple children: + Add Child and switching

What exists today:
- **Backend:** complete. `POST /api/v1/children` creates a child (at most 10, `422 child_limit`),
  `DELETE` soft-deletes one, and `GET` lists them newest first.
- **Clients:** the create flow works. `/Onboarding` with `{ state: { forceNew: true } }` skips
  reusing the newest child and creates a new one at "Continue" (web
  [Onboarding.tsx](../frontend/src/pages/Onboarding.tsx), mobile
  [Onboarding.tsx](../frontend-app/src/screens/Onboarding.tsx)); `CHILD_ERRORS.child_limit` has
  the message for the limit. Start Over in the header deletes the current child.
- **Hidden:** the "Your Children" section on both Home pages (an Add Child button, a
  `ChildCard` per child with View journey and Delete), behind `{false && …}` on web and
  `SHOW_CHILDREN_SECTION = false` on mobile, plus the comments and the `firstChild` fallback that
  go with it.
- **A gap:** creating or editing a child doesn't refresh the `['children']` query, so a new
  child would appear in the menu only after the 30-second stale time.

- [ ] **0.1 Remove the hidden children section.**
  - **Delivers:**
    - Web [Home.tsx](../frontend/src/pages/Home.tsx): the `{false && (…)}` section and its
      comment, the "TO ENABLE MULTIPLE CHILDREN" comment, the padding comment, and the
      `ChildCard` and `Plus` imports, which nothing else uses.
    - Mobile [Home.tsx](../frontend-app/src/screens/Home.tsx): the `SHOW_CHILDREN_SECTION`
      constant and section, the "FEATURE HIDDEN" comments, the same imports, and the
      `iconLeftSm` style.
    - `ChildCard.tsx` in both apps, now unused: deleted. Deleting a child moves to the menu's ×
      (0.2); Start Over in the header still deletes the child that's open.
    - The hero button: no children → "Start Your Journey" (unchanged); one child → "Continue
      Your Journey" for that child; several → one "Continue with <name>" button per child. The
      destination is the same as the menu's (0.2). That's a change for a child who has finished
      setup: today the button reopens the profile form (`/Onboarding/:id`) every time.
  - **Needs:** nothing.
  - **Check:** Home tests for no, one and several children; tsc, eslint, prettier for both apps.
- [ ] **0.2 Profile menu: children and "+ Add Child".**
  - **Delivers**, in [Layout.tsx](../frontend/src/Layout.tsx) and
    [AppHeader.tsx](../frontend-app/src/components/layout/AppHeader.tsx), with the classes and
    tokens those menus already use (no new colours):
    - A **Children** group above Home, from the existing `['children']` query: each child's
      photo (`avatar_url`) or initial, name, and "Age N", or "Setting up" while
      `progress.conversation` is false. The child in the current URL is highlighted.
    - A tap opens that child in parent view: still setting up → `/Onboarding/:id` (resume the
      form and chat); otherwise → `/PersonalityJourney/:id`.
    - **"+ Add Child"** below the list: `navigate('/Onboarding', { state: { forceNew: true } })`
      and close the menu. At 10 children it's disabled, with "Maximum of 10 children" under it;
      the server's `child_limit` message still covers a race.
    - **A delete button (×) on each child row**, at the row's end, separate from the row's tap
      area and at least 44 px square, labelled "Delete <name>" for screen readers.
      - It opens a confirmation dialog (`AlertDialog` on web, `@/components/ui/dialog` on mobile)
        naming the child: "Delete Aarav? Their profile, chat, results and plan are deleted for
        good. This can't be undone." Buttons: "Cancel" (focused) and "Delete", in the
        destructive style. There's no restore endpoint, so there's no undo toast either.
      - It calls `DELETE /api/v1/children/{id}` through a `useDeleteChild()` hook, generalised
        from `useStartOver` (which keeps working on top of it): a 404 counts as done, other
        errors show a toast and keep the row; on success the `['children']` query is
        invalidated.
      - Deleting the child whose page is open navigates to Home; deleting another child stays
        where it is. The menu stays open on the updated list.
      - Hidden in child view (1.2), with the rest of the Children group.
    - The list loads with the menu (no extra request when it's cached) and shows a short error
      row with "Try again" if it fails. Admins don't see the group.
  - **Needs:** 0.3 (so a new child shows straight away).
  - **Check:** menu tests for both apps: no children, several, the current one highlighted, a
    child still setting up, the limit, Add Child's navigation and its `forceNew` state; delete:
    cancel does nothing, confirm calls the API and drops the row, deleting the open child goes
    Home, a failure keeps the row and shows a toast, a 404 counts as done.
- [ ] **0.3 Keep the children list fresh, and the add flow tidy.**
  - **Delivers:**
    - Onboarding (both apps): after `children.create`, `children.update` and the photo upload,
      invalidate `['children']`.
    - With `forceNew` and at least one existing child, open at the profile step (step 2): the
      welcome step is for a first visit.
    - Start Over's confirmation names the child ("Delete Aarav's journey?"), since it now
      affects one of several.
  - **Needs:** nothing *(parallel with 0.1)*.
  - **Check:** Onboarding tests (the invalidation, the starting step with `forceNew`); a manual
    pass on dev: add a second child from the menu, finish its chat, switch between the two.

**Gate:** `./check.sh`, then the manual pass in 0.3 on web and Android.

---

## Phase P — Decisions

Each needs an answer before the phase that depends on it. The recommendation is marked.

- [ ] **P.1 Leaving child view.** In the prototype anyone can switch back from the menu, so a
  child could open parent view, the parent's chat and the mood notes. Child view uses the
  parent's token, so it limits the screens, not the API; a check on the way out is what makes it
  hold.
  - **Recommended:** a 4-digit parent PIN, set the first time child view is used, kept hashed in
    the auth service (it already holds the password, the bcrypt hashing and the sign-in
    throttle), with a "forgot PIN" path that asks for the account password, or a fresh Google
    sign-in for Google accounts.
  - Alternative: the account password every time. No new data, but awkward on a phone and
    unavailable for Google-only accounts.
  - **Needed by:** 1.4.
- [ ] **P.2 Sharing from child view.** The prototype shares wins and scores straight to WhatsApp
  and Instagram.
  - **Recommended:** no direct sharing in child view. "Show my grown-up" saves the item, and the
    parent shares it from parent view (Connect).
  - **Needed by:** 2.4, 4.1.
- [ ] **P.3 Grow: worlds and the existing handover.** Grow already has a "hand the screen over"
  step (`child_rounds`, stored in `child_activity_results`) inside each growth area.
  - **Recommended:** keep the handover (it feeds the parent's result) and add the worlds as
    child-view-only practice. Revisit after launch.
  - **Needed by:** 3.4.
- [ ] **P.4 Discover powers.** The prototype's seven powers are fixed text. Here they should
  follow the child's real result.
  - **Recommended:** a fixed mapping, in the discover service, from the child's stored
    personality (`traits` and `strengths`) to powers and levels, kept in a JSON file next to the
    code. No extra LLM call, and no new service-to-service call.
  - Alternative: a child-friendly section in the personality generation. Better copy, but it
    changes the prompt and costs tokens on every generation.
  - **Needed by:** 2.5.

Also confirm with the designer (no code until answered):
- The Connect, Growth, Life Pathway and Observations pages in the prototype each have a child
  variant ("Your accomplishments", recommendations hidden…), but the hub never opens them in
  child view: every circle goes to the kids page. This plan assumes they're unused.
- The hub's landing text ("begin your child's transformation") is the same in both views.
- Names, the wins list and the photo are sample content; this plan uses the child's own.

---

## Phase 1 — View mode, profile menu and route guard

- [ ] **1.1 View-mode provider (web and mobile).**
  - **Delivers:** a `ViewModeProvider` / `useViewMode()` in `frontend/src/lib/` and
    `frontend-app/src/lib/`, holding `{ mode: 'parent' | 'child', childId? }`.
    - Kept on the device: `localStorage` on web, AsyncStorage on mobile, under one key such as
      `superpower.view`. Reads and writes are wrapped, so a blocked store falls back to parent
      view.
    - Cleared on sign-out and when the signed-in user changes (next to the React Query clear in
      `AuthContext`).
    - Ignored for admins, and when the stored child isn't in the `['children']` list (deleted,
      or another account's).
    - Each device keeps its own view: a parent can be in parent view on the laptop while the
      child uses the tablet.
    - Mounted inside `AuthProvider` in [App.tsx](../frontend/src/App.tsx) and the mobile
      navigation root.
  - **Needs:** nothing.
  - **Check:** unit tests for the provider (default, switch, sign-out clear, missing child); tsc,
    eslint for both apps.
- [ ] **1.2 Profile menu: child view.**
  - **Delivers**, on top of 0.2:
    - The button shows the view under the name: "Parent view", or "Child view" with the child's
      name, photo or initial. The menu keeps the current menu's tokens and classes. The
      prototype's avatar dots are radial gradients: the child's (`#eafdff` → `#4be9ff` →
      `#0a5b74`) is all existing cyan tokens; the parent's (`#fff6e2` → `#f0c98a` → `#8a6a3a`)
      needs one new token for its dark stop, `--profile-parent-deep-rgb` (138 106 58). Both
      gradients become `@layer components` classes (`.avatar-dot-parent`, `.avatar-dot-child`)
      and mobile `gradient` entries (**Theming**).
    - Each child row in the Children group gets a **"Child view"** action next to it. The row
      itself still opens the child in parent view (0.2). This differs from the prototype, where
      a child row always means child view: with several children, parent view needs the rows to
      switch between them. The action is disabled, with "Finish setup first", while
      `progress.conversation` is false.
    - The action sets child view and opens that child's hub
      (`/PersonalityJourney/:childId/DimensionCircles`).
    - In child view the menu shows only the child and "Back to parent view" (gated in 1.4):
      no Children group, "+ Add Child", Home, Account settings or Sign out, and the header hides
      Start Over.
  - **Needs:** 0.2, 1.1.
  - **Check:** component tests for both menus (parent view, child view, disabled child); a manual
    pass on web and Android.
- [ ] **1.3 Route guard and the hub's destinations.**
  - **Delivers:**
    - In child view, every route except the hub and the kids page redirects to the child's hub:
      Home, Onboarding, ConversationalOnboarding, AccountSettings, and the five parent circle
      pages.
      - **Web:** a wrapper in `ProtectedRoutes`. The browser's Back button lands on a guarded
        route too, so it redirects the same way.
      - **Mobile:** the stack keeps earlier screens mounted, so a check in `navigate` isn't
        enough: Back would pop straight to a parent screen. Switching to child view resets the
        stack to the hub alone; the screen wrapper (`withLayout` in
        [navigation/index.tsx](../frontend-app/src/navigation/index.tsx)) redirects any other
        screen; and Android's hardware Back on the hub does nothing in child view.
    - A `:childId` in the URL that isn't the view's child also redirects (a typed or old link).
    - On the hub, in child view, each unlocked circle navigates to `/Kids/:childId/:area`
      instead of its parent page. The existing locks (`enabled` in `PersonalityJourney`) apply
      unchanged. For Discover, the splash plays and the kids page opens: no `viewed` call, so
      the parent still has to see the reveal to unlock Grow.
    - **A feature flag:** until the kids page is complete, the "Child view" action (1.2) is
      behind a flag per environment, off everywhere at first. 2.2 turns it on in dev, for
      testing; 4.4 turns it on everywhere. Until 2.2 the kids route renders a placeholder.
  - **Needs:** 1.1.
  - **Check:** route tests (each parent page redirects in child view, none does in parent view);
    hub test that each circle's destination follows the view.
- [ ] **1.4 Leaving child view.**
  - **Delivers:** per P.1. With the recommended PIN:
    - auth service, where the password and its checks already are:
      `PUT /api/v1/auth/view-pin` (set or change; changing needs the current PIN, and "forgot
      PIN" needs the password, or a Google ID token for Google accounts, checked as sign-in
      checks them) and `POST /api/v1/auth/view-pin/check`. The PIN is hashed with bcrypt, as
      passwords are (`backend/auth/app/tokens.py`). Five wrong tries lock the check for 15
      minutes, counted like the sign-in throttle (`backend/auth/app/throttle.py`).
    - `view_pin_set` in `GET /api/v1/auth/me`. The PIN hash goes on the user's `auth` document:
      add it to that collection's `$jsonSchema` in
      [auth/app/store.py](../backend/auth/app/store.py) and to the models. Account deletion
      removes the `auth` document already, so the PIN goes with it.
    - Client: the first switch to child view asks the parent to set a PIN; "Back to parent view"
      asks for it.
  - **Needs:** P.1, 1.2.
  - **Check:** auth unit tests (set, change, forgot with password and with Google, check,
    lockout); OpenAPI and client sync; client tests for both prompts.

**Gate:** `./check.sh`, then a manual pass on dev: switch to a child, try every parent route,
switch back with the PIN.

---

## Phase 2 — Kids theme, kids page shell, Release and Discover

- [ ] **2.0 Kids theme: tokens and shared styles.**
  - **Delivers**, all per **Theming** above:
    - **Web:** the `--kids-*` tokens (with the area and shade pairs) in
      [index.css](../frontend/src/index.css); `colors.kids` in
      [tailwind.config.ts](../frontend/tailwind.config.ts), including `area` and `area-shade`;
      the `.kids-btn`, `.kids-btn-off`, `.kids-card` and `.kids-chip` classes; `tokenRgb` in
      `src/lib/themeTokens.ts`.
    - **Mobile:** `src/theme/tokens.generated.js` regenerated with `yarn theme:sync` and
      committed; the `recipe` entries; `components/kids/palette.ts` with `KIDS_AREA`.
    - **Both:** the scoped lint rule.
  - **Needs:** nothing *(parallel with Phase 1)*.
  - **Check:**
    - the mobile theme test (`src/__tests__/theme.test.ts`) gains a case for the kids tokens and
      `KIDS_AREA` (every area has every class and token);
    - a web test for `tokenRgb` (reads the variable, applies the alpha);
    - the lint rule fails on a fixture file with a hex, an `rgba(…)` and a `fontFamily`, and
      passes on one using tokens;
    - a contrast check of each new text/background pair, with the ratios in the PR;
    - tsc, eslint, prettier for both apps.
- [ ] **2.1 children service: `kid_activity`.**
  - **Delivers:** a `kid_activity` collection in the children database, one document per child:
    - `child_id`, `user_id`, `location`, `stars`, `awards` (award key → date), `flipped_powers`,
      `best_times` (game → seconds), `moods` (date → `{mood, note?}`), `version`, timestamps, a
      `$jsonSchema` validator like the other collections.
    - Endpoints under `/api/v1/children/{id}/kids`: `GET` (the document, or the empty defaults
      when there isn't one yet: a read writes nothing) and `POST …/events` taking one typed
      action at a time (`flip_power`, `try_power`, `game_best`, `mood`, and `quest` from 3.2).
      Every event is idempotent (an award key is given once), so a client can retry one safely.
      The first event creates the document. The server applies the star rules (each award once;
      "try" once a day; the badge once all powers are flipped), so a client can't set the star
      count.
    - Each event checks its circle is unlocked, from the child's own `progress` (the same rule as
      the hub: discover events need `conversation`, mood needs `transform`, and so on), and
      returns `403 circle_locked` otherwise.
    - Ownership as the other child routes (`{location, user_id}`, not soft-deleted, so a deleted
      child is a 404); parents only. Writes covered by the service's existing limiter
      (`common/limiter.py`).
    - Mood notes are capped (e.g. 500 characters) and never logged.
    - Deletion: removed with the child in `purge_one` (the 30-day purge) and in `delete_user`, in
      [children/app/lifecycle.py](../backend/children/app/lifecycle.py), inside the same
      transaction.
  - **Needs:** nothing *(parallel with Phase 1)*.
  - **Check:** children unit tests (rules, idempotence, ownership, purge); OpenAPI and client
    sync.
- [ ] **2.2 Kids page shell (web and mobile).**
  - **Delivers:** `KidsMode` page and screen at `/Kids/:childId/:area`, with the five tabs,
    the star counter, a back button to the hub, confetti and toasts, and read-aloud through the
    existing `lib/tts.ts`, honouring the `tts_enabled` preference (`TtsContext`), not a
    separate toggle. Locked circles' tabs are disabled; tabs not built yet (Transform, Grow,
    Connect, until Phases 3 and 4) show "Coming soon". Data through a
    `useKidActivity(childId)` hook over 2.1. Styled only with the 2.0 tokens and classes. Turns
    the child-view flag on in dev (1.3).
  - **Needs:** 1.3, 1.4, 2.0, 2.1.
  - **Check:** component tests (tabs, locked tabs, back); tsc, eslint, prettier.
- [ ] **2.3 Release: mood check-in.**
  - **Delivers:** the five moods, an optional note, save once per day (a second save that day
    updates it), and the streak (consecutive days, computed by the client from `moods`). Each
    mood's face colour and shade come from a `MOODS` list of token names (**Theming**), not hex.
  - **Needs:** 2.2.
  - **Check:** component tests (save, update, streak across a month boundary).
- [ ] **2.4 Release in parent view** *(optional, ask first)*.
  - **Delivers:** if wanted, the child's recent moods on the parent's Observations page. Not in
    the prototype; listed so it's decided, not forgotten. Per P.2, also the "Show my grown-up"
    inbox if chosen.
  - **Needs:** 2.3, P.2.
- [ ] **2.5 Discover: powers.**
  - **Delivers:**
    - The power mapping per P.4, in the discover service, which already holds the personality:
      a JSON file next to the code and `GET /api/v1/children/{id}/personality/powers`, giving
      seven powers with level, line and "try this" (`404` until the personality is ready, behind
      discover's existing lock). The kids page reads it alongside `GET …/kids` (2.1), which
      keeps the flips and stars.
    - The page: powers around the child's avatar, flip (+1), "Try this today" (+1 once a day),
      the badge after all seven (+3). The six colour pairs the powers cycle through are a list
      of token names in `components/kids/palette.ts` (web and mobile), not hex.
  - **Needs:** 2.2, P.4.
  - **Check:** mapping tests (every trait maps; levels 3–5; fallbacks for missing traits);
    component tests.
- [ ] **2.6 Discover: mini games.**
  - **Delivers:** the seven games (focus, curious, order, draw, climb, voice, energy), each
    reporting a win and a time; the best time saved with `game_best`. Mobile uses pointer and
    gesture handlers; the "voice" game is a press-and-hold meter, with no microphone. Canvas and
    SVG drawing takes its colours from `tokenRgb` (web) and `rgb()` (mobile), and loops only
    layer `transform` / `opacity` on mobile (**Theming**).
  - **Needs:** 2.5.
  - **Check:** a test per game that it completes and reports once; a manual pass on Android.

**Gate:** `./check.sh`, then a manual pass on dev web and Android: moods, powers, games, stars
after a reload and on the other device.

---

## Phase 3 — Transform quests and Grow worlds

- [ ] **3.1 transform: quest log.**
  - **Delivers:** on the child's transform plan document (or a sibling `kid_quests` collection
    if the plan's validator gets awkward): `interests` (picked keys), `current`, `logs`
    (`interest:quest` → count) and `log_times`.
    - The quest list (9 interests × 3 quests) as a JSON file next to `plans.py`.
    - `GET /api/v1/children/{id}/transform/quests` and `POST …/quests/log` (`+1` for one quest,
      capped per day).
    - **The default interest:** transform stores no interest; the parent's plan has only their
      free-text `ask`, and the web app reads an interest from it by keyword (`readInterest` in
      [startJourneyPlans.ts](../frontend/src/lib/startJourneyPlans.ts)). Port that keyword
      match to Python, map its interests to the 9 quest interests, and return the result as
      `default_interest` (null when nothing matches, and the child picks).
    - Behind the existing transform lock (`require_unlocked`).
    - Purged with the plan in transform's `delete_child` / `delete_user`.
  - **Needs:** nothing *(parallel with Phase 2)*.
  - **Check:** transform unit tests (log, cap, the default interest for matching and
    non-matching asks, lock, purge); OpenAPI and client sync.
- [ ] **3.2 Transform tab.**
  - **Delivers:** pick an interest, the three quests with their counts, log a quest (+ a star,
    through a `quest` event on 2.1, the first time each quest is done).
  - **Needs:** 2.2, 3.1.
  - **Check:** component tests.
- [ ] **3.3 Transform in parent view.**
  - **Delivers:** on the parent's LifePathway page, a section with the child's quest counts and
    dates for the plan's interest, or "Nothing logged yet". Styled like the rest of that page,
    with its existing constellation tokens: no kids tokens in parent view.
  - **Needs:** 3.1.
  - **Check:** component tests for both states.
- [ ] **3.4 grow: world runs.**
  - **Delivers:** per P.3. A `world_runs` collection in grow: `child_id`, `world` (0–5),
    `total`, `scores` (three), `created_at`; the last 10 runs per world kept.
    - The six worlds' games as data (a JSON file next to `area_data.json`).
    - `GET /api/v1/children/{id}/growth-areas/worlds` and `POST …/worlds/{world}/runs`. Scores
      are checked (0–100); behind the grow lock.
    - Purged in grow's `delete_child` / `delete_user`
      ([grow/app/lifecycle.py](../backend/grow/app/lifecycle.py)).
  - **Needs:** P.3 *(parallel with 3.1)*.
  - **Check:** grow unit tests (save, trim to 10, checks, lock, purge); OpenAPI and client sync.
- [ ] **3.5 Grow tab.**
  - **Delivers:** pick a world, the three games (tap, sort, catch, timing types), the result
    with a score band ("Super strong", "Growing well", "Keep practising"), saved as a run. The
    bands' colours (gold, cyan, violet) are tokens.
  - **Needs:** 2.2, 3.4.
  - **Check:** a test per game type; component tests for the flow.
- [ ] **3.6 Grow in parent view.**
  - **Delivers:** on the parent's GrowthAreas page, each world's latest score and when, with a
    "Build on" suggestion for the best game and a "Support" one for the weakest (suggestion text
    as data with the worlds). The tag colours (gold "Build on", cyan "Support") are the existing
    constellation tokens the page already uses.
  - **Needs:** 3.4.
  - **Check:** component tests (no runs, one run, several).

**Gate:** `./check.sh`, then the manual pass of Phase 2 plus quests and worlds, checking that the
parent pages show what the child did.

---

## Phase 4 — Connect, hardening and launch

- [ ] **4.1 Connect tab.**
  - **Delivers:** the child's wins: from their awards (2.1), quests (3.1) and world runs (3.4),
    not the hardcoded `BASE_ITEMS`. Sending follows P.2 (recommended: "Show my grown-up"). If
    sharing stays, the WhatsApp button uses the existing `--whatsapp-*` tokens.
  - **Needs:** 3.2, 3.5, P.2.
  - **Check:** component tests.
- [ ] **4.2 Hardening.**
  - **Delivers:** the kids write endpoints under each service's existing limiter (checked, not
    assumed); the new collections in the data-residency and backup notes
    ([data-residency.md](data-residency.md)); child-view events in the e2e journey (with
    agreement, as it costs LLM calls).
  - **Needs:** 4.1.
- [ ] **4.3 Docs.**
  - **Delivers:** the kids endpoints in [api.md](api.md); child view in
    [frontend.md](frontend.md) (the provider, the guard, the routes); this file's status.
  - **Needs:** 4.1 *(parallel with 4.2)*.
- [ ] **4.4 Launch on dev, then stg.**
  - **Delivers:** a full pass on dev (web, Android, iOS) of every circle in both views, a
    deletion of a child with kids activity (every new collection empty afterwards), then stg.
    Turns the child-view flag on everywhere (1.3).
  - **Needs:** 4.2, 4.3.

**Gate:** `./check.sh` and the 4.4 pass.

---

## Out of scope

- Child logins or child accounts: child view stays a mode of the parent's session.
- Enforcing child view on the API: the token is the parent's; the PIN (1.4) guards the way back.
- Telling one device's view from another's: each device keeps its own (1.1), and nothing on
  the server knows which view a device is in.
- The prototype's sample content (names, photo, wins). Its layout and visual details stay the
  reference, but its colours and fonts are re-expressed through the theme (**Theming**).
