# 2026-09-09 — the board's width is a setting, and the pool is not tuned to widen it

Branch `worktree-agent-a4b0a56b27f5aa24f`, cut from `ea8852c`. History, not status; the rule is `docs/policies/local-rules.md`, and the design's own statement of it is the *Options, not a meta* section of `docs/design/game.md`.

## What was believed and proved false

**"Energy caps the board at six to nine units, and a swarm tops out near fifteen."** The design of record carried that arithmetic from 2026-09-06, and `ARCHITECTURE.md`'s art system was sized to it. It held until combat became mutual on 2026-09-07: bodies die to the retaliation their own attacks draw, the probe's line topped out at three units at `even` and `trivial` alike, and the 2026-09-09 sweep found two at every viewport. The prediction is gone from the design. The seventy-pixel art constraint stays, because a board that compresses to any width is a rendering requirement, not a balance target.

**"A narrow board is a defect, and the fix is to re-cost the pool until boards widen."** Reported as a defect and proposed as a balance pass on 2026-09-09; refused by the owner in the words the design now quotes. The framing was wrong, not the number: a measurement describes what the rules produce, and a weak option is information for the player rather than a defect for the pool. Three documents had been written on the other side of that line — "deck design is the board-size dial", "AoE is the only designated counter to a wide board", two open questions premised on a re-cost — and each is rewritten in this session's commit. What stays is every rule of play and every metric: measuring is what the ruling asks for; tuning content toward a shape is what it rules out.

**"The design is unprototyped."** Its status line said so until this commit, two days after the engine, the playable fight and the run all existed.

## What the gates could and could not see

**Timestamp:** 2026-09-09

**Action:** Documentation only — `docs/design/game.md`, `ARCHITECTURE.md`, `AGENTS.md` (one link line above the canon block), and the new `docs/policies/local-rules.md`. Nothing under `src/`, `test/` or `tools/`.

**Validation:** `npm run gates` re-run in the worktree after the edits, 156/156 with `verify` and `verify:run` green — which proves only that no code moved, since no gate reads these documents. The link was checked by calling `sync-canon`'s exported `checkFleet` against a scratch root holding this branch's `AGENTS.md`, `CLAUDE.md` and `local-rules.md`: `cards` current, `unlinked` empty. That `unlinked` result proves less than it looks like. The check is `agents.includes('docs/policies/local-rules.md')`, and the FLEET-CANON marker line itself contains that string, so the warning cannot fire for any repo carrying the canon: main's own `AGENTS.md`, which has no link, passed it identically in a second scratch root, and only an `AGENTS.md` with no canon block at all made it go red. The link line is verified by reading the diff, and the vacuous check is a finding for the fleet repo's script, not for this one. The first attempt at that check silently read the real fleet root instead, because the environment variable carrying the scratch path was placed after the command rather than before it, and reported 27 repos current with none missing an AGENTS.md — a result that could not have come from a root with one repo in it. The count was the tell; read it before the verdict.

**Code reviewer comments:** None sought; the owner's ruling is the review this change carries out.

**Notes:** Still carrying the old framing, deliberately untouched: the header comment in `src/content/cards.ts` (lines 73–77) says the design names AoE as the only designated counter; `test/casting.test.ts` line 213 says the same in a comment; the plans for units 0, 4 and 6 under `docs/work/` record the framing as it was decided at the time and are history; `docs/devlog/detailed/2026-09-07-card-explains-itself.md` line 95 says the compression-floor picture "comes back when the card pool is re-costed", which the ruling now says it will not; and `ARCHITECTURE.md`'s status line still says there is no UI layer and counts four gates where there are six.
