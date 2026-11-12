# Child view: build plan

**Status:** built; the e2e runs pass. Left: the launch pass on dev, then stg (4.4).
**Against the prototype:** every remaining difference, screen by screen, is listed in
[child-view-vs-prototype.md](child-view-vs-prototype.md).
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
- **Tests:** only the mobile app has a unit-test runner (Jest with React Native Testing Library);
  the web app has none. So "component tests" and "hook tests" below are written in
  `frontend-app/src/__tests__/`, against the mobile port, and the web side of a task is checked
  with `tsc`, ESLint and Prettier plus the manual pass. Adding a web runner would be its own
  task.
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
| 0 | Multiple children: + Add Child and switching | 3 | 3 |
| P | Decisions | 4 | 4 |
| 1 | View mode, profile menu and route guard | 3 | 3 |
| 2 | Kids theme, kids page shell, Release and Discover | 7 | 7 |
| 3 | Transform quests and Grow worlds | 6 | 6 |
| 4 | Connect, hardening and launch | 4 | 3 |
| | **Total** | **27** | **26** |

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
| Backend | No child activity | Kids endpoints in children, discover, transform and grow (2.1, 2.5, 3.1, 3.4) |
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
  for what they do rather than their hue (as built: one pair per circle, `--kids-<circle>-rgb`
  and `-shade-rgb`; the two colours no circle owns, `--kids-teal-*` and `--kids-orange-*`,
  are named by hue like the constellation group; and `--kids-bg`, `-text`, `-body`, `-muted`,
  `-ink`, `-off`, `-off-shade`, `-streak` for the page itself):
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
  - **Mobile:** matching style functions of the colour (`button(area)`, `card(area)`,
    `tile(color, on)`…) in `components/kids/palette.ts`, built with `rgb(…)` from the token
    names, as the other features' palette files are (rather than `recipe` in `src/theme`).
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

## Decided during the build: child view's own order (2026-11-11)

Child view no longer follows the parent's progress past Discover. Its circles open in their
own order, from what the child has done there: Discover once the parent's chat is done (the
powers need the personality), then **Grow** once the Discover badge is earned (all seven powers
open), **Transform** once a world is finished, **Release** once a quest is logged, **Connect**
once a mood check-in is saved. The children service works it out (`circles_done` on
`GET …/kids`, from `kid_activity`) and refuses an event whose circle isn't open. A world and a
quest aren't sent to children: grow and transform publish `grow.world_played` and
`transform.quest_logged` in the run's or the log's own transaction, and children's worker
records them whenever they arrive, even before the circle is open in child view (grow and transform have kept the run or log already, and the two topics are unordered), so the two can't disagree. Transform's quests and Grow's worlds open once the chat is done (their
own locks are the parent's). The hub in child view and the kids tabs show these locks. The
parent's circles keep their own locks in parent view.

Because of that, the parent can't always reach their own Connect or Life Pathway yet when the
child has done things in child view. So Home shows, under the Continue buttons, a "From
<name>'s child view" card per child (`components/home/ChildViewNews.tsx`, both apps): the wins
the child chose to show and the quests they logged, newest first, with "Share from Connect"
once the parent's Connect is open. Hidden while there's nothing to show.

## Matched to the HTML (2026-11-11)

The kids page now follows the prototype's layout, on web and mobile:
- **Header:** the app's own bar (Superpower, the voice button, the profile menu) stays, as on
  every page; under it, the kids bar: "Home" (house icon, back to the circles), the circle's
  chip and "Read to me". The circle tabs and the star count are gone: the hub is the way between
  circles, and stars are kept on the server without being shown.
- **Discover:** the gold eyebrow pill with twinkling dots, "You are The <style>" and the
  archetype's own line (discover's `powers.json` `styles`, returned as `style_line`), the orbit's
  glow, rings and a spoke to each power, the child's photo in its cyan ring with their name, the
  powers as cyan bubbles (gold edge once opened, lit while the game is open, "Click here to enjoy
  the game" on hover), and "7 superpowers unlocked". The power card ("Try this today") and the
  badge card are gone: neither is on the prototype's page. The badge still opens Grow.
- **Avatar videos:** as in parent view, Grow plays the stage-7 video and Transform the stage-4
  one on entry (`AREA_SPLASH` in `lib/kidsAreas.ts`; Discover's plays on the hub). The page
  stays hidden from its first frame until the video ends, then fades in; the ambient track and
  "Read to me" wait for it; coming back skips it.
- **Transitions:** as the parent pages, the kids page fades in on every entry (0.8 s), video
  or not, and its content rises in. Discover adds the prototype's entrances: the heading rises,
  the photo pops, the spokes grow and the powers unfold one after another, then the pill pops.
  None of it plays when the device asks for reduced motion (mobile: `components/kids/enter.ts`).
- Still left out on purpose: "Share your superpower" (WhatsApp, Instagram), per P.2.

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

- [x] **0.1 Remove the hidden children section.** *(done)*
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
- [x] **0.2 Profile menu: children and "+ Add Child".** *(done)*
  - **Delivers**, in [Layout.tsx](../frontend/src/Layout.tsx) and
    [AppHeader.tsx](../frontend-app/src/components/layout/AppHeader.tsx), with the classes and
    tokens those menus already use (no new colours):
    - A **Children** group above Home, from the existing `['children']` query: each child's
      photo (`avatar_url`) or initial, name, and "Age N", or "Setting up" while
      `progress.conversation` is false. The child in the current URL has their name in cyan
      (only the signed-in parent's row is highlighted, so it never looks like two selections).
    - A tap opens that child in parent view: still setting up → `/Onboarding/:id` (resume the
      form and chat); otherwise → `/PersonalityJourney/:id`.
    - **An edit button (pencil) on each child row**, next to the ×, labelled "Edit <name>'s
      profile": opens `/Onboarding/:id` at the profile form, with a "Save changes" button
      for a finished child. Saving a finished child goes back to where the form was opened
      (or to their journey if it was opened directly); a child still in setup goes on to the
      chat as before. Opening any
      existing child's form now skips the welcome step.
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
      - The × closes the menu, then the dialog opens (on iOS once the menu's Modal has
        dismissed: it can't present one Modal while another is closing). Deleting the child
        whose page is open navigates to Home; deleting another child stays where it is.
      - Hidden in child view (1.2), with the rest of the Children group.
    - **Look:** the prototype's profile menu. A pill button with the parent's gold avatar
      dot (with the name and "Parent view" beside it from `sm` up), and a dark panel headed
      "Signed-in profile": the parent's row first, highlighted, then each child with a cyan
      dot or their photo and "Child · age N" / "Child · setting up". Each child's row is one
      box holding the pencil and ×. Built from the `.profile-*` and `.avatar-dot-*` classes in
      `index.css` (three new tokens: `--profile-pill-rgb`, `--profile-pill-border-rgb`,
      `--profile-parent-deep-rgb`) and, on mobile, `components/layout/profilePalette.ts`.
    - The list loads with the menu (no extra request when it's cached) and shows a short error
      row with "Try again" if it fails. Admins don't see the group.
  - **Needs:** 0.3 (so a new child shows straight away).
  - **Check:** menu tests for both apps: no children, several, the current one highlighted, a
    child still setting up, the limit, Add Child's navigation and its `forceNew` state; delete:
    cancel does nothing, confirm calls the API and drops the row, deleting the open child goes
    Home, a failure keeps the row and shows a toast, a 404 counts as done.
- [x] **0.3 Keep the children list fresh, and the add flow tidy.** *(done)*
  - **Delivers:**
    - Onboarding (both apps): after `children.create`, `children.update` and the photo upload,
      invalidate `['children']`.
    - With `forceNew` and at least one existing child, open at the profile step (step 2): the
      welcome step is for a first visit.
    - Start Over's confirmation names the child ("Delete Aarav's journey?"), since it now
      affects one of several.
    - A child created on `/Onboarding` replaces that history entry with `/Onboarding/:id`
      before the chat opens, so Back from the chat reopens that child's form instead of an
      empty one that would create a duplicate.
  - **Needs:** nothing *(parallel with 0.1)*.
  - **Check:** Onboarding tests (the invalidation, the starting step with `forceNew`); a manual
    pass on dev: add a second child from the menu, finish its chat, switch between the two.

**Gate:** `./check.sh`, then the manual pass in 0.3 on web and Android.

---

## Phase P — Decisions

Each needs an answer before the phase that depends on it. The recommendation is marked.

- [x] **P.1 Leaving child view.** **Decided (2026-11-11): no PIN or password, as in the
  prototype.** "Back to parent view" is one tap. Child view uses the parent's session, so it
  limits the screens, not the API, and a child on the device can switch back to parent view;
  that's accepted. A check on that one button (a parent PIN in the auth service, or the
  password) can be added later without changing anything else; it was task 1.4.
- [x] **P.2 Sharing from child view.** **Decided: as recommended** (built in 4.1). The
  prototype shares wins and scores straight to WhatsApp and Instagram.
  - **Recommended:** no direct sharing in child view. "Show my grown-up" saves the item, and the
    parent shares it from parent view (Connect).
  - **Needed by:** 2.4, 4.1.
- [x] **P.3 Grow: worlds and the existing handover.** **Decided: the handover was removed** (see
  "Revisited" below). Grow already has a "hand the screen over"
  step (`child_rounds`, stored in `child_activity_results`) inside each growth area.
  - **Recommended:** keep the handover (it feeds the parent's result) and add the worlds as
    child-view-only practice. Revisit after launch.
  - **Needed by:** 3.4.
  - **Revisited (3.6, as built):** the handover was removed; the world runs feed the
    parent's recommendations instead.
- [x] **P.4 Discover powers.** **Decided: as recommended**, the fixed mapping (built in 2.5).
  The prototype's seven powers are fixed text. Here they should
  follow the child's real result.
  - **Recommended:** a fixed mapping, in the discover service, from the child's stored
    personality (`traits` and `strengths`) to powers and levels, kept in a JSON file next to the
    code. No extra LLM call, and no new service-to-service call.
  - Alternative: a child-friendly section in the personality generation. Better copy, but it
    changes the prompt and costs tokens on every generation.
  - **Needed by:** 2.5.

Settled with the owner (2026-11-11), so no designer question remains: the prototype's child
variants of the Connect, Growth, Life Pathway and Observations pages are not built and not
needed. In child view every circle opens the kids page, and the guard opens nothing else; the
app's four pages are the parent's, used in parent view (and showing what the child did). There
was no child-variant code in them to remove.

---

## Phase 1 — View mode, profile menu and route guard

- [x] **1.1 View-mode provider (web and mobile).** *(done)*
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
- [x] **1.2 Profile menu: child view.** *(done)*
  - **Delivers**, on top of 0.2:
    - The button shows the view under the name: "Parent view", or "Child view" with the child's
      name, photo or initial: the label under the name (already "Parent view" from 0.2)
      switches, and the button's dot becomes the child's cyan dot (`.avatar-dot-child`).
    - **As the prototype (decided 2026-11-11):** a child's row switches to that child's child
      view and opens their hub (`/PersonalityJourney/:childId/DimensionCircles`). First built
      as a separate smiley action with the row opening the child in parent view; removed. In
      parent view a child is opened from Home ("Continue with <name>"). A child still in setup
      (`progress.conversation` false) has no child view yet: their row opens their onboarding.
    - In child view the menu shows only the child and "Back to parent view" (one tap, P.1):
      no Children group, "+ Add Child", Home, Account settings or Sign out, and the header hides
      Start Over.
  - **Needs:** 0.2, 1.1.
  - **Check:** component tests for both menus (parent view, child view, disabled child); a manual
    pass on web and Android.
- [x] **1.3 Route guard and the hub's destinations.** *(done)*
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
    - **No feature flag (decided 2026-11-11).** Child view was first built behind a flag
      (`VITE_CHILD_VIEW` / `CHILD_VIEW` in `.env`), to be turned on per environment. It's
      removed: every phase is built before release, so the "Child view" action is always
      there for parents. Circles whose kids page isn't built yet show "Coming soon".
  - **Needs:** 1.1.
  - **Check:** route tests (each parent page redirects in child view, none does in parent view);
    hub test that each circle's destination follows the view.
- ~~**1.4 Leaving child view.**~~ Dropped with P.1: no PIN, so "Back to parent view" stays
  one tap.

**Gate:** `./check.sh`, then a manual pass on dev: switch to a child, try every
parent route (they all land on the child's circles), switch back.

---

## Phase 2 — Kids theme, kids page shell, Release and Discover

- [x] **2.0 Kids theme: tokens and shared styles.** *(done)*
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
- [x] **2.1 children service: `kid_activity`.** *(done)*
  - **Delivers:** a `kid_activity` collection in the children database, one document per child:
    - `child_id`, `user_id`, `location`, `stars`, `awards` (award key → date), `flipped_powers`,
      `best_times` (game → seconds), `moods` (date → `{mood, note?}`), `version`, timestamps, a
      `$jsonSchema` validator like the other collections.
    - Endpoints under `/api/v1/children/{id}/kids`: `GET` (the document, or the empty defaults
      when there isn't one yet: a read writes nothing) and `POST …/events` taking one typed
      action at a time (`flip_power`, `try_power`, `game_best`, `mood`, and `quest` from 3.2).
      As built, the day's mood also gives a star once a day (`mood:<date>`), as the prototype
      does; the child's day is a `?date=` query on both endpoints.
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
- [x] **2.2 Kids page shell (web and mobile).** *(done)*
  - **Delivers:** `KidsMode` page and screen at `/Kids/:childId/:area`, with the five tabs,
    the star counter, a back button to the hub, confetti and toasts, and read-aloud through the
    existing `lib/tts.ts`, honouring the `tts_enabled` preference (`TtsContext`), not a
    separate toggle. Locked circles' tabs are disabled; tabs not built yet (Transform, Grow,
    Connect, until Phases 3 and 4) show "Coming soon". Data through a
    `useKidActivity(childId)` hook over 2.1. Styled only with the 2.0 tokens and classes.
  - **Needs:** 1.3, 2.0, 2.1.
  - **Check:** component tests (tabs, locked tabs, back); tsc, eslint, prettier.
- [x] **2.3 Release: mood check-in.** *(done)*
  - **Delivers:** the five moods, an optional note, save once per day (a second save that day
    updates it), and the streak (consecutive days, computed by the client from `moods`). Each
    mood's face colour and shade come from a `MOODS` list of token names (**Theming**), not hex.
  - **Needs:** 2.2.
  - **Check:** component tests (save, update, streak across a month boundary).
- [x] **2.4 Release in parent view** *(done; moods only)*.
  - **Delivers:** a "How {name} has been feeling" section on the parent's Observations page
    (web `components/observations/RecentMoods.tsx`, mobile the same): the last 14 days as
    mood faces in two week rows, today outlined, the streak and how many days had a check-in.
    It reads `GET …/kids` through `useKidActivity` and shows **only the mood**: the child's
    note is never shown to the parent, and the section says so. Hidden while loading or when
    the read fails. Not in the prototype. Per P.2, also the "Show my grown-up" inbox if
    chosen.
  - **Needs:** 2.3, P.2.
- [x] **2.5 Discover: powers.** *(done)*
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
  - **As built:**
    - `discover/app/powers.json` keeps the prototype's seven powers (same text, each with its
      game, in `kids.GAMES` order) and the archetypes each one comes from. A power's level is
      its strongest archetype's score in the view model's `scores`: 90 or more is 5, 60 or
      more is 4, anything else (or a missing score) is 3. Every archetype feeds at least one
      power, so each child has at least one level-5 power.
    - The text is the same for every child; only the levels follow the result. The response
      also carries `style` (the dominant archetype) for "You are The Thinker".
    - The prototype opens a game when a power is tapped; until 2.6, a tap opens the power's
      card (level, line, "Try this today"), and the badge card sits under it. Sharing to
      WhatsApp and Instagram is left out (P.2: no sharing in child view).
- [x] **2.6 Discover: mini games.** *(done)*
  - **Delivers:** the seven games (focus, curious, order, draw, climb, voice, energy), each
    reporting a win and a time; the best time saved with `game_best`. Mobile uses pointer and
    gesture handlers; the "voice" game is a press-and-hold meter, with no microphone. Canvas and
    SVG drawing takes its colours from `tokenRgb` (web) and `rgb()` (mobile), and loops only
    layer `transform` / `opacity` on mobile (**Theming**).
  - **Needs:** 2.5.
  - **Check:** a test per game that it completes and reports once; a manual pass on Android.
  - **As built:**
    - The rules are shared (`lib/kidsGames.ts`, the same file in both apps): goals, each
      tick's step, the time (to 0.1 s, kept within the server's 0.5–600 s) and the best-time
      line. Each app's `components/kids/KidsGames.tsx` only draws them, and `GameDialog`
      times a round, shows "You did it!" and sends `game_best` only when it beats the saved
      best.
    - Tapping a power now opens its game (as in the prototype) as well as its card; the card
      has "Play the game" and the best time. The win screen leaves out the prototype's
      WhatsApp and Instagram buttons (P.2).
    - Web draws with DOM and SVG and the `.kids-game-*` classes. Mobile sizes every piece
      from the frame's measured width, moves what ticks by `transform` only (the bubbles,
      the light, the voice rings and wave), takes the draw game's finger through the
      responder system (no new library), and shows the game in a `Portal`, not a native
      Modal.
    - The win lines are rewritten in the second person ("You popped 10 bubbles…") instead of
      the prototype's "Rahul … his".
    - Tests (mobile): the rules, each game played to its end and reporting once, the dialog's
      timing and best-time rule, and the Discover tab saving a first time.

**Gate:** `./check.sh`, then a manual pass on dev web and Android: moods, powers, games, stars
after a reload and on the other device.

---

## Phase 3 — Transform quests and Grow worlds

- [x] **3.1 transform: quest log.** *(done)*
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
  - **As built:**
    - A sibling `kid_quests` collection (`transform/app/quests.py`), so the plan's validator,
      `version` and events stay the parent's. The quests are the prototype's (`quests.json`:
      nine interests, three quests each, a title, how and a target count).
    - `GET …/transform/quests?date=` gives `default_interest` (read from the plan's `ask` by
      the web app's keywords; `gaming` is the quests' `games`), the child's own `interests`,
      `current`, `logs`, `logged_today` and the `catalog`, so the apps hold no quest text.
    - `PUT …/quests/current` picks the interest on screen (one the plan doesn't name is added
      to `interests`). `POST …/quests/log` adds 1, once a day per quest and up to its target;
      only a picked interest logs (`409 interest_not_picked`).
    - Writes run in a transaction behind the child's and account's tombstones; removed in
      `delete_child` and `delete_user`. Stars stay with 3.2 (children's `kid_activity`).
- [x] **3.2 Transform tab.** *(done)*
  - **Delivers:** pick an interest, the three quests with their counts, log a quest (+ a star,
    through `transform.quest_logged`, the first time each quest is done).
  - **Needs:** 2.2, 3.1.
  - **Check:** component tests.
  - **As built:**
    - `components/kids/TransformQuests.tsx` (both apps) over `useKidQuests` (3.1's API, in
      `api/kidQuests.ts`): no interest yet asks "What are you into?"; otherwise the interest
      chips ("From your parent" / "You added", "+ Add another"), and the three quests with a
      dot per time and "I did it today" (once a day, "Quest done!" at the target).
    - The star: transform publishes `transform.quest_logged` with each counted log (in the
      log's transaction), and children's worker gives `quest:<interest>:<i>` (+1 once per
      quest, whether or not Transform is open in child view yet: the log was already
      accepted, and a quest can arrive before the world that opens it). The app then re-reads the activity until Transform
      shows as done (`awaitProgress` in `useKidActivity`). Before 2026-11-12 the app sent a
      `quest` kids event itself, a second call that could be lost. The
      prototype also gave +1 a log and +5 at the end; one star a quest keeps it to what
      children can check without asking transform.
    - The quest cards and dots are `.kids-quest*` (web) and `questCard` / `questDot`
      (mobile), cycling the powers' six token pairs.
- [x] **3.3 Transform in parent view.** *(done)*
  - **Delivers:** on the parent's LifePathway page, a section with the child's quest counts and
    dates for the plan's interest, or "Nothing logged yet". Styled like the rest of that page,
    with its existing constellation tokens: no kids tokens in parent view.
  - **Needs:** 3.1.
  - **Check:** component tests for both states.
  - **As built:** a "<name>'s quests" section above the Life Pathway's closing CTA
    (`components/lifepathway/ChildQuests.tsx` on web, `lifePathwayPage/ChildQuestsSection.tsx`
    on mobile), over 3.1's `GET …/quests`, which now also returns `last_logged` (each quest's
    last day). It lists the plan's interest ("From your plan") and any the child added and
    logged, each quest as "2 of 5 · last 10 Nov" or "Done", else "Nothing logged yet". The
    summary is shared (`questSummary` in `api/kidQuests.ts`); it's hidden while loading or
    when transform refuses.
- [x] **3.4 grow: world runs.** *(done)*
  - **Delivers:** per P.3. A `world_runs` collection in grow: `child_id`, `world` (0–5),
    `total`, `scores` (three), `created_at`; the last 10 runs per world kept.
    - The six worlds' games as data (a JSON file next to `area_data.json`).
    - `GET /api/v1/children/{id}/growth-areas/worlds` and `POST …/worlds/{world}/runs`. Scores
      are checked (0–100); behind the grow lock.
    - Purged in grow's `delete_child` / `delete_user`
      ([grow/app/lifecycle.py](../backend/grow/app/lifecycle.py)).
  - **Needs:** P.3 *(parallel with 3.1)*.
  - **Check:** grow unit tests (save, trim to 10, checks, lock, purge); OpenAPI and client sync.
  - **As built:**
    - One `world_runs` document per child (`grow/app/worlds.py`), not one per run:
      `runs.<world>` holds the runs oldest first, and a single `$push` with `$slice: -10` adds
      one and trims, so two runs at once can't leave 11. Each run is `scores` (three, 0–100),
      `total` (their mean, rounded half up) and `at`.
    - `worlds.json`: the prototype's six worlds (name, icon, mission, hint) and 18 games (type,
      title, skill, how, tip, `cfg`), each with its "Build on" and "Support" text (3.6; now
      only for the recommendations' prompt, not served),
      written with the `{He}` / `{his}` / `{s}` tokens instead of "his/him"; the bands too.
      The game types are `dash`, `sort`, `timing`, `catch`, `memory`, `spark` and `react`
      (the plan named four).
    - `GET …/growth-areas/worlds` (the worlds, bands and runs) and `POST …/worlds/{world}/runs`;
      parents only, behind the grow lock; writes behind the tombstones; removed in
      `delete_child` and `delete_user`.
    - Left out: the prototype's Dream Catcher "insight" (it needs per-game stats beyond the
      scores) and its 2 stars a world a day (not in the plan; can come with 3.5).
- [x] **3.5 Grow tab.** *(done)*
  - **Delivers:** pick a world, the three games (tap, sort, catch, timing types), the result
    with a score band ("Super strong", "Growing well", "Keep practising"), saved as a run. The
    bands' colours (gold, cyan, violet) are tokens.
  - **Needs:** 2.2, 3.4.
  - **Check:** a test per game type; component tests for the flow.
  - **As built:**
    - The prototype's seven game types (`catch`, `sort`, `memory`, `timing`, `dash`, `react`,
      `spark`), their rules and scoring shared in `lib/kidsGrow.ts` (both apps); each app's
      `components/kids/GrowGames.tsx` only draws them. Discover's and Grow's games share
      `GamePieces.tsx` (the sky, bar, captions and readouts) and `useCountdown`.
    - `GrowWorlds.tsx` (both apps) over `useKidWorlds` (3.4's API, in `api/kidWorlds.ts`):
      the six worlds (last total and a tick once played), each game's intro, play and result
      (score, band, line, "Try again"), then the report: the total, its band and "Up 5 since
      last time", each game's score bar, the strongest skill and the one to practise (with its
      tip), and the world's mission. "Finish world" saves the run.
    - Band colours: gold, cyan and violet are the kids `transform`, `discover` and `release`
      tokens (`BAND_COLOR`); Tailwind gains `kids-tile` for a tile's own pair.
    - Left out from the prototype: the sounds, the Dream Catcher insight, sharing (P.2) and
      the 2 stars a world a day (no star for a world yet; children's `kid_activity` would
      need a `world` event).
- [x] **3.6 Grow in parent view.** *(done)*
  - **Delivers:** on the parent's GrowthAreas page, each world's latest score and when, with a
    "Build on" suggestion for the best game and a "Support" one for the weakest (suggestion text
    as data with the worlds). The tag colours (gold "Build on", cyan "Support") are the existing
    constellation tokens the page already uses.
  - **Needs:** 3.4.
  - **Check:** component tests (no runs, one run, several).
  - **As built:** as in the prototype, a world is its growth area's (matched by name). The map
    shows "Kids 78" under each area the child has played, in the page's gold. Each area's
    sheet ends, in every phase, with "<name>'s games" (`components/growth/ChildWorldPanel.tsx`,
    both apps): "Played 2 days ago · 3 tries · +5 vs last try" and the total, opening to each
    game's score bar (band colours gold, cyan and a new `--constellation-lavender-rgb`) and
    the "Build on" (best game, gold tag) and "Support" (weakest, cyan tag) suggestions, filled
    with the child's name and pronouns. The summary is shared (`worldSummary` in
    `api/kidWorlds.ts`).
  - **As built, later:** the parent's Growth popup now shows Growth insights fed by the world
    runs, and the handover is gone. Grow's `child_rounds` (the six either/or rounds), the
    child's picks (`child_activity.selections`) and the archetype result were removed (P.3
    revisited): the world runs are the child's own input to Grow now, so a second child step
    inside each area only repeated it. The recommendations are AI-written from the parent's
    reflections plus the latest run of the area's world (each game's score and band, the
    tries, the change since the last run, the best game's "Build on" and the weakest game's
    "Support"), five of them, each tagged `source` (`both`, `kid`, `you` or `step`; the fifth
    is the next step). They can start with the answers or a run (`409 needs_input` with
    neither), and the area's `recommendations_run_at` records the run they used, so the
    popup regenerates when a newer run arrives. `ChildWorldPanel` is gone, and the worlds'
    "Build on" / "Support" text is no longer served by `GET …/worlds`: it only grounds the
    prompt.
    Release's observations now use the game results as the child evidence: the recommendations
    job stores that run's games as `child_games` ("Played X (Skill): N of 100, Band" lines), sent
    in grow's area events instead of the removed `child_choices`.

**Gate:** `./check.sh`, then the manual pass of Phase 2 plus quests and worlds, checking that the
parent pages show what the child did.

---

## Phase 4 — Connect, hardening and launch

- [x] **4.1 Connect tab.** *(done)*
  - **Delivers:** the child's wins: from their awards (2.1), quests (3.1) and world runs (3.4),
    not the hardcoded `BASE_ITEMS`. Sending follows P.2 (recommended: "Show my grown-up"). If
    sharing stays, the WhatsApp button uses the existing `--whatsapp-*` tokens.
  - **Needs:** 3.2, 3.5, P.2.
  - **Check:** component tests.
  - **As built:** the wins come from the child's own data (`lib/kidsWins.ts`, both apps):
    each finished quest, each world played ("Super strong in …" at the gold band), the
    Discover badge (or "Opened N superpowers"), and a check-in streak of 3 days or more. Per
    P.2 nothing is shared from child view: "Show my grown-up" sends children a `show_win`
    (`kid_activity.shown`, at most 60, no stars), and the parent's Connect page puts those
    wins first in its own list ("From <name>"), shared with the existing WhatsApp,
    Instagram and X flows. The card shows only the first name. `ComingSoon` is gone: every
    circle has its kids tab.
- [x] **4.2 Hardening.** *(done; the e2e runs passed on 2026-11-12)*
  - **Delivers:** the kids write endpoints under each service's existing limiter (checked, not
    assumed); the new collections in the data-residency and backup notes
    ([data-residency.md](data-residency.md)); child-view events in the e2e journey (with
    agreement, as it costs LLM calls).
  - **Needs:** 4.1.
  - **As built:** each child-view route's limit is checked by a test that sees the 429
    (children's events 120/min, transform's quest pick 60 and log 120, grow's runs 60,
    discover's powers 60). The three new collections are in data-residency.md.
  - **e2e:** `journey.child_view` (scripts/e2e/journey.py) plays child view after Connect:
    the powers, every flip, a try, two game times, a mood, a quest picked and logged twice
    (counted once), a world run and a shown win, then checks the server's star sum (13) and
    the parent-side reads. It makes no LLM call. It's in the shared walk, so
    full-journey.py runs it and account-deletion.py's scan (every collection) proves
    `kid_activity`, `kid_quests` and `world_runs` are emptied with the account. Run on
    2026-11-12 in test mode: full-journey, account-deletion and convergence all passed.
- [x] **4.3 Docs.** *(done)*
  - **Delivers:** the kids endpoints in [api.md](api.md); child view in
    [frontend.md](frontend.md) (the provider, the guard, the routes); this file's status.
  - **Needs:** 4.1 *(parallel with 4.2)*.
- [ ] **4.4 Launch on dev, then stg.**
  - **Delivers:** a full pass on dev (web, Android, iOS) of every circle in both views, a
    deletion of a child with kids activity (every new collection empty afterwards), then stg.
  - **Needs:** 4.2, 4.3.

**Gate:** `./check.sh` and the 4.4 pass.

---

## Out of scope

- Child logins or child accounts: child view stays a mode of the parent's session.
- Enforcing child view on the API: the token is the parent's, and (P.1) nothing guards the way
  back to parent view.
- Telling one device's view from another's: each device keeps its own (1.1), and nothing on
  the server knows which view a device is in.
- The prototype's sample content (names, photo, wins). Its layout and visual details stay the
  reference, but its colours and fonts are re-expressed through the theme (**Theming**).
