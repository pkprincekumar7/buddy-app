# Frontend

## Pages

| Route | Page | Notes |
|---|---|---|
| `/Login` | Login (email/password + Google) | Public, hardcoded in `App.tsx` |
| `/Register` | Register | Public, hardcoded in `App.tsx` |
| `/` | Home dashboard | Renders `mainPage` (`Home`) — set in `pages.config.ts` |
| `/Home` | Home dashboard | Protected |
| `/Onboarding` | Welcome / sign-in landing | Protected — stage-1 video splash on entry |
| `/ConversationalOnboarding/:childId` | Chat-based child questionnaire | Protected |
| `/PersonalityType/:childId` | Personality analysis (LLM + rule fallback) | Protected — stage-2 video splash on entry |
| `/PersonalityJourney/:childId` | Journey overview + growth-area prompt | Protected |
| `/GrowthAreas/:childId` | Growth area selection grid | Protected — stage-7 video splash on entry |
| `/GrowthAreas/:childId/Activity/:activity` | Growth area activity questionnaire | Protected |
| `/GrowthAreas/:childId/Activity/:activity/Game` | Interactive activity game (image-choice) | Protected |
| `/GrowthAreas/:childId/Activity/:activity/GreatInsights` | Post-game AI insights | Protected |
| `/LifePathway/:childId` | 10-year growth chart + milestones | Protected — stage-4 video splash on entry |
| `/GoalsDashboard/:childId` | 3-month AI goal plan | Protected |
| `/GrowthAreas/Activity/:activity` | Growth area activity questionnaire | Protected — legacy route (no `:childId`) |
| `/GrowthAreas/Activity/:activity/Game` | Interactive activity game | Protected — legacy route |
| `/GrowthAreas/Activity/:activity/GreatInsights` | Post-game AI insights | Protected — legacy route |

Protected routes redirect to `/Login` when unauthenticated. Child-specific routes (`/:childId`) and GrowthAreas nested routes are hardcoded in `App.tsx`; the remaining pages (`/Home`, `/Onboarding`, etc.) are registered via the `PAGES` map in `pages.config.ts`. Stages 1, 2, 4, and 7 show a full-screen video splash (served from `app-assets/avatars/` in S3) before the page content appears. Navigating back via the Back button skips the splash (`location.state.fromBack`).
