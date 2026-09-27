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
| `/Connect/:childId` | Share accomplishments (WhatsApp/Instagram/Twitter) | Protected, hardcoded |
| `/GrowthAreas/:childId/Activity/:activity`, `.../Game`, `.../GreatInsights` | *(redirects)* | Stale links back to `/GrowthAreas/:childId` — see note below |
| `/GrowthAreas/:childId` | Growth area selection grid + overlay | Protected, hardcoded — stage-7 video splash on entry |
| `/Home` | Home dashboard | Protected, from `PAGES` map |
| `/Onboarding` | Welcome / sign-in landing (new-child flow) | Protected, from `PAGES` map |
| `/ConversationalOnboarding`, `/PersonalityJourney`, `/PersonalityProfile`, `/GrowthAreas`, `/Observations`, `/Connect` | Bare (no `:childId`) variants of the pages above | Protected, from `PAGES` map |
| `/Admin` | Allowed-emails admin panel (`AdminAllowedEmails`, lazy-loaded) | Restricted to `user.role === 'admin'` — served by a separate `AdminRoutes` tree that entirely replaces the routes above for admins, not layered on top of them |

Protected routes redirect to `/Login` when unauthenticated. Child-specific routes (`/:childId`) and the `GrowthAreas` redirect/nested routes are hardcoded in `App.tsx`, ordered before the generic block; the bare pages are registered via the `PAGES` map in `pages.config.ts` (`Home, LifePathway, Onboarding, ConversationalOnboarding, PersonalityJourney, PersonalityProfile, GrowthAreas, Observations, Connect`). Any other path falls through to `PageNotFound` (non-admin) or redirects back to `/Admin` (admin).

**Growth Map overlay (no more separate Activity/Game/GreatInsights pages):** the parent's reflections, the handoff, the child's rounds, and the result (constellation + recommendations) are now all one overlay on the Growth Map itself. The old `/GrowthAreas/:childId/Activity/:activity` page, the image-pick `/Game` page, and the separate `/GreatInsights` results page are gone — those three paths (and their legacy no-`:childId` forms, which no longer exist at all) now just redirect back to `/GrowthAreas/:childId` so old bookmarks/links don't dead-end.

Stages 2, 4, and 7 show a full-screen video splash (served from `app-assets/avatars/` in S3). Stages 4 (`LifePathway`) and 7 (`GrowthAreas`) play on page entry and are skipped when arriving via the Back button (`location.state.fromBack`); stage 2 is different — it's triggered mid-page by the "Discover" tap on `PersonalityJourney`'s `DimensionCircles` screen and plays as a transition into `/PersonalityProfile/:childId`, not on route entry.
