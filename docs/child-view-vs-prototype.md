# Child view vs the design prototype

**As of:** 2026-11-12. Prototype: *Superpower version, 4th November* (a bundled HTML file, not in
this repo). Build: the web app (`frontend/src`); the mobile app (`frontend-app/src`) now follows the
web at phone width (below 640px), so a web item applies to both unless marked otherwise.

- **D**: the difference is recorded in [child-view-build-plan.md](child-view-build-plan.md).
- **U**: not recorded there.
- Hex colours replaced by tokens, and sizes rounded to the Tailwind scale, are covered by the plan's
  Theming rules (D), unless the token is a *different colour* from the prototype's (listed as U).
- **Fixed** marks a difference that was there when the comparison was made and has since been
  closed (2026-11-12). Everything else is still open; none of it has been decided as a change yet.

### Web and mobile

Fixed on 2026-11-12: the mobile kids screens were aligned with the web at phone width (kids bar,
Discover, the game dialog and games, Grow, Transform, Release and Connect), and the web's
secondary kids button (`.kids-btn-off`) was made fully rounded like mobile's. What still differs
on purpose:

- No backdrop blur on mobile; the game dialog is in a Portal and keeps clear of the notch.
- No hover tips or hover motion, and no keyboard controls in the games, on mobile.
- Animation by transform and opacity only on mobile: the game progress bar's fill jumps instead
  of sliding, and the timing and voice rings grow by scaling (their thin borders scale with them).
- The kids page glow stays fixed behind the scroll on mobile; on the web it scrolls with the page.
- The profile pill shows the dot only on mobile. The web also hides the name below 640px, so at
  phone width they match.
- The web games' `aria-live` captions aren't ported to mobile.
- Mobile's style file (`components/kids/palette.ts`) still has older sizes for some Grow game
  pieces, which `GrowGames.tsx` overrides; nothing differs on screen.

---

## 1. Hub (circles) in child view — `pages/PersonalityJourney.tsx`

1. Circles lock in the child's order (Discover → Grow → Transform → Release → Connect), locked ones dim; prototype has no locks. **D**
2. The glowing spoke and moving dots sit on the child's next circle; prototype always on Discover. **U**
3. "Start Again" is hidden in child view; prototype shows it grey, disabled, check badge, "Completed". **U**
4. Discover hover tooltip "Explore Rahul's personality analysis Results" is missing. **U**
5. No ring on the tapped circle before it opens (prototype `sel` box-shadow). **U**
6. Grow spoke is cyan; prototype slate #5b6b78, 1.1px, opacity .22. **U**
7. No "Superpower" eyebrow at the top of the hub; the app bar and an extra "Back" ghost button are there instead. **U**
8. Sound: prototype's round ambient/voice toggle at bottom right is replaced by the header TTS button. **U**
9. Discover tap: video plays to its end (prototype cuts at 3000 ms), `object-contain` (prototype `object-cover` with hue/saturate/contrast filter and radial overlay). No `viewed` call is D; length, fit and filter **U**
10. Transform/Grow: the hub navigates at once and the kids page plays its video; prototype plays Transform's 5 s video on the hub, Grow none. **D**
11. Kids page is a route (prototype an iframe with a 900 ms veil and .6 s fade, a bottom-centre "Back" pill, profile pill hidden). Fade and app bar **D**; missing bottom "Back" pill **U**
12. Ambient music keeps playing on the kids page (prototype mutes it). **D**

## 2. Profile menu — `Layout.tsx`, `ProfileChildren.tsx`

1. Heading "Signed-in profile" (prototype "… · preview"). **D**
2. Panel 288 px wide (prototype 230). **U**
3. Button aria-label "Your profile" (prototype "Signed-in profile"). **U**
4. Name and view label beside the dot only from `sm` up. **D**
5. Real rows: parent (not clickable), each child (photo/dot, "Child · age N" / "Child · setting up" / plain "Child"), pencil and ×, "Add Child" with "Maximum of 10 children", Home, Account settings, Sign out, plus loading/error/"Try again" and hover title. **D**; plain "Child" label **U**
6. Tapping a child opens that child's view at the circles (or onboarding if still setting up); prototype just switches role in place. **D**
7. In child view: only the child row and "← Back to parent view"; prototype lists both profiles. **D**
8. Child row text in child view is "Child view" (prototype "Child · age 10"). **U**
9. "Back to parent view" goes to `/PersonalityJourney/:childId`; prototype stays on the screen. **U**
10. Escape and click-outside close the menu (prototype neither). **U**
11. Mobile: the pill is the dot only at every width; the web also hides the name below 640px, so at phone width they match.

## 3. Kids page shell — `KidsMode.tsx`, `KidsHeader.tsx`

1. Kids bar sticky under the app bar, slightly different paddings and blur. **D**
2. Home icon is lucide `House` (with a door), not the prototype's path; press moves 5 px (prototype 4); right padding 20 (prototype 22). **U**
3. Area chip tracking .05em (prototype .08em), left padding 16 (prototype 18). **U**
4. "Read to me" on: takes the area's colour and Orbitron Black (prototype always cyan, Rajdhani 700 16); gap 8 vs 10; press 5 px and shadow shrinks; icon 20 vs 22 px. **U**
5. Read-aloud uses the app's global TTS preference (two controls for one setting). **D**
6. Reads once per area entry, after the video (D); does not re-read when content changes (each Grow step, quest list). **U**
7. Discover read-aloud text "You have superpowers. Tap each power around you." (prototype "You are The Thinker. You can think about one hard thing for a long time. Tap each power around you."); pitch 1.15 vs 1.1, different voice list. **U**
8. Star counter: neither shows one. No difference.
9. No gold toast component (prototype: star pill, Orbitron 900 19px, 2.6 s, for photo added/removed, share, copy); app only has error toasts. Share toasts **D**; photo toasts / toast component **U**
10. No confetti anywhere (prototype: 46 pieces plus cyan and gold rings each time Discover opens, and `growConfetti` on the Grow report). **U** — the plan still mentions confetti (lines ~77, 199, 512).
11. Locked-circle card "<Area> opens later" / "Keep going!". **D**
12. Extra loading and error states ("We couldn't load this." / "Try again", "Your powers are still on their way.", "We couldn't load your powers." / "Look again", page loader). **U**
13. Main area bottom padding 64 px (prototype 120). **U**
14. Speech is cancelled on unmount rather than on Home tap. Equivalent.
15. ~~Mobile: kids bar not sticky; smaller Home, chip and Read to me; Read to me stays Rajdhani.~~ **Fixed**

## 4. Discover — `DiscoverPowers.tsx`, `lib/kidsPowers.ts`

1. Eyebrow, heading and line come from the child's real result ("Hey {first name}, your superpowers are here!", "You are The {style}"). **D**
2. Power names match; levels follow the child's result. **D**
3. Power aria-label "{name}: play its game" (+ "(not opened yet)"); prototype "{name}: click here to enjoy the game". **U**
4. "Share your superpower" (WhatsApp, Instagram) removed. **D**
5. Photo: no "Add photo" upload, no "Remove photo", no photo toasts; avatar is the onboarding photo or initial. **U**
6. Eyebrow doesn't pop in (prototype `kPop .6s`). **U**
7. Name pill fades instead of rising (`kUp .5s .5s`). **U**
8. Hover tip: no arrow, no .2 s fade; also shows on keyboard focus. **U**
9. Count pill pops for 0.7 s (prototype 0.6 s). **U**
10. Heading colour `kids-text` #f2fbff (prototype #e7f5f9); "The {style}" has no cyan glow. **U**
11. Eyebrow, twinkles and opened-power edge in `kids-streak` #ffe08a (prototype #ffd98a, which the plan maps to `constellation-gold-bright`). **U**
12. Photo ring: 3-stop conic (prototype 4-stop with #0a5b74); inner #0e3a4a becomes `discover-shade` .6; photo position 50% 35% lost. **U**
13. Power bubble backgrounds, selected gradient, glow and ink use different tokens from the prototype colours. **U**
14. Name pill and tip backgrounds `kids-bg` #060a18 (prototype #05131a), text #f2fbff (prototype #eafdff). **U**
15. Count pill gradient cyan → #1b8aa3 (prototype cyan-bright → #0a5b74). **U**
16. Behaviour and stars match: tap opens the game, first tap +1, all seven +3 (no 900 ms delay), no visible "Try this today" in either.
17. ~~Mobile: no twinkles, float or ring spin; solid cyan photo ring; name pill at 63%; fixed type sizes; innermost ring at opacity .45.~~ **Fixed**. Still: no hover tip on mobile, no blur. **D**

## 5. Game dialog — `GameDialog.tsx`

1. Backdrop `kids-bg` .8, no blur, padding 16, no rise-in (prototype rgba(2,6,15,.84), blur 6, padding 20, .25 s). **U**
2. Panel 576 px, radius 28, `p-5`, plain background, 2 px border, one glow, no pop (prototype 540, radius 32, gradient #0e3a4a → #05131a, 1 px border, two shadows, `kPop`). **U**
3. Title row: bare 28 px icon (prototype inside a 48 px circle), title 24 px no tracking (prototype Orbitron 700 22 px .04em). Close is a 44 px dark round button (prototype 48 px outlined circle); it was square-cornered until fixed on 2026-11-12. **U**
4. Instruction copy matches; colour `kids-body` #c6dbe6 (prototype #e7f5f9), 20 px (prototype 21). **U**
5. Win screen: no twinkling dots, no 72 px pulsing check medallion; "You did it!" 30 px (28); seconds 48 px (44) with no gold glow. **U**
6. "New best!" / "Best: X.Xs" / "First try!" are plain teal lines (prototype: solid gold popping pill for New best, outlined cyan pill otherwise). **U**
7. Win lines: second person is D. Each line also drops its power tag ("with super Focus!", "That's real Curiosity!", "Pure Imagination!", "He Never Gives Up!", "Brave Voice!", "So much Energy!", "all on his own!"), and shows as a plain paragraph instead of the dashed box. **U**
8. WhatsApp/Instagram removed **D**. "Play again" is a filled cyan Orbitron button, 56 px, not uppercase (prototype outlined cyan, 46 px, uppercase Rajdhani). "Done" is a dark round button, now rounded (prototype cyan gradient with glow, uppercase). **U**
9. Timing, 0.5 s pause, 0.1 s precision and best-time saving match; the 0.5–600 s clamp is extra. **D**
10. Closes only when the press started on the backdrop, also on Escape, and focuses × (prototype any backdrop click). **U**
11. Mobile: Portal **D**. ~~Closes only with × or Android Back, "Done" in Orbitron, content scrolls only on the result.~~ **Fixed**

## 6. Discover mini games — `KidsGames.tsx`, `GamePieces.tsx`, `lib/kidsGames.ts`

Rules, timings, goals and captions match exactly (shared rules **D**). Visual differences, all **U**:
1. Frame max `calc(100vh - 210px)` (prototype 260); background and caption colours differ (`kids-muted` #a9c6d4 vs #84a0b2).
2. Sky stars don't twinkle; colour #f2fbff (prototype #eafdff).
3. Bursts always gold, scale .3 → 1.6 (prototype cyan for climb and energy, .4 → 2.6).
4. Focus: light doesn't pulse, moves in 1.0 s (1.1), gradient ends #1b8aa3 (#0a5b74).
5. Curious: boxes don't float or flip; "?" fixed 30 px; empty dot #1a2442 (#3c5568).
6. Order: line has no glow; next star doesn't pulse; wrong tap turns pink 400 ms instead of shaking; numbers fixed 20 px; done number #08101f (#05131a).
7. Draw: stroke #ffc94b (prototype #ffd98a), no glow.
8. Climb: flag doesn't twinkle; climber .10 s (.12); mountain #1b8aa3 (#0a5b74).
9. Voice: white-to-cyan orb with dark mic, no border, fixed glow (prototype dark cyan with light mic, gold border above 90%, glow 20 → 70 px); bars 4 px apart (5).
10. Energy: bursts gold instead of cyan.
11. Mobile: same rules, drawn from measured width, transform-only motion. **D**

## 7. Shared across the Grow and Transform tabs

1. Locks ("{Area} opens later"). **D**
2. Avatar video on entry. **D**
3. No stars shown, no star toast. **D**
4. Extra loader and error states ("We couldn't load the worlds." / "We couldn't load your quests." with "Try again", error toasts). **U**
5. One fixed read-aloud line per tab; prototype re-reads per step ("{title}. {how}", "World complete! Well done.", the full quest list, "What are you into? …"). **U**
6. Per-element entrance animations (kUp, kPop, kUnfoldY) mostly missing; only the page fade/rise. Page fade **D**; the rest **U**
7. ~~`.kids-btn-off` on its own had no `rounded-full`, so Grow's Back, "Try again", "Pick another world", Transform's "Back to my quests" and "Done today" (and the dialog's × and "Done") were square-cornered on the web.~~ **Fixed**

## 8. Grow — "Pick a world"

1. Eyebrow "Grow" is plain text, not the prototype's bordered pill. **U**
2. Heading font-black #f2fbff (prototype Orbitron 700 .02em #e7f5f9); "world" cyan without glow. **U**
3. Subtitle text same; colour #c6dbe6 (prototype #84a0b2). **U**
4. Grid `2 / sm:3` columns, gap 16, mt 32 (prototype auto-fit 220 px, gap 20, mt 34). **U** (mobile 2, as the web at phone width)
5. World card is the chunky `.kids-tile` (radius 26, 3 px colour border, solid 7 px shade shadow) instead of the prototype's soft gradient card (radius 30, 1 px cyan border, soft shadow). **U**
6. Icon is a bare 48 px stroked icon; no 104 px glowing orb, no spinning dashed ring, no float. **U**
7. Colours cycle through the 6 power pairs (prototype 3 orbs: cyan, gold, cyan-deep). **U**
8. World name Orbitron black text-lg (prototype Orbitron 700 19 px #eafdff). **U**
9. Tag "3 games" / "Last: {total}" (D); not uppercase, no tracking, and "Completed" in gold is dropped. **U**
10. Played marker is a bare teal check at the card's corner (prototype 34 px gold disc with dark check, popping, on the orb). "A tick" **D**; look **U**
11. Motion: lift 4 px, press 6 px, no tilt, no staggered unfold, no cyan hover glow, no .96 press scale. **U**
12. World names, order and icons match; the prototype's three either/or rounds per world are gone. **D**

## 9. Grow — game screens (intro, play, result)

1. Header left-aligned (prototype centred). **U**
2. Back button is an off-filled square-cornered button with ArrowLeft (prototype 44 px outlined circle with chevron). **U**
3. Progress dots 40×12, `kids-streak` / discover / `kids-off`, no glow (prototype 46×10, gold #ffd98a / cyan with glow / cyan .14, animated). **U**
4. One line "{World} · Game n of 3" (prototype two pills: world name cyan, "Game n of 3" gold). **U**
5. Game title font-black text-3xl/4xl (prototype Orbitron 700 clamp 28–44 px #e7f5f9). **U**
6. How-to line #c6dbe6 (prototype #84a0b2). **U**
7. Intro is a `.kids-card` with the skill in muted text and a pill "Play" button; prototype a square game-sized frame, skill in gold, 150 px round pulsing "Play", and "Played before" / "New game" (no per-game best is kept). **U**
8. Play / Try again behaviour matches.
9. Result: "Well done!" in light text, then the score (48 px, `kids-streak`) and band label (D); no 96 px gold check orb, different colours and sizes. **U**
10. Result buttons inside the card, Orbitron, not uppercase, the off one square (prototype outside the card, 62 px, uppercase Rajdhani, gradient / outlined). **U**
11. "Finish world" saves to the server with "Saving…" (D). If the save fails the report still shows a local mean and `world_done` isn't sent. **U**
12. No +2 stars per world per day (D); 10 runs kept instead of 6 (D); runs store scores, total and time only (D).

## 10. Grow — the games

1. Frame `min(100%, 100vh-260px)`, min 220 (now also on mobile), no 540 px cap (prototype `min(100%,540px,100vh-300px)`, min 260). **U**
2. Frame background, static sky stars, bar fill (#4be9ff → #ffe08a vs #1ec4e8 → #ffd98a), HUD colour, caption colour all differ. **U**
3. No sounds (prototype beeps on hit, miss and pad). **D**
4. Rules, thresholds, timings, scoring and result lines match exactly. Minor: Fisher–Yates shuffle; Catch picks a good word when the bad list is empty; Spark can light a cell the prototype would skip (slightly higher scores). **U**
5. Catch: no gold/red hit bursts; basket has no glow; basket #ffe08a (prototype #ffd98a); arrow keys and ARIA label added. **U**
6. Sort: no fly-off (±14°), shake or pop; only the border changes; wrong colour pink #ff8fb1 (prototype red #ff7a7a); card and side-button colours differ; reacts on click not pointer-down. **U**
7. Memory: second pad #ffc94b (prototype #ffd98a); no frame flash on a wrong tap; pads react on click and are disabled outside input. **U**
8. Timing: "Miss" pink (prototype red), "Perfect!/Good" #ffe08a (#ffd98a), no glow, no pop; target colour. **U**
9. Dash: no burst on grab; picked chips use the area-coloured `kids-chip` with no pop (prototype gold chips popping in). **U**
10. React: "Too soon!" pink (red); light gradient tokens differ. **U**
11. Spark: no stroke glow; stroke colours #ffc94b / … (prototype #ffd98a / …); inner line #f2fbff (#ffffff). **U**
12. All 18 games' content matches exactly; `build_on`/`support` added for the parent prompt (D); Dream Catcher / Box Ideas insight not built (D).

## 11. Grow — report ("World complete!")

1. Eyebrow plain text in cyan (prototype gold pill "{World} report"). **U**
2. "complete!" in cyan, font-black (prototype gold with glow, Orbitron 700). **U**
3. Missing: the 150 px floating world orb, and the report confetti. **U**
4. Shown by the build, not on the prototype screen: total card with band and trend, per-game score and bar on band-tinted cards (no gold check discs), "Strongest", "Keep practising" with tip, "Your mission". Contents **D** (plan lists them), but not flagged as additions.
5. Dashed insight box not built. **D**
6. Sharing ("Share it", WhatsApp, Instagram, their toasts and message) not built. **D**
7. "Play again" filled primary (prototype outlined cyan, 62 px, uppercase); "Pick another world" a square button (prototype a borderless text link under the share row). **U**
8. Band thresholds and labels match; band colours #ffc94b / cyan / violet (prototype #ffd98a / cyan / violet). **D**

## 12. Transform — interest picker

1. No interest in the plan → picker "What are you into?" (prototype falls back to "drawing"); interest found by keywords in the plan's text. **D**
2. Subtitle "Pick one. You get quests for it." in both states (prototype "Pick what else you are into. You get new quests for it."). **U**
3. "Back to my quests" is a dark round button (prototype transparent, 2 px gold border, #ffe08a, 48 px, rounded). **U**
4. Grid `2 / sm:3` columns (prototype auto-fit 200 px, gap 16, mt 30). **U** (mobile 2, as the web at phone width)
5. Tiles: `.kids-tile` with off background and light text (prototype solid colour fill, dark ink Orbitron 900 20, radius 24, lift 3 px). **U**
6. Colour order discover, teal, transform, … (prototype cyan, gold, teal, …). **U**
7. Tiles disabled while saving; picker closes only after the server accepts. **U**
8. 9 interests, 27 quests, how-to lines and targets match exactly; keyword lists added. **D**

## 13. Transform — "Your quests"

1. Header centred (prototype left-aligned). **U**
2. Eyebrow "{Interest}" (prototype "Month 1 · {Interest}"). **U**
3. Subtitle "Do it for real, then tap the big button." missing. **U**
4. Interest chips: centred, fully rounded `kids-chip` (prototype left-aligned, radius 20, min-height 60); off background area .14 (gold .08); tag text smaller; selected chip disabled. **U**
5. "From your parent" only on the plan's interest (prototype always the first chip). Follows **D**
6. "+ Add another" is a solid area chip with a Plus icon (prototype dashed gold, transparent, #ffe08a). **U**
7. Quest card: dots top-right and the action button in a full row below (prototype two columns with a 132 px round button on the right). **U** (mobile now matches the web)
8. Card radius 26, `p-5`, no shade shadow, gap 20 (prototype radius 28, 24/26, 8 px shade shadow, gap 18). **U**
9. Quest colours discover, teal, transform — quests 2 and 3 swap gold and teal. Six pairs **D**; order **U**
10. "Quest {n}" small muted label (prototype a 44 px coloured rounded square with the number). **U**
11. How-to colour #c6dbe6 (prototype #d4e6ee). **U**
12. Progress dots 20 px, 2 px border, no star (prototype 30 px, 3 px border, 16 px ink star when filled). **U**
13. Log button is an area-gold pill "I did it today" (prototype 132 px circle in the quest's colour, "+" and "I did it", hover scale). **U**
14. Once a day per quest via the server (D); the button becomes a disabled "Done today" (**U**); all buttons disabled while saving. Prototype adds 1 per tap with no daily limit.
15. Only a picked interest can be logged. **D**
16. Done: inline teal check "Quest done!" (text **D**; prototype 132 px teal popping circle "Done" **U**).
17. Stars +1 on a quest's first log (prototype +1 per log, +5 on completion). **D**

## 14. Release (child view) — `ReleaseCheckIn.tsx`

1. Header with the app bar, no star counter. **D**
2. Content width 896 px (prototype 1000) and different paddings. **U**
3. Entry animation on the whole page, plus reduced-motion handling. **D**
4. Locked card "Release opens later". **D**
5. Load error "We couldn't load this." / "Try again". **U**
6. Read-aloud once per entry. **D**
7. Copy identical: "Daily check-in", "How do you feel today?", "There is no wrong answer."
8. Eyebrow matches.
9. h1 36/48 px fixed steps (prototype clamp 34–56). **D**
10. Sub line 24 px, 576 px wide. **D**
11. Mood labels, order, mouths and colours match. **D**
12. Mood grid by viewport breakpoints (2/3/5); at about 830–1023 px it shows 3 + 2 where the prototype fits 5. **U**
13. Tile matches; label 18 px (19) **D**; transition .1 s (.12). **U**
14. Face matches.
15. Radio roles and labels added. **U**
16. "Want to tell more?" copy identical.
17. Note card doesn't pop in (prototype `kPop .35s`). **U**
18–20. Card, title, textarea sizes rounded. **D**
21. Note capped at 500 characters. **D**
22. Status lines identical; `role="status"` added.
23. Save button shadow 6 px (prototype 7) **U**; padding rounded **D**; "Saving…" busy state added **U**
24. The note is kept on the server (prototype drops it). **D**
25. Stored on the server per local day. **D**
26. +1 star once a day, not shown. **D**
27. Today's saved mood and note are pre-filled on return (prototype always starts empty). **U**
28. Failed save shows a toast. **U**
29. Day keys `YYYY-MM-DD` (prototype unpadded). **U** (internal)
30. Streak copy identical.
31. Streak counts from yesterday when today has no mood yet (prototype shows 0 until today's check-in). **U**
32. Flame path has one control point −5 instead of −5.5. **U**
33. Streak text matches; spacing rounded. **D**
34–38. ~~Mobile: smaller headings, tiles and face; Save on its own line; smaller textarea and streak row.~~ **Fixed**. Still: no blur, no hover on mobile. **D**

## 15. Connect (child view) — `ConnectWins.tsx`, `lib/kidsWins.ts`

1. Locked card "Connect opens later". **D**
2. Loading spinner while quests and worlds load. **U**
3. Read-aloud "Your wins. Pick one and show it to your grown-up." (prototype "Share your wins. Pick a win. Send it to people you love."). **D** (exact wording not recorded)
4. h1 "Your wins" (prototype "Share your wins"); sub "Pick a win. Show it to your grown-up." (prototype "Pick a win. Send it to people you love."). **D** (exact copy not recorded)
5. Heading sizes rounded. **D**
6. Wins from the child's own data (quests, worlds, badge or "Opened N superpowers", streak of 3+); prototype adds five hard-coded wins. **D**
7. "Thinker badge unlocked" at 3 powers → "Discover badge unlocked" at 7 / "Opened N superpowers". **D**
8. Empty state "No wins yet" / "Open your powers, finish a quest or play a world. Your wins show up here." **U**
9. Teal check on wins already shown. **U**
10. One column below `md`, then 1fr / 1.1fr (prototype always two equal columns, gap 26). **U**
11. Win buttons reuse `.kids-tile`: Orbitron 16 px (prototype Rajdhani 700 20), radius 26 (22), each win's own colour for border and fill (prototype neutral, always pink when picked), 7 px shade shadow (none), lift up (prototype slide right 4 px), no min-height 72. **U**
12. Dot 12 px (14). **D**
13. Dot colour order swaps gold and teal for wins 2 and 3. **U**
14. Card column isn't sticky (prototype `sticky; top:110px`). **U**
15. Card is a pink-tinted `.kids-card`, centred, no gradient, no shadow, no min-height (prototype pink → violet gradient, `0 10px 0 #5a4aa8`, radius 30, min-height 300, left-aligned). **U**
16. Card doesn't re-pop on each pick. **U**
17. Card header: centred 20 px star before "Superpower" in light grey Rajdhani (prototype "SUPERPOWER" Orbitron 900 14 px dark ink on the left, 34 px spinning star with dark stroke on the right). **U**
18. Win title light, centred, 30 px, no balance (prototype dark ink #08101f, left, clamp 26–34, balanced). **U**
19. Avatar 56 px, 3 px pink border, radial fill, glow, centred photo; initial 24 px light (prototype 72 px, 4 px dark border, gold fill, `0 5px 0 #5a4aa8` shadow, photo at 50% 35%, initial 30 px dark). **U**
20. Name line: first name only (D); age dropped and colour `kids-body` (prototype "Rahul, age 10" #1d1640). **U**
21. Photo alt is empty (prototype "Rahul"). **U**
22. No "Add your photo" / "Change your photo" control (dashed pink, camera icon, 240 px JPEG crop, toasts). **U**
23. WhatsApp / Share / Copy (with +1 star and toasts, message "<win> — Rahul, on Superpower. superpower.app") replaced by one "Show my grown-up" button that becomes "Your grown-up can see it". **D**
24. Button disabled while sending. **U**
25. At 60 shown wins: toast "Your grown-up has lots to see already." Cap **D**; message **U**
26. Wins keyed by a stable key (D); side effect: `streak:N` gets a new key each day, so a longer streak can be shown again. **U**
27. Footnote "Only your first name goes on the card." identical; size rounded. **D**
28. ~~Mobile: smaller heading, card star, "Superpower", title, avatar and name; 56 px button.~~ **Fixed**. Mobile is one column, as the web below 768px.

## 16. Parent pages showing the child's activity

**Growth map label ("Kids N")**
1. Text and when it shows match. **D**; matched by area name, not index. **D**
2. Style 11.5 px, not uppercase, no tracking, positioned 30 px below the node (prototype 10.5 px uppercase .16em, "KIDS 78"). **U** (same on mobile)

**Life Pathway quests section (`ChildQuests.tsx`)**
3. A standalone section above the closing CTA (prototype inside the plan dashboard after "The achievement this month"). **D**; the missing "{n}/3 quests done" chip, quest counts and the two Kids Mode lines **U**
4. Title "{name}'s quests" (D); subtitle "What {name} does in child view, quest by quest." (prototype "Your topic: {Interest} · done in Kids Mode"), weight 900 and colour differ. **U**
5. No header stats ("Logged", "Finished n/3", "Seen by you n/3"). **U**
6. Empty state "Nothing logged yet." (D) / "When {name} ticks off a quest in child view, it shows here." (prototype topic name, "Not started" pill, "When Rahul logs a {topic} quest in Kids Mode, it shows up here."). **U**
7. Shows the plan's interest and every interest the child added and logged, each as a card (D), listing all three quests including "0 of N · not yet" (prototype only quests with a count). **U**
8. Rows are flat: title, "{n} of {target}" / "Done" in gold, "· last 10 Nov" / "· not yet" (format D); no 48 px progress ring, no "Done"/"In progress" status, done colour gold instead of teal. **U**
9. Missing: per-row "Acknowledge" / "Seen" toggle; the feedback panel ("How is it going?" tags, "Next month" options, note with Save, "Goes to Superpower to plan his next month. Rahul doesn't see it."); the "Next step: …" line; stored parent feedback. **U**
10. "child view" instead of "Kids Mode". **U** (as an explicit decision)
11. No demo data. Implicit **D**

**Connect page ("From <name>")**
12. The child's shown wins come first; not in the prototype. **D**
13. Row strings: kind "From <full name>", caption "<name> chose to show you this in child view.", kids star icon, lower-case "today / yesterday / N days ago", newest first. **U**
14. Full name here, first name on the child's card. **U**
15. Shown wins load after the page and are prepended, so the list shifts and per-card edits (kept by index) move to other items. **U**
16. Rows keyed by title, so a shown win with the same title as another item would collide. **U**
17. Shared through the existing WhatsApp / Instagram / X flows. **D**
18. Mobile does the same.

**Observations moods (`RecentMoods.tsx`)**
19. Not in the prototype (its only mood UI is a child variant of that page, not built per the plan). **D**
20. Contents and placement match 2.4. **D** (exact copy and placement not recorded)
21. Streak uses the same yesterday rule as Release item 31. **U**

## 17. Mobile-only mismatches with the web build

1. ~~Grow report eyebrow, play line and intro card used the world's colour on mobile, the area colour on web.~~ **Fixed**
2. ~~Quest dots below the how-to on mobile, top-right on web.~~ **Fixed**
3. No keyboard controls in the games on mobile (arrows, Enter, Space). Kept: no hardware keyboard on a phone.

See "Web and mobile" at the top for the differences kept on purpose.
