# Mission

High-level mission statement and objective for the Beluga Assessment project.

## Mission statement

> _TODO: replace with the one-sentence statement of what this product exists to do._
>
> Example shape: "Beluga Assessment helps **[who]** to **[do what]** so that **[outcome]**."

## Objective

The concrete thing we're building in this codebase.

- **Product surface:** a web application with a React frontend (`frontend/`) and a Node/TypeScript backend (`backend/`).
- **Primary user(s):** _TODO: who will actually use this — candidates, reviewers, admins, internal team?_
- **Core job-to-be-done:** _TODO: the single most important workflow the product must support end-to-end._
- **Out of scope (for now):**
  - Authentication / user accounts (intentionally deferred during scaffolding).
  - Any feature not explicitly listed in `CLAUDE.md` under **Features**.

## Guiding principles

These shape day-to-day implementation decisions. Update as the project evolves.

1. **Type safety end-to-end.** The frontend imports `AppRouter` directly from the backend — never break that link or smuggle in untyped fetches.
2. **Features are vertical slices.** A feature lives in one folder on each side (`backend/src/features/<name>/` and a matching surface in `frontend/src/`). No shared "god" modules.
3. **Database is the source of truth.** Schema changes go through Drizzle migrations; never hand-edit generated SQL.
4. **Keep the changelog honest.** Every functional change is logged in `mission-docs/changelog.md` — see `CLAUDE.md` for the rule.

## Success criteria

_TODO: what does "done" or "good" look like? (e.g. demo flow X works, candidate can complete Y in under Z minutes, etc.)_
