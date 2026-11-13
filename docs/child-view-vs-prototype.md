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

### Hub (circles) — `pages/PersonalityJourney.tsx`

- **H1.** The Discover hover tooltip: "Explore {name}'s personality analysis results" (the prototype
  names Rahul; use the real child). Web only (no hover on mobile).
- **H2.** A ring on the tapped circle before it opens (the prototype's `sel` box-shadow).
- **H3.** The Discover portal video: `object-cover` with the prototype's filter
  (`hue-rotate(-8deg) saturate(1.15) contrast(1.05)`) and radial overlay, cut at 3000 ms.

### Profile menu — `Layout.tsx`, `ProfileChildren.tsx`

- **P1.** In child view, the child's row reads "Child · age N" (now "Child view").

### Kids page shell — `KidsMode.tsx`, `KidsHeader.tsx`

- **S1.** Home: the prototype's house icon (no door), a 4 px press, 22 px right padding.
- **S2.** Area chip: .08em tracking, 18 px left padding.
- **S3.** "Read to me" when on: always cyan (#4be9ff on #1b8aa3, dark ink), Rajdhani 700 16 px,
  gap 10, a 4 px press with the shadow unchanged, 22 px icon.
- **S4.** Discover's read-aloud text built from the child's result: "You are The {style}. {line}.
  Tap each power around you." (now "You have superpowers. Tap each power around you.").
- **S5.** Confetti: 46 pieces plus a cyan and a gold ring each time Discover opens, and on the Grow
  report (the plan already promises it at lines ~77, 199 and 512). Off under reduced motion.

### Discover — `DiscoverPowers.tsx`

- **D1.** The eyebrow pops in (`kPop .6s`); the name pill rises (`kUp .5s .5s`) instead of fading;
  the count pill pops for 0.6 s (now 0.7 s).
- **D2.** The hover tip gets its small arrow and a .2 s fade (keep it on keyboard focus too).
- **D3.** Heading #e7f5f9 (now #f2fbff); "The {style}" with a cyan glow (`text-shadow 0 0 28px`).
- **D4.** Gold #ffd98a (`constellation-gold-bright`) for the eyebrow, twinkles and the opened
  power's edge (now #ffe08a).
- **D5.** Photo ring: the 4-stop conic (cyan, #0a5b74, cyan-bright, cyan); inner #0e3a4a; photo
  position 50% 35%.
- **D6.** Power bubbles: rgba(14,58,74,.9) → rgba(5,19,26,.95); selected #1ec4e8 → #0a5b74;
  cyan-bright glow; selected ink #eafdff.
- **D7.** Name pill and tip background #05131a, text #eafdff (now #060a18 / #f2fbff).
- **D8.** Count pill gradient cyan-bright → #0a5b74 (now cyan → #1b8aa3).

### Game dialog — `GameDialog.tsx`

- **G1.** Backdrop rgba(2,6,15,.84) with 6 px blur (web only), padding 20, a .25 s rise-in.
- **G2.** Panel 540 px, radius 32, gradient #0e3a4a → #05131a, 1 px border, two shadows, pops in.
- **G3.** Title row: the icon inside a 48 px circle (cyan border, tinted fill) at 26 px; title
  Orbitron 700 22 px, .04em, #eafdff; close as a 48 px outlined circle.
- **G4.** Instruction line #e7f5f9, 21 px.
- **G5.** Win screen: the four twinkling dots, the 72 px pulsing check medallion; "You did it!"
  28 px; the seconds 44 px with a gold glow.
- **G6.** "New best!" as a solid gold pill that pops in; "Best: X.Xs" and "First try!" as an
  outlined cyan pill in grey.
- **G7.** The win line in the prototype's dashed box (navy fill, dashed cyan border, radius 18,
  19 px). For the words, see decision W1.
- **G8.** "Play again" outlined cyan, 46 px, uppercase Rajdhani; "Done" as a cyan gradient with a
  glow, uppercase.

### Discover mini games — `KidsGames.tsx`, `GamePieces.tsx`

- **M1.** Frame max `calc(100vh - 260px)`; background #0e3a4a → #05131a; captions #84a0b2.
- **M2.** The seven sky stars twinkle (1.4 s + 0.3 s per star), #eafdff.
- **M3.** Bursts: cyan for climb and energy, scale .4 → 2.6.
- **M4.** Focus: the light pulses (`kPulse 1s`), moves in 1.1 s, gradient ends #0a5b74.
- **M5.** Curious: closed boxes float, an opened box flips; "?" clamp(22–34 px); empty dot #3c5568.
- **M6.** Order: the line glows; the next star pulses; a wrong tap shakes; numbers clamp(16–24 px);
  a done number #05131a.
- **M7.** Draw: stroke #ffd98a with a glow.
- **M8.** Climb: the flag twinkles; the climber moves in .12 s; mountain #0a5b74.
- **M9.** Voice: dark-cyan mic circle (#1ec4e8 → #0a5b74) with a light mic, a gold border above
  90%, glow 20 → 70 px; wave bars 5 px apart.

### Grow — "Pick a world" — `GrowWorlds.tsx`

- **GW1.** "Grow" eyebrow as the bordered pill (cyan .5 border, cyan .1 fill, Rajdhani 15, .24em).
- **GW2.** Heading Orbitron 700, .02em, #e7f5f9; "world" with a cyan glow. Subtitle #84a0b2.
- **GW3.** Grid auto-fit `minmax(220px,1fr)`, gap 20, margin-top 34.
- **GW4.** World card: radius 30, padding 28/18/24, soft gradient rgba(14,58,74,.55) →
  rgba(5,19,26,.85), 1 px cyan .28 border, soft shadow.
- **GW5.** World icon: 46 px dark icon in a 104 px glowing orb (three gradients: cyan, gold,
  cyan-deep), a dashed ring spinning (18 s), the orb floating (4 s, staggered .5 s).
- **GW6.** World colours cycle through the three orbs (now the six power pairs).
- **GW7.** World name Orbitron 700 19 px #eafdff. The tag uppercase, .24em, and "Completed" in gold
  once played (keep "Last: {total}" beside it).
- **GW8.** Played marker: a 34 px gold #ffd98a disc with a dark check and 3 px dark border, popping,
  on the orb's top-right.
- **GW9.** Motion: cards unfold one after another (.08 s stagger); hover lifts 6 px, tilts ±1.5°,
  cyan border and glow; press scales to .96.

### Grow — game screens — `GrowWorlds.tsx`

- **GS1.** Header centred.
- **GS2.** Back as a 44 px outlined cyan circle with a chevron.
- **GS3.** Progress dots 46×10: done gold #ffd98a with a glow, current cyan with a glow, the rest
  cyan .14, animated.
- **GS4.** Two pills under the dots: the world name (cyan) and "Game n of 3" (gold).
- **GS5.** Game title Orbitron 700 clamp(28–44 px) #e7f5f9; how-to #84a0b2, 21 px.
- **GS6.** Intro: a square game-sized frame; the skill in gold #ffd98a, .28em; a 150 px round
  pulsing "Play" with a cyan gradient; "Played before" / "New game" (from the world's runs).
- **GS7.** Result: the 96 px gold check orb; "Well done!" in gold #ffd98a with a glow (keep the
  score and band under it, D).
- **GS8.** Result buttons outside the card, 62 px, uppercase Rajdhani: "Next game" / "Finish world"
  a cyan gradient with a glow, "Try again" outlined cyan.

### Grow — the games — `GrowGames.tsx`, `GamePieces.tsx`

- **GG1.** Frame `min(100%, 540px, 100vh - 300px)`, min 260; radial #0e3a4a → #05131a; twinkling
  sky; bar fill #1ec4e8 → #ffd98a; HUD #ffd98a; captions #84a0b2.
- **GG2.** Catch: gold bursts for good words, red #ff7a7a for bad; the basket #ffd98a with its glow.
- **GG3.** Sort: a right answer flies off toward its side (±14°, .45 s fade); a wrong one shakes
  with a red glow; each new card pops in; right border #ffd98a, wrong #ff7a7a; card
  rgba(14,58,74,.95) → rgba(5,19,26,.98); left side gold #ffd98a .25 → #8a6420 .45, right side
  cyan .45 → #0a5b74 .7.
- **GG4.** Memory: second pad #ffd98a; the frame flashes on a wrong tap.
- **GG5.** Timing: "Miss" red #ff7a7a; "Perfect!" / "Good" #ffd98a with a glow and a pop; target
  #ffd98a.
- **GG6.** Dash: a burst on each grab; picked words as gold chips (.6 border on .15 fill, Rajdhani
  14) that pop in.
- **GG7.** React: "Too soon!" red #ff7a7a; light gradient #fff6dc / #ffd98a / #8a6420.
- **GG8.** Spark: strokes glow; colours #ffd98a, #4be9ff, #3ce1be, #9d8cff, #ff8fb1; inner line white.

A red token for "wrong" doesn't exist yet: add one (e.g. `--kids-wrong-rgb`) for GG2, GG3, GG5, GG7.

### Grow — report — `GrowWorlds.tsx`

- **R1.** Eyebrow as a gold pill "{World} report"; "complete!" in gold #ffd98a with a glow,
  Orbitron 700.
- **R2.** The 150 px floating world orb with its icon (and the confetti, S5).
- **R3.** "Play again" outlined cyan, 62 px, uppercase; "Pick another world" as a borderless text
  link in #84a0b2.

### Transform — `TransformQuests.tsx`

- **T1.** Picker subtitle in the "add another" state: "Pick what else you are into. You get new
  quests for it." (keep "Pick one. You get quests for it." when there's no interest yet).
- **T2.** "Back to my quests" transparent with a 2 px gold .5 border, #ffe08a, 48 px.
- **T3.** Interest grid auto-fit `minmax(200px,1fr)`, gap 16, margin-top 30; tiles solid in their
  colour, dark ink Orbitron 900 20, radius 24, a 3 px hover lift.
- **T4.** Colour order cyan, gold, teal, pink, violet, orange for interests, quests (quests 2 and 3
  swap back) and wins (C4).
- **T5.** Quests header left-aligned, with the subtitle "Do it for real, then tap the big button."
- **T6.** Interest chips left-aligned, radius 20, min-height 60, padding 8/22, off fill gold .08,
  tag Rajdhani 14 .08em.
- **T7.** "+ Add another" with a 2 px dashed gold .5 border, transparent, Rajdhani 18 #ffe08a.
- **T8.** Quest card: two columns (content left, a 132 px round action button right), radius 28,
  padding 24/26, an 8 px shade shadow, 18 px between cards.
- **T9.** Number as a 44 px rounded square in the quest's colour with the number in dark ink.
- **T10.** How-to #d4e6ee.
- **T11.** Progress dots 30 px with a 3 px border at .4; filled ones carry a 16 px ink star.
- **T12.** Log button: the 132 px circle in the quest's own colour with a shade shadow, "+" and
  "I did it today", scaling on hover. Done: a 132 px teal circle with a check, popping in (keep
  "Quest done!").

### Release — `ReleaseCheckIn.tsx`

- **RL1.** Content max-width 1000 px.
- **RL2.** Mood grid auto-fit `minmax(150px,1fr)`, gap 16 (fits 5 in a row from about 830 px).
- **RL3.** Tile transition .12 s; Save shadow 7 px.
- **RL4.** The note card pops in (`kPop .35s`).
- **RL5.** The prototype's flame path (control point −5.5).

### Connect — `ConnectWins.tsx`

- **C1.** Two equal columns from `md` (now 1fr / 1.1fr), gap 26.
- **C2.** Win buttons: Rajdhani 700 20 px, radius 22, min-height 72, padding 14/18, gap 14; a
  neutral border, pink when picked (pink .14 fill); no shade shadow; hover slides right 4 px.
- **C3.** Dot 14 px.
- **C4.** Dot colour order as T4.
- **C5.** The card column sticks (`top: 110px`).
- **C6.** Card: pink → violet gradient (`160deg`, #ff8fb1 → #9d8cff), `0 10px 0 #5a4aa8`, radius 30,
  padding 30/28, min-height 300, left-aligned; it re-pops on each pick.
- **C7.** Card header: "SUPERPOWER" Orbitron 900 14 px .14em in dark ink on the left; a 34 px star
  (#ffe08a fill, dark stroke) spinning (8 s) on the right.
- **C8.** Win title Orbitron 900 clamp(26–34 px), dark ink #08101f, left, balanced.
- **C9.** Avatar 72 px, 4 px dark border, gold #ffe08a fill, `0 5px 0 #5a4aa8`, photo at 50% 35%;
  initial Orbitron 900 30 px dark. Name 20 px 700 #1d1640 (first name only, D).

### Parent pages

- **PP1.** Growth map "Kids N" label: 10.5 px, uppercase, .16em, margin-top 3 px (reads "KIDS 78").
- **PP2.** Life Pathway quests section: the "{n}/3 quests done" / "Not started" chip and the
  "{n} of 3 quests done" count; subtitle "Your topic: {Interest} · done in child view"; Orbitron
  700 17 px #f2fdff title.
- **PP3.** Its header stats "Logged" and "Finished n/3" ("Seen by you" needs decision Q1).
- **PP4.** Its empty state: the topic name, a "Not started" pill, "When {name} logs a {topic}
  quest in child view, it shows up here."
- **PP5.** Each row: a 48 px conic progress ring with "ct/tgt" (teal when done), a "Done" (teal) /
  "In progress" (gold) status, and relative dates ("today", "yesterday", "N days ago").

---

## 2. Needs a decision

### Behaviour

- **B1. Release streak.** The app keeps yesterday's streak until the day ends (a child who hasn't
  checked in yet today still sees "4-day streak"); the prototype shows 0 until today's check-in.
  Same on the parent's Observations moods. Changing it is one rule in `lib/kidsDay.ts`
  (`moodStreak`) in both apps.
- **B2. Read-aloud on content change.** The app reads once per area; the prototype re-reads at each
  Grow game ("{title}. {how}"), on the report ("World complete! Well done."), and the whole quest
  list. More speech for a child who can't read yet, more interruption for one who can.
- **B3. "Start Again" in child view.** Hidden in the app; the prototype shows it grey and disabled,
  "Completed". Showing it tells the child the parent's journey is done; hiding it keeps the hub to
  the child's five circles.
- **B4. "Back to parent view".** The app goes to the orb screen; the prototype stays on the screen
  it was on. Staying would land the parent on the kids page in parent view, which the app doesn't
  have.
- **B5. The hub's "Back" button and "Superpower" eyebrow in child view.** The app shows the app
  bar's wordmark and a "Back" ghost button; the prototype has an eyebrow and no Back. In child
  view, Back from the hub goes nowhere useful.
- **B6. "Month 1 · {Interest}".** The prototype's quests eyebrow names a month, but child-view
  quests aren't tied to the plan's months. Show the plan's current month, or keep "{Interest}".

### Copy

- **W1. Win lines' power tags.** The prototype ends each line with its power: "with super Focus!",
  "That's real Curiosity!", "Pure Imagination!", "He Never Gives Up!", "Brave Voice!", "So much
  Energy!", "all on his own!". Bringing them back needs second-person versions without pronouns
  ("You never give up!", "All on your own!").

### Privacy and data

- **Q1. Parent quest acknowledgement and feedback.** The prototype's parent quest rows have an
  "Acknowledge" / "Seen" toggle, a "How is it going?" panel (Going well, Too hard, Too easy, No time
  this week, Loved it), "Next month" options (Keep going, Raise the target, Make it easier, Try a new
  quest), a note, and a "Next step" line, plus "Seen by you n/3". New stored fields in transform,
  and a question of whether the feedback feeds the next plan's prompt.
- **Q2. Photo upload in child view** (Discover's "Add photo" / "Remove photo", Connect's "Add your
  photo"). The child would change their own photo from child view: storage is the existing upload
  flow, but whether a child may replace the parent-chosen photo, and the gold toasts that go with it
  ("Photo added", "Photo removed"), are product questions.
- **Q3. Zero-count quests on the parent page.** The app lists all three quests of each interest,
  including "0 of N · not yet"; the prototype lists only quests the child has logged.
- **Q4. Full name on the parent's Connect.** "From {full name}" there, first name on the child's
  card. The prototype has no equivalent; pick one.

### App issues found during the comparison (not prototype differences)

- **A1. Grow save failure.** If "Finish world" fails to save, the report still shows a total
  computed on the device, so the child sees a result that wasn't kept. (Since 2026-11-12 a saved
  run and Grow's progress can't disagree: grow publishes `grow.world_played` with the run.)
- **A2. Streak wins can be shown again.** A streak win's key is `streak:N`, which changes every day,
  so a child can "Show my grown-up" a longer streak again (up to the 60 cap).
- **A3. Parent Connect list shifts.** Shown wins load after the page and are put first, so the list
  moves and per-card edits (kept by position) land on other items.
- **A4. Parent Connect row keys.** Rows are keyed by title, so a shown win with the same title as
  another item would collide.

---

## 3. Ignore: prototype issue, or the app is better

### Demo content and contradictions

- The sample child "Rahul", his photo, "age 10", the "Priya / Rahul" profile rows, and the
  "Thinker" archetype in copy and read-aloud: the app uses the real child and result.
- The five hard-coded wins ("First in the district relay", "Finished your first build", "Science
  project picked for the fair", "Two new friends at the club", "You are The Thinker"), and the fake
  quest logs and stars seeded for untouched interests.
- "Rahul, age 10" on the Connect card beside "Only your first name goes on the card.": the app's
  first-name-only card is the consistent one (age dropped on purpose).
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
