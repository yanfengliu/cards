# 2026-09-23 — closing the re-review of `2b040d9`

Branch `worktree-agent-a95454a3d4d218310`, cut from `2b040d9`. A focused re-review of the round that closed `907c8e9`'s final acceptance review found five things. F1 was a defect: the fight check's enemy-hero comparison read its expected side from the function the fight is built from. F2, F4 and F5 were sentences about the check that said more than it compares, and F3 was a population count whose only test could not tell reading from counting. It was the third review in a row to find a claim bigger than its gate, so this round changed approach: every sentence about a gate was written from the gate's code, to its extent, and no check grew to match a sentence. F1 was the one exception, because it was a defect in the check itself. The commits start at `00f155c`, one or more per finding. The suite is 289 tests, from 288. Every mutation, its failure text and the runner are in `docs/learning/gate-proofs.md` under "closing the re-review of `2b040d9`".

## The enemy hero was held to the function that builds it

**Timestamp:** 2026-09-23 19:46–19:54 (`00f155c`, `07f24c8`)

**Action:** `printedEncounter` in `src/run/sigils.ts` reads the encounter a fight node fields off `run.content.acts`: the act's boss at a boss, and at an elite or an ordinary fight the entry `mixSeeds(seed, act, node id, TAG_ENCOUNTER)` picks. Both readings of a fight compare the enemy hero's Power and Armour with it. The pick is restated, not asked of `encounterFor`, and `TAG_ENCOUNTER` is exported from `src/run/nodes.ts` with its value unchanged. A new test gives a fixture act two elites and two ordinary fights that print different Power, and holds the pick there.

**Result:** The review's M1 makes the boss gain every Power sigil the player holds, inside `encounterFor`. At `2b040d9` all seven gates passed it, 288 of 288 tests. At `00f155c` it is red in the ladder test, the detector test, `verify:run` (25 disagreements, the first `the engine built the enemy hero at 5 Power / 0 Armour, and a3b_king, the encounter act 3's content prints for this boss, has 4 / 0`) and `npm run gates`. The same change at an elite is red too. `verify:run` printed the same 72 lines as at `2b040d9` apart from `Elapsed:`.

**Reasoning:** The assignment allowed dropping the comparison instead. The act's table is what the content prints, and the pick is a pure function of the seed, the act and the node, so it can be restated without touching anything a fight is built from. Two other keys were rejected: the enemy hero's name and the enemy deck both come from the fight being checked, so a swapped encounter would pick its own expectation. The comparison stays Power and Armour and nothing more, as the assignment required. Its failure text no longer says "a hero sigil reached the other side", a cause the check cannot know.

**Validation:** Fifteen rows as wanted at `00f155c`, with the runner's three self-probes, and the blinded runner exited 2. Every shipped act prints one Power for all of its elites and one for all of its ordinary fights, so a wrong pick is green in `verify:run` and the ladder test and red only in the new test. The check put back on `encounterFor` passes M1 again in the whole suite and in `verify:run` (F1r): nothing gates the check against that rewrite.

## The tally's one test could not tell reading from counting

**Timestamp:** 2026-09-23 19:56–20:01 (`8678883`, `a378d93`)

**Action:** The detector test fights three more fixture bosses: one holding no sigil, one holding a card sigil and the Oak, and one holding the Bulwark alone. Each must tally one fight, counted for exactly the kinds it holds. The instrument test requires every count of a window that granted nothing to be 0, for each kind of fight it fought.

**Result:** The review's T1 changes both tally tests to `>= 0`. At `2b040d9` all seven gates passed it, and `verify:run` printed 39 elites and 57 bosses for all four counts. It is red now in the detector test, the instrument test and `npm run gates`, and so is T1 with the review's M2. Each half of T1 is red on its own, and so are counting the Oak, dropping the Armour half, and `checkRuns` summing fights into the card-sigil count. `verify:run` still prints 29 and 48 with a card sigil and 22 and 37 with a Power or Armour sigil, as at `2b040d9`: none of its counts was over-reported before this round, so none moved.

**Reasoning:** The Oak case is there because the count is defined as a Power or Armour sigil, and the Oak is a hero sigil that moves neither. The instrument case holds the sum `verify:run` prints, not only each run's tally.

**Validation:** Eleven rows as wanted at `8678883`. `verify:run` and the ladder test stay green on T1: they print and read the counts and cannot see them wrong.

## Sentences written from their code

**Timestamp:** 2026-09-23 20:07–20:16 (`9d84e7f`, `4629623`, `ec08c5a`, `4fe5b9b`)

**Action:** `AGENTS.md:121`, the docs in `src/run/sigils.ts`, the instrument docs, report line, gate comment and failure text in `src/sim/runmeasure.ts`, and the ladder test's comment and message now say what the fight check compares. On the player's side that is each deck card as the pool resolves it, field by field; the player's hero, read in a fight through the five fields of its `HeroSpec`, its maximum Health not held; the deck a fight shuffled; and the hand size and Energy both sides share. Of the enemy side it is only the enemy hero's Power and Armour. Each sentence also names what is not compared: the enemy's cards, opening units and deck, the enemy hero's Health, traits and name, and a fight's seed and round limit. The population check needs one fight of each kind with a card sigil and one with a Power or Armour sigil, not one fight with both, and the texts say that. A second read found four more sentences of the same kind, and `4fe5b9b` narrows them. `docs/policies/local-rules.md` carries the rule the round was run under.

**Result:** `AGENTS.md` changed on line 121 only, outside the canon block. Fleet's `sync-canon` check exited 0 with `cards` current, and the worktree's `AGENTS.md` classifies current. `verify:run` changed only the wording of its sigil line, and every number in it is the same.

**Reasoning:** Three reviews in a row found a claim bigger than its gate. Each fix grew the check and rewrote the claim, and each new claim outran the new check. The review's three enemy-side leaks at the last boss - the enemy's cards given the player's sigil traits, the enemy hero's Health raised by the Oak, a card added to the enemy's opening - still pass all seven gates, at `00f155c` and again at `4fe5b9b`. That is by design this round: the sentences now say those things are not compared, and whether to compare them is a separate decision.

**Validation:** Two rows at `9d84e7f` read the rewritten failure texts back off `verify:run` and the ladder test. At `4fe5b9b`, the last commit that touches code, the review's M1 and T1 each stop `npm run gates` at `"test" failed (exit 1)`, and the three leaks each leave it at exit 0. The rule itself has no gate; a review is what catches a breach.

**Code reviewer comments:** None this round. No independent review of these commits has run, and the multi-CLI review this repo asks for on an `AGENTS.md` change has not run.

**Notes:** In this worktree the harness refuses a shell command that runs a script through a `$VAR` path or uses process substitution, because it cannot show the command stays inside the worktree. Literal paths and plain commands run. The editor tool kept every file's CRLF endings; each edited file was read back for bare LFs after each edit.
