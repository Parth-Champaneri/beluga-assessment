# Take-Home: Candidate Ranker

**Timebox:** ~2 days / 6–8 focused hours. It's intentionally not fully completable, so what you choose to cut matters as much as what you build.
**AI:** Use it however you normally would; encouraged.
**Stack:** Your choice.

## The problem

Given a role and a list of LinkedIn candidates, produce a ranked list of fit (best to worst) with a score and a one-line reason per candidate, cheaply and fast enough to be usable.

The naive version is one big LLM prompt per candidate. For ~100+ candidates that's slow and token-heavy. Design something better.

## Set up yourself

We're not giving you data, a role, or API access. Figuring out an unfamiliar service from scratch is part of the test.

- **Clay:** sign up for a free trial, get an API key, and configure the enrichment yourself.
- **Candidates:** assemble your own list of ~50 to 100 LinkedIn profiles (any plausible pool, e.g. software engineers). A CSV of `full_name`, `linkedin_url`, `email` (where available) is fine.
- **Role:** pick one realistic role and write a short JD to rank against.

## Requirements

1. Ingest your candidate list.
2. Enrich each candidate via Clay (wired up by you), turning LinkedIn/email into experience, skills, etc. This is the flaky part: handle failures, timeouts, and rate limits with retries and idempotency, and decide what happens to the ones that never come back (e.g. a dead-letter/failed queue).
3. Rank with a pipeline that is more than one big prompt: show cost/latency awareness (e.g. cheap model or plain code for facets, a filter step, a stronger model only where it earns its tokens).
4. Output a ranked list: candidate, score, one-line reason.
5. README: what you built, your tradeoffs, what you cut and why, and what you'd do with another week.

## Stretch (pick what you can; you won't get to all)

- Precompute & cache enriched facets so re-ranking for a different role doesn't re-enrich unchanged candidates.
- Embedding/RAG prefilter over enriched profiles to cut the set before the expensive rank.
- Archetype tags (e.g. "jack of all trades", "startup-heavy", "fast promo").
- A small eval/calibration harness to check the ranking is any good.
- A minimal UI to view the ranked list.

## Process

- Commit in phases; we want to see the progression, not one giant commit.
- A working, well-reasoned 70% with a sharp README beats a half-finished 100%.
- If you hit a wall (e.g. Clay trial limits), note the blocker and your workaround in the README.

## Deliverables

1. A GitHub repo with phased commits.
2. The README above.
3. A runnable entry point that takes your candidate list + role and outputs the ranked list.
4. Be ready to walk us through it live (30 to 45 min): your design, your cuts, and how you'd productionize it.
