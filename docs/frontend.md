# Frontend

## Pages

| Route | Page | Notes |
|---|---|---|
| `/Login` | Login (email/password + Google) | Public, hardcoded in `App.tsx` |
| `/Register` | Register | Public, hardcoded in `App.tsx` |
| `/` | Home dashboard | Renders `mainPage` (`Home`) — set in `pages.config.ts` |
| `/Onboarding/:childId` | Resume an existing child's onboarding | Protected, hardcoded — child-specific variant |
| `/ConversationalOnboarding/:childId` | Chat-based child questionnaire | Protected, hardcoded |
| `/PersonalityJourney/:childId/DimensionCircles` | Journey, phase 2 (dimension-circles screen) | Protected, hardcoded — tapping "Discover" here plays the stage-2 splash, then navigates to `/PersonalityProfile/:childId` |
| `/PersonalityJourney/:childId` | Journey overview + growth-area prompt | Protected, hardcoded |
| `/PersonalityProfile/:childId` | Personality analysis (LLM-generated) | Protected, hardcoded |
| `/LifePathway/:childId` | 10-year growth chart + milestones + 90-day plan | Protected, hardcoded — stage-4 video splash on entry |
| `/Observations/:childId` | Parent observations / reflections | Protected, hardcoded |
| `/Connect/:childId` | Share accomplishments (WhatsApp/Instagram/Twitter) | Protected, hardcoded; the child's shown wins come first |
| `/Kids/:childId/:area` | Child view's kids page (`KidsMode`, lazy) | Protected, hardcoded; not in `PAGES`. See "Child view" below |
| `/GrowthAreas/:childId/Activity/:activity`, `.../Game`, `.../GreatInsights` | *(redirects)* | Stale links back to `/GrowthAreas/:childId` — see note below |
| `/GrowthAreas/:childId` | Growth area selection grid + overlay | Protected, hardcoded — stage-7 video splash on entry |
| `/Home` | Home dashboard | Protected, from `PAGES` map |
| `/Onboarding` | Welcome / sign-in landing (new-child flow) | Protected, from `PAGES` map |
| `/ConversationalOnboarding`, `/PersonalityJourney`, `/PersonalityProfile`, `/GrowthAreas`, `/Observations`, `/Connect` | Bare (no `:childId`) variants of the pages above | Protected, from `PAGES` map |
| `/Admin` | Allowed-emails admin panel (`AdminAllowedEmails`, lazy-loaded) | Restricted to `user.role === 'admin'` — served by a separate `AdminRoutes` tree that entirely replaces the routes above for admins, not layered on top of them |

Protected routes redirect to `/Login` when unauthenticated. Child-specific routes (`/:childId`) and the `GrowthAreas` redirect/nested routes are hardcoded in `App.tsx`, ordered before the generic block; the bare pages are registered via the `PAGES` map in `pages.config.ts` (`Home, LifePathway, Onboarding, ConversationalOnboarding, PersonalityJourney, PersonalityProfile, GrowthAreas, Observations, Connect`). Any other path falls through to `PageNotFound` (non-admin) or redirects back to `/Admin` (admin).

**Growth Map overlay (no more separate Activity/Game/GreatInsights pages):** the parent's reflections ("Guided Reflection") and the "Growth insights" are one overlay on the Growth Map itself (`components/growth/GrowthAreaSheet.tsx`), with Reflection / Recommendations tabs. The insights show what the parent answered and the child's latest run of the area's world in child view (score ring, strongest and weakest game, each game's score), then five recommendations grow writes from both, each tagged with its source (You + child / child's games / your answers / next step). An answered area opens on its insights; the page regenerates the recommendations when grow says they aren't from the area's present answers and feedback (`recommendations_current`, so a change saved elsewhere or while they were being written counts too) or the child played the world again (`recommendations_run_at`). Grow completes an answered area itself when its recommendations are written (the first one unlocks Transform): the page sends no completing save, so leaving while they load loses nothing. There is no hand-over step any more: the child's input is their child view worlds. The old `/GrowthAreas/:childId/Activity/:activity` page, the image-pick `/Game` page, and the separate `/GreatInsights` results page are gone — those three paths (and their legacy no-`:childId` forms, which no longer exist at all) now just redirect back to `/GrowthAreas/:childId` so old bookmarks/links don't dead-end.

**90-day plan saves (`useNinetyDayPlan`, both apps):** edits are buffered and saved after a short pause, one save at a time, each made on the plan's `version` from the last response. A save that fails on the way (offline, a 5xx) goes back into the buffer, newer edits winning, and is sent again with the next edit or after a backoff (2 s doubling to 30 s), so edits and just-uploaded photo keys aren't lost; one the server refuses as it is (a 422) is dropped and the saved plan shown again. A `409 plan_changed` (another device saved first) reloads the plan, moves the unsaved change onto it key by key (`rebasePlanPatch` in `api/transform.ts`: this device's change where the other didn't touch that key, the other's where both did; the Day-90 event as one; photos as added and removed keys), shows "Updated on another device" and saves again.

Stages 2, 4, and 7 show a full-screen video splash (served from `app-assets/avatars/` in S3). Stages 4 (`LifePathway`) and 7 (`GrowthAreas`) play on page entry and are skipped when arriving via the Back button (`location.state.fromBack`); stage 2 is different — it's triggered mid-page by the "Discover" tap on `PersonalityJourney`'s `DimensionCircles` screen and plays as a transition into `/PersonalityProfile/:childId`, not on route entry.

## Child view

A device-local mode of the parent's session (docs/child-view-build-plan.md): no child login,
and the token stays the parent's. The parent hands the device over from the profile menu (the
child's row) and comes back with "Back to parent view", one tap (P.1).

| Piece | Where | What it does |
|---|---|---|
| View mode | `lib/ViewModeContext.tsx` (both apps) | `{view, enterChildView, exitChildView}`; kept per device in `superpower.view` (`localStorage` / AsyncStorage) as `{userId, childId}`, and forgotten on sign-out, for another account or an admin, or once the child is gone |
| Guard | web `ChildViewRoutes` in `App.tsx`; mobile `navigation/withChildViewGuard.tsx` | In child view only `/PersonalityJourney/:id[/DimensionCircles]` and `/Kids/:id/:area` open (`allowedInChildView`, `lib/childView.ts`); anything else goes to the child's circles. Mobile resets the stack so nothing of the parent's is underneath, and Android Back stops at the bottom |
| Kids page | web `pages/KidsMode.tsx` (lazy, `/Kids/:childId/:area`); mobile `screens/KidsMode.tsx` | The hub's circles open here in child view: Discover (powers and mini games), Grow (worlds), Transform (quests), Connect (wins), Release (mood check-in). The header, the tabs and "Read to me" (the existing voice preference) |
| Child view's order | `areaOpen` (`lib/kidsAreas.ts`), children's `circles_done` | Child view opens its circles in its own order, apart from the parent's progress: Discover once the chat is done, then Grow after the Discover badge, Transform after a world, Release after a quest, Connect after a mood. The hub in child view shows these locks too |
| Data | `useKidActivity`, `useKidPowers`, `useKidQuests`, `useKidWorlds` | children's `kids`, discover's `powers`, transform's `quests`, grow's `worlds` (docs/api.md) |
| Rules | `lib/kidsGames.ts`, `lib/kidsGrow.ts`, `lib/kidsWins.ts`, `lib/kidsDay.ts`, `lib/kidsMoods.ts`, `lib/kidsPowers.ts`, `lib/kidsAreas.ts` | Shared by both apps (the same files): the games' rules and scoring, the wins, the child's day and streak |
| Theme | `index.css` `--kids-*` and `.kids-*` classes (web); `components/kids/palette.ts` from `yarn theme:sync` (mobile) | No colour or font literals in the kids files: an ESLint rule scoped to them refuses them |

In parent view, what the child did shows on Home ("From <name>'s child view": the wins they
chose to show and the quests they logged), and on the parent's own pages: the quests on the Life
Pathway, the world scores (with "Build on" and "Support") on the Growth Map and in each area's
sheet, and the wins the child chose ("Show my grown-up") first on Connect, to share from there.
