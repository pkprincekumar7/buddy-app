---
name: standards-review
description: Audit backend (FastAPI) and/or frontend (React/Tailwind) code in this repo against this project's specific coding-standards checklist, and report findings without making changes.
---

# /standards-review

Audit code against buddy-app's own coding-standards checklist — not generic best practices, but
the specific list distilled from an explicit review of this codebase. Review-only: report
findings, do not fix anything unless the user explicitly asks afterward.

## Usage

```
/standards-review [backend|frontend|both] [path or file...]
```

- No argument: infer scope from what's currently changed (`git status`/`git diff`) — if only
  `backend/` changed, audit backend; if only `frontend/` changed, audit frontend; if both or
  neither, audit both.
- `backend` / `frontend` / `both`: explicit scope.
- Optional path/file arguments: narrow the audit to those files instead of the whole stack.

The ambient rules in `backend/CLAUDE.md` and `frontend/CLAUDE.md` already shape newly-generated
code in this repo. This skill is for auditing *existing* code — including code written before
those files existed, or code where the ambient rule alone didn't catch a real bug.

## Checklists

The full checklists live in separate reference files — load only the one(s) matching scope, so a
backend-only run doesn't pull frontend items (or vice versa) into context:

- Backend (FastAPI / MongoDB / Redis), 16 items: `references/backend-checklist.md`
- Frontend (React / TypeScript / Tailwind), 19 items: `references/frontend-checklist.md`

## How to run the audit

1. Determine scope (see Usage above), and read the matching reference file(s) above — backend
   scope loads only `backend-checklist.md`, frontend scope loads only `frontend-checklist.md`,
   `both` loads both.
2. List the relevant files — `git diff`/`git status` for a review of pending changes, or
   `find`/`grep` across the stack for a full sweep.
3. Work through each checklist item against the actual files — don't rely on memory of what
   "should" be true; grep/read to confirm.
4. For each violation found, note the file, line, which checklist item it violates, and a
   one-sentence description of the concrete failure mode (not just "doesn't follow convention" —
   what actually goes wrong for a user or a future change).
5. Do not fix anything in this pass. Report findings only, grouped by checklist item, most
   severe first within each stack.

## Output

```markdown
## Standards Review: [scope]

### Backend
| # | File | Line | Checklist item | Issue |
|---|------|------|-----------------|-------|

### Frontend
| # | File | Line | Checklist item | Issue |
|---|------|------|-----------------|-------|

### Clean
[Checklist items with no violations found]
```

If the user then asks for fixes, apply them one at a time and re-verify (lint/typecheck/build,
and a live browser check for anything visually observable) before moving to the next.
