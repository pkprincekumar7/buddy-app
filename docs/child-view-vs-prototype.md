# Child view vs the design prototype

**As of:** 2026-11-12. Prototype: *Superpower version, 4th November* (a bundled HTML file, not in
this repo). Build: the web app (`frontend/src`); the mobile app (`frontend-app/src`) follows the web
at phone width (below 640px), so an item applies to both unless it says otherwise.

Every difference found when the two were compared side by side is sorted into one of these groups:

1. **[Safe to apply](#1-safe-to-apply):** the prototype is the better or intended version, and
   matching it changes only the look, motion or copy. No new data, no change to a decision.
2. **[Needs a decision](#2-needs-a-decision):** matching the prototype changes behaviour, privacy
   or the backend, or it conflicts with something the app does on purpose. Includes a few app
   issues the comparison turned up that aren't prototype differences.
3. **[Ignore](#3-ignore-prototype-issue-or-the-app-is-better):** a problem in the prototype (demo
   content, a contradiction, a weak rule, an implementation shortcut, weaker accessibility), or the
   app's version is better. Not to be applied.

Then, for reference: [already decided](#4-already-decided) (recorded in
[child-view-build-plan.md](child-view-build-plan.md)), [web and mobile](#5-web-and-mobile), and
[fixed since the comparison](#6-fixed-since-the-comparison).

Colours in group 1 are written as the prototype's hex for reference; applying one means using (or
adding) the matching token in `frontend/src/index.css`, then `yarn theme:sync`, never a literal.

---

## 1. Safe to apply

(All of section 1 is applied; see [section 6](#6-fixed-since-the-comparison).)

---

## 2. Needs a decision

### Behaviour

(B1–B6 decided on 2026-11-14: B1, B2, B4 and B6 kept as the app has them, in [section 4](#4-already-decided); B3 and B5 applied, in [section 6](#6-fixed-since-the-comparison).)

### Copy

(W1 applied on 2026-11-14; see [section 6](#6-fixed-since-the-comparison).)

### Privacy and data

- **Q1. Parent quest acknowledgement and feedback.** The prototype's parent quest rows have an
  "Acknowledge" / "Seen" toggle, a "How is it going?" panel (Going well, Too hard, Too easy, No time
  this week, Loved it), "Next month" options (Keep going, Raise the target, Make it easier, Try a new
  quest), a note, and a "Next step" line, plus "Seen by you n/3". New stored fields in transform,
  and a question of whether the feedback feeds the next plan's prompt. **Deferred (2026-11-14):**
  to be planned as its own piece of work, not part of this comparison.

(Q2, Q3 and Q4 decided; see [section 4](#4-already-decided) and [section 6](#6-fixed-since-the-comparison).)

### App issues found during the comparison (not prototype differences)

(A1–A4 fixed on 2026-11-14; see [section 6](#6-fixed-since-the-comparison).)

---

## 3. Ignore: prototype issue, or the app is better

### Demo content and contradictions

- The sample child "Rahul", his photo, "age 10", the "Priya / Rahul" profile rows, and the
  "Thinker" archetype in copy and read-aloud: the app uses the real child and result.
- The five hard-coded wins ("First in the district relay", "Finished your first build", "Science
  project picked for the fair", "Two new friends at the club", "You are The Thinker"), and the fake
  quest logs and stars seeded for untouched interests.
- He/his in copy ("He loved it", "all on his own!", "He Never Gives Up!", "plan his next month"):
  the app writes to the child and names no pronoun.
- "Kids Mode": the app calls it child view throughout.

### Weak rules

- Quests: +1 star per tap with no daily limit and +5 on completion; sharing gives +1 star; awards
  keyed by list position (`share:<index>`), so they move when the list changes. The app logs once a
  day, gives stars once, and keys wins by what they are.
- Grow's +2 stars per world per day (dropped with the stars, D).

### Implementation shortcuts

- Everything kept in `localStorage`, unpadded day keys (`2026-11-1`), the note dropped on save.
- The kids page as an iframe over the hub, the 900 ms veil, the bottom "Back" pill and the profile
  pill hidden while it's open (the app has a route, the app bar and Home).
- `sort(random - .5)` shuffling (the app's Fisher–Yates is unbiased); Catch with no fallback when
  the bad list runs out; Spark dropping a point before lighting its cell.
- Values computed but never shown (Grow's score, band, strongest, weakest, mission): the app shows
  them (D).
- Bottom padding 120 px, there to clear the iframe's "Back" pill.
- The round ambient / voice toggle at the bottom right: the app's header holds the voice control.
- The Grow spoke drawn slate (the prototype marks Grow inactive; the app shows locks).
- The frontier spoke always on Discover: the app puts it on the child's next circle.

### Where the app is better

- Locked, loading and error states with "Try again" (Discover, Grow, Transform, Release, Connect).
- Busy states ("Saving…", disabled buttons while sending), failed-save toasts, the
  "Your grown-up has lots to see already." limit message.
- Accessibility: radio roles and labels, `role="status"`, focus on × in the game dialog, Escape to
  close, closing only when a press started on the backdrop, Escape and click-outside on the profile
  menu, the power labels "{name}: play its game" (not "click here to enjoy the game"), the profile
  button "Your profile", keyboard controls and labels in the games.
- The profile panel's 288 px (it holds edit, remove and "Add Child"); the plain "Child" label for a
  child with no age.
- Pre-filling today's mood and note on return; the empty "No wins yet" state; the teal tick on wins
  already shown; "Done today" after the day's log.
- Taps on click rather than pointer-down (no accidental presses while scrolling); memory pads
  disabled outside the child's turn.
- The read-aloud voice and pitch coming from the app's one TTS setting.
- The parent Connect "From {name}" strings and Observations' moods (not in the prototype; D).

---

## 4. Already decided

Recorded in [child-view-build-plan.md](child-view-build-plan.md), not to be changed back:

- Circles lock in the child's order; a locked circle shows "{Area} opens later" / "Keep going!".
- No PIN on "Back to parent view" (P.1); no sharing from child view, "Show my grown-up" instead,
  shared from the parent's Connect (P.2); Grow's handover removed, worlds feed recommendations (P.3);
  Discover's powers from the child's real result (P.4).
- No child versions of Connect, Growth, Life Pathway or Observations.
- The app bar and the kids bar on the kids page; the avatar video on entry; the page fade; ambient
  music kept; read-aloud through the app's TTS preference, once per entry.
- Stars: kept on the server, not shown; +1 for a flip, +3 for the badge, +1 for a mood a day, +1
  for a quest's first log; none for Grow or sharing.
- Data on the server: moods with the note (capped at 500 characters), quest logs once a day, world
  runs (10 kept), best times (0.5–600 s); the interest from the plan's text, or the picker.
- Tokens instead of hex; Tailwind-scale sizes; no sounds in the games; the Grow insight box not
  built; Grow's report contents (total, trend, strongest, keep practising, mission).
- Type, buttons, tiles and spacing follow the parent pages' size scale (2026-11-13), not the
  prototype's larger child sizes; the game play areas keep their size (build plan, **Theming**).
- The profile menu's real rows, "Add Child", and opening a child's view at the circles.
- Decided on 2026-11-14 (was Q2): no photo upload in child view; the photo stays the one the
  parent chose, and the gold "Photo added" / "Photo removed" toasts aren't built.
- Decided earlier (was Q3): the parent page lists all three quests of each interest, "0 of N"
  ones included.
- Decided on 2026-11-14 (was B1, B2, B4, B6): the Release streak keeps yesterday's count until
  the day ends; read-aloud once per area, not again at each Grow game, report or quest list;
  "Back to parent view" goes to the orb screen; the quests eyebrow stays "{Interest}" (child-view
  quests aren't tied to the plan's months).

## 5. Web and mobile

On 2026-11-12 the mobile kids screens were aligned with the web at phone width, and the web's
secondary kids button (`.kids-btn-off`) was made fully rounded like mobile's. What still differs on
purpose:

- No backdrop blur on mobile; the game dialog is in a Portal and keeps clear of the notch.
- No hover tips or hover motion, and no keyboard controls in the games, on mobile.
- Animation by transform and opacity only on mobile: the game progress bar's fill jumps instead
  of sliding, and the timing and voice rings grow by scaling (their thin borders scale with them).
- The kids page glow stays fixed behind the scroll on mobile; on the web it scrolls with the page.
- The profile pill shows the dot only on mobile; the web also hides the name below 640px.
- The web games' `aria-live` captions aren't ported to mobile.
- Mobile's style file (`components/kids/palette.ts`) still has older sizes for some Grow game
  pieces, which `GrowGames.tsx` overrides; nothing differs on screen.

Applying an item from group 1 means changing both apps the same way.

## 6. Fixed since the comparison

- The web's secondary kids buttons were square-cornered (Grow's Back, "Try again", "Pick another
  world"; Transform's "Back to my quests" and "Done today"; the game dialog's × and "Done").
- On mobile: the kids bar didn't stick and its controls were smaller; Discover had no looping
  animations, a solid photo ring, the name pill at 63%, fixed type sizes and a faded inner ring;
  the game dialog closed only with × or Back and its "Done" was in Orbitron; Release's headings,
  tiles, note card and streak row were smaller, with Save on its own line; Connect's heading, card
  and button were smaller; Grow used each world's colour where the web uses the Grow colour; quest
  dots sat below the how-to.
- Grow's "Pick a world" (was GW1–GW9), applied on 2026-11-14 to both apps: the cyan pill eyebrow,
  the heading with the glowing "world", the auto-fit grid (two columns on phones), a gradient card
  per world with its 104 px orb (cyan, gold and sky in turn, a spinning dashed ring, floating),
  the dark icon, the gold played marker, "Completed" in gold with "Last: {total}" under it, and
  the cards unfolding in turn, lifting on hover (no tilt, as the prototype renders) and shrinking on press. Sizes follow
  the parent pages' scale (an 88 px orb and 16 px names on phones) rather than the prototype's.
- Grow's game screens and report (was GS1–GS8, R1–R3), applied on 2026-11-14 to both apps: a
  centred header with a round outlined Back and glowing gold/cyan dots; the world and "Game n of
  3" pills; the intro as a square frame with the skill in gold, a round pulsing Play and "Played
  before" / "New game"; the score card with the gold check orb and a glowing gold "Well done!"
  (the score and band kept under it); "Next game" / "Finish world" as a cyan gradient and "Try
  again" outlined, outside the card; the report's gold pill, gold "complete!" and floating world
  orb, "Play again" outlined and "Pick another world" as a text link. Each view rises or pops in
  as the prototype's. Buttons stay on the parent pages' height (44/48 px, not 62 px); R2's
  confetti stays with S5.
- Grow's games (was GG1–GG8), applied on 2026-11-14 to both apps: Grow's frame size
  (`min(100%, 540px, 100vh - 300px)`, at least 260 px); the frame, bar, sky and readouts as the
  prototype's; Catch's gold or red burst per catch and the glowing gold basket; Sort's card that
  pops in, shakes red when wrong and flies off toward its side when right, with the gold and cyan
  sides; Memory's gold second pad, white-lit pads and the frame flashing on a wrong tap; Timing's
  gold target and glowing, popping "Perfect!" / "Good" / red "Miss"; Dash's burst per grab and
  gold chips; React's gold light (popping in) and red "Too soon!"; Spark's gold-first colours,
  glowing strokes and white core. New tokens: `--kids-wrong-rgb`, `--kids-white-rgb`,
  `--kids-gold-shade-rgb`. The prototype centres the popping pieces with `transform`, which its
  pop would override (they'd jump off centre); the app centres them with `translate`. The stroke
  glow is an SVG blur filter (CSS `drop-shadow` on SVG strokes doesn't render in Chrome).
- Through the shared frame pieces, Discover's mini games got M1 (frame and caption colours) and
  M2 (twinkling sky), and M3's burst size.
- The game dialog (was G1–G8), applied on 2026-11-14 to both apps: a dark veil (blurred on the
  web) that rises in; a teal-to-navy panel, 540 px, radius 32, that pops in; the power's icon in a
  tinted cyan circle, the name in Orbitron .04em, × in an outlined circle; the instruction line
  larger and brighter; on a win the four twinkling dots, the pulsing check medallion, "You did
  it!" and the time in glowing gold; "New best!" as a solid gold pill that pops in a moment later,
  "Best: X.Xs" / "First try!" as an outlined grey pill; the win line in a dashed box (its power tags
  came later, W1); "Play again" outlined cyan and "Done" as the cyan gradient. Sizes follow
  the parent pages' scale (the prototype's from `md`), buttons 44/48 px rather than 46 px.
- Discover (was D1–D8), applied on 2026-11-14 to both apps: the eyebrow pops (.6 s), the name
  pill rises in after .5 s, the count pill pops for .6 s; the hover tip fades in with its small
  arrow (web, also on keyboard focus); the heading #e7f5f9 with "The {style}" glowing cyan; gold
  #ffd98a for the eyebrow, its twinkles and an opened power's edge; the photo ring's four-stop
  gradient (drawn as blended wedges on mobile), its inner #0e3a4a and dark edge, the photo at
  50% 35% (web; React Native's Image can't set it); the bubbles deep teal, lit cyan-bright to
  #0a5b74 with light ink; the name pill and tip on #05131a with #eafdff text; the count pill
  cyan-bright to #0a5b74. The name pill centres with `translate`, so its rise can't move it.
- Discover's mini games (was M3–M9), applied on 2026-11-14 to both apps: cyan rings for climb
  and energy; Focus's light pulsing (1 s), gliding in 1.1 s, its gradient ending #0a5b74;
  Curious's closed boxes floating (each at its own pace), an opened one flipping, a larger "?",
  the empty dot #3c5568 (`--kids-empty-rgb`) and a gold planet; Order's glowing line, the next
  star pulsing, a wrong one shaking, larger numbers and a dark number on a done (gold) star;
  Draw's gold stroke with a glow; Climb's twinkling flag, the climber's .12 s step, the mountain
  #0a5b74; Voice's dark-cyan mic with a light icon, gold-edged above 90%, its glow 20 → 70 px,
  the wave bars 5 px apart. The stars centre with `translate`, so their pulse and shake can't
  move them; the line glows are SVG blur filters.
- Transform (was T1–T12) and Connect's win colours (C4), applied on 2026-11-14 to both apps: the
  picker's "add another" line; "Back to my quests" outlined gold; solid interest tiles on their
  shade in an auto-fit grid (two columns on phones); the kids palette in the prototype's order
  (cyan, gold, teal, pink, violet, orange; `KIDS_COLORS`, was `POWER_COLORS`) for interests,
  quests and Connect's wins; the quests header left-aligned with "Do it for real, then tap the
  big button."; gold-edged interest chips and a dashed "+ Add another"; quest cards in two
  columns on their shade, a numbered square, the how-to #d4e6ee (`--kids-how-rgb`), 30 px
  progress rings with a star, and the round "I did it today" button (112 px on phones, 132 px
  from `md`), "Done today" in grey, and the teal "Quest done!" circle that pops in.
- Connect (was C1–C3, C5–C9), applied on 2026-11-14 to both apps: two equal columns from `md`
  (gap 26) with the card column sticking (`top: 110px`, web); the wins as Rajdhani buttons with
  a neutral edge, pink when picked, a 14 px dot, sliding right on hover; the card as the pink →
  violet gradient on its violet shade, re-popping on each pick, "SUPERPOWER" in dark ink with a
  gold star spinning (8 s), the win title in dark Orbitron, the gold avatar with a dark edge
  (photo at 50% 35% on the web) and the first name in #1d1640 (`--kids-card-name-rgb`). Sizes
  follow the parent pages' scale (the prototype's from `md`). "Show my grown-up" stays (P.2).
- The Connect card's "{first name}, age {age}" (was listed under Ignore), applied on 2026-11-14
  at the owner's request: the age is shown when one is saved, and the line under the card reads
  "Only your first name and age go on the card." (just the first name, and the old line,
  without an age).
- The Orbitron font files (2026-11-14): the bundled ones were lighter than the prototype's
  Google Fonts Orbitron (the web "Black" drew about 22% less than Google's 900, and the mobile
  "Black" file was Orbitron Medium inside). Both apps now use Google's Orbitron v35: one
  variable `Orbitron.woff2` (400–900) on the web, static `Orbitron-Bold.ttf` / `-Black.ttf` on
  mobile; measured identical to the prototype's. The headings set to 900 to make up for it (Grow's
  heading, world names, report and game titles, Play, the game dialog's title, "You did it!" and
  time) are back at the prototype's 700. This changes every Orbitron heading, parent pages too.
- Release (was RL1–RL5), applied on 2026-11-14 to both apps: content up to 1000 px; the moods in
  an auto-fit `minmax(150px,1fr)` grid, gap 16 (five in a row from about 830 px, two on phones);
  the tiles' .12 s press; Save on a 7 px shade; the note card popping in (.35 s); the prototype's
  flame path. Found on the way: the base `button:not(:disabled)` transition (150 ms, transform
  and opacity) out-ranked every kids class's own transition, so world cards, the Play orb, quest
  and interest buttons, win buttons and tiles all moved at 150 ms with their glows snapping. On
  the kids page that default now sits at the lowest specificity, so each class's own wins; the
  rest of the app is unchanged.
- The kids page shell (was S1–S5), applied on 2026-11-14 to both apps: Home with the
  prototype's house (roof and walls, no door), 16/22 px padding and a 4 px press; the area chip
  at .08em tracking with 18 px padding; "Read to me" while on always cyan on its shade with dark
  ink, Rajdhani, a 10 px gap and a 4 px press that keeps its shadow; Discover's read-aloud from
  the child's own result ("You are The {style}. {line} Tap each power around you.", waiting for
  the result; `discoverReadAloud`, tested); confetti (`Confetti`, both apps): a cyan and a gold
  ring and 46 pieces flung from the middle, each time Discover opens and over the orb of a
  finished Grow world's report, none under reduced motion. Sizes follow the parent pages' scale
  (the prototype's 56 px bar buttons stay 40 px).
- The hub and profile menu (was H1–H3, P1), applied on 2026-11-14 to both apps: Discover's
  hover tip "Explore {first name}'s personality analysis results" with its arrow (web, on
  devices that hover, also on keyboard focus); a tapped circle ringed (the prototype's `sel`
  glow) for 200 ms before its page opens; the Discover portal video filling the screen with the
  prototype's tint and cyan glow and moving on at 3 s (`StageSplash` `portal`; the tint is
  Android-only on mobile, as React Native's `filter` is); in child view, the profile menu's
  child row reads "Child · age N" (`childSubtitle`). The hub is shared, so these show in parent
  view too, as in the prototype.
- The parent pages (was PP1–PP5), applied on 2026-11-14 to both apps: the Growth map's "Kids N"
  label at 10.5 px, uppercase, .16em ("KIDS 78"); Life Pathway's quests as the prototype's panel:
  "{name}'s quests" with a "{n}/3 quests done" / "Not started" chip, "Your topic: {interest} ·
  done in child view", the plan topic's "Logged" and "Finished n/3" ("Seen by you" waits on Q1),
  its empty state (the topic, "Not started", "When {name} logs a {topic} quest in child view, it
  shows up here."; shown until anything is logged, in the topic or an added interest), and each
  quest's 48 px progress ring ("ct/tgt", teal when done), "Done" /
  "In progress" / "Not started" status and "Last logged today / yesterday / N days ago" (the
  how-to before the first log); an interest the child added follows with its own label. Kept
  as the app has them: all three quests per interest (Q3), and the dashboard's own chips, which
  count the parent's plan (the prototype puts the child's quest counts there). New tokens:
  `--constellation-panel-rgb`, `-ring-core-rgb`, `-teal-rgb`, `-teal-pale-rgb`,
  `-slate-dim-rgb`, `-slate-pale-rgb`; helpers `daysAgo` and `questTotals` (tested).
- The hub in child view and the win lines (was B3, B5, W1), applied on 2026-11-14 to both apps:
  in child view the hub shows Start Again greyed out and disabled (the locked circle's look, a
  tick badge, "Start Again" over "Completed"), only the parent starting over; the app bar's Back
  is hidden on the journey (it's the child's home) and a "Superpower" eyebrow sits on top
  (Rajdhani 700, 12 px, .4em, cyan-bright, fading up at .5 s). Parent view keeps Back and the
  working Start Again. Each win line ends with its power in the second person: "with super
  Focus!", "That's real Curiosity!", "all on your own!", "Pure Imagination!", "You never give
  up!", "Brave Voice!", "So much Energy!".
- The parent's Connect list (was A3, A4), fixed on 2026-11-14 in both apps: each item has a
  stable id (a shown win's is `shown:{key}`, the page's own a fixed name), and the picked card,
  the parent's edits and the row keys use it, so wins loading after the page no longer move a
  pick or an edit onto another item, and two items with one title no longer collide. The list
  is built by `connectItems` (components/connect/shared, tested on mobile).
- Streak wins (was A2), fixed on 2026-11-14 in both apps: a streak's win is the longest
  milestone it has reached, 3, 7, 14, 30 or 60 days (`STREAK_MILESTONES`, `streakMilestone` in
  lib/kidsWins, tested on mobile), keyed `streak:{milestone}`, so a 9-day streak is the "7-day
  check-in streak" win and each milestone is shown to the grown-up once. No server change: the
  key's format is unchanged.
- Grow's failed save (was A1), fixed on 2026-11-14 in both apps: when "Finish world" doesn't
  save, the child stays on the last game's result with "That world didn't save. Tap Finish
  world to try again." (and the toast as before), so the report only ever shows the total the
  server kept; nothing is worked out on the device any more. Tested on mobile (a failed save,
  then a retry to the report).
- The name on the parent's Connect (was Q4), applied on 2026-11-14 to both apps: the shown wins
  read "From {first name}" and "{first name} chose to show you this in child view.", as the
  child's card uses the first name ("Your child" without one); `connectItems` takes the child's
  name and uses its first word (tested on mobile).
