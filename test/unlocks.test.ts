// Unlocks: what a run may draft, what a finished run adds, and the two things
// that must stay true while an unlock set is an input to the draft.
//
// `docs/design/game.md`: "**Meta-progression is unlocks only.** Finishing runs
// adds cards and sigils to the pool. No persistent power, no hub to rebuild -
// every run is winnable from the first one." Two claims, and this file is
// mostly the second one:
//
//   **An unlock widens; it never strengthens.** `unlockedContent` may differ
//   from the content it was handed in exactly three fields - `rewards`,
//   `sigils` and each class's `rewards` - and each of those is a *subsequence*
//   of what went in, with the same entry objects and so the same weights.
//   Every other field comes back identical by reference. The check below walks
//   `Object.keys` rather than a list written here, so a field added to
//   `RunContent` tomorrow is covered the day it is added instead of quietly
//   falling outside the gate.
//
//   **A recorded run replays against the pool it was played with.** The set is
//   in the log and `replayRun` reads it from there and from nowhere else. This
//   is the keystone invariant meeting an input it did not used to have: a
//   reward pick is an index into a shelf, and the same index against a wider
//   pool names a different card. The gate that holds it is a run recorded at a
//   fresh profile replaying to its own hash while the same seed played with no
//   unlock layer reaches a different one.
//
// An independent review of the first version of this file found five holes in
// it, each a defect-shaped mutation that survived all 237 tests, and the second
// half of the file closes them. What they had in common is worth stating,
// because it is what the next round should look for:
//
//   **Every assertion about a recorded set ran at `owned: []`.** A `startRun`
//   that recorded the gated list with an empty owned half is *correct* at a
//   fresh profile, so nothing could see it - 48 of 72 runs stopped replaying
//   with the suite still green. The ladder below is the fix: a half-unlocked
//   profile is the ordinary case and the only one that can tell the two apart.
//
//   **The claims stopped at a function's boundary.** "No persistent power" was
//   gated over `unlockedContent`'s output, so a starting-gold bonus scaled by
//   how much is locked - one frame up, in `startRun` - was outside it. It is
//   now a claim about the whole starting `RunState`.
//
//   **Only one direction was gated.** Every check asked whether the filter was
//   too *wide*. Dropping an ungated card, which is the direction "every run is
//   winnable from the first one" actually cares about, was green.
//
// Bound of this file - what a green run does and does not prove:
//
//   Content: the shipped `RUN_CONTENT` and `GATED_IDS`, plus a two-card
//   fixture content for the cases the shipped one cannot reach (an empty
//   pool, a set that gates everything).
//   Windows: 12 shipped seeds x 2 route styles for the whole-run checks, all
//   three classes for the starting-deck and pick-screen checks, the five-rung
//   `LADDER` of unlock sets for the replay and narrowing checks, and the two
//   golden format 1 logs for the "an old log still replays" half. Windows, not
//   spaces.
//   Storage: `localStorage` is a stub installed by the test, so what is gated
//   is this code's own decisions about storage - what a pinned pool may touch,
//   and that a saved run is migrated before it is replayed - and not the
//   browser's. The browser's own round trip is
//   `node tools/ui-probe/run.ts <seed> <theme> <class> fresh`.
//   The population is asserted in each whole-run test, so a window that
//   exercised no gated card or earned no achievement fails rather than passes.
//   Proves nothing about pixels, the DOM, or how *hard* a fresh profile's pool
//   is - that is `npm run measure:run -- --unlocks none`, which is an
//   instrument and not a gate, and whose numbers are in
//   `docs/work/12_unlocks/plan.md`.
//
// Made to go red: see `docs/learning/gate-proofs.md`.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { CARD_POOL } from '../src/content/cards.ts';
import { CLASSES } from '../src/content/classes.ts';
import { SIGILS } from '../src/content/sigils.ts';
import {
  ACHIEVEMENTS,
  ALL_UNLOCKS,
  FRESH_UNLOCKS,
  GATED_IDS,
  unlockedBy,
  unlocksFor,
} from '../src/content/unlocks.ts';
import type { CardPool } from '../src/engine/state.ts';
import { hashString } from '../src/engine/hash.ts';
import { RUN_CONTENT } from '../src/run/content.ts';
import { hashRun, runToCanonical } from '../src/run/hash.ts';
import { rewardOffer, shopStock } from '../src/run/nodes.ts';
import {
  cloneRunState,
  migrateRunLog,
  replayRun,
  runRun,
  startRun,
} from '../src/run/run.ts';
import type { RunClass, RunContent, RunLog, RunState, UnlockSet } from '../src/run/types.ts';
import { RUN_LOG_FORMAT } from '../src/run/types.ts';
import {
  achievementEarned,
  actsCleared,
  cardSigilsAttached,
  earnedBy,
  isUnlocked,
  makeUnlockSet,
  parseUnlockSet,
  stillLocked,
  unlockProblems,
  unlockedContent,
  unlockedRewards,
} from '../src/run/unlocks.ts';
import { makeRunAgent } from '../src/sim/runbots.ts';
import {
  applyRunToProfile,
  emptyProfile,
  parseProfile,
  unlockSetFor,
  PROFILE_VERSION,
} from '../src/ui/profile.ts';
import {
  SAVE_PREFIX,
  classPickHtml,
  forgetRun,
  loadSavedRun,
  parseSavedRun,
  pinnedNotice,
  readSavedRun,
  saveRun,
  storageAllowed,
  unlockOverride,
  unlockSetFrom,
} from '../src/ui/runapp.ts';
import { collectionEntries, collectionHtml, runUnlocksHtml } from '../src/ui/unlocks.ts';
import { createRunController } from '../src/ui/run.ts';

const SEEDS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
const ROUTES = ['greedy', 'random'] as const;

function play(seed: number, route: (typeof ROUTES)[number], unlocked: UnlockSet | null) {
  return runRun(
    RUN_CONTENT,
    seed,
    makeRunAgent({ route, placement: 'right', seed }),
    undefined,
    unlocked,
  );
}

// ---------------------------------------------------------------------------
// An unlock widens; it never strengthens
// ---------------------------------------------------------------------------

test('narrowing a content touches the reward tables and the sigils and nothing else', () => {
  // The "no persistent power" rule, as arithmetic. Every field of RunContent is
  // walked by name off the object itself, so a field added later is in this
  // gate from the day it exists rather than the day someone remembers it.
  const MAY_DIFFER = new Set(['rewards', 'sigils', 'classes']);
  for (const set of [FRESH_UNLOCKS, ALL_UNLOCKS, unlocksFor(['a_first_run'])]) {
    const narrowed = unlockedContent(RUN_CONTENT, set);
    const keys = Object.keys(RUN_CONTENT) as (keyof RunContent)[];
    assert.ok(keys.length >= 18, `RunContent has ${keys.length} fields; the walk looks wrong`);
    assert.deepEqual(Object.keys(narrowed).sort(), keys.slice().sort(), 'a field appeared or vanished');
    for (const key of keys) {
      if (MAY_DIFFER.has(key)) continue;
      assert.equal(
        narrowed[key],
        RUN_CONTENT[key],
        `narrowing moved "${key}" - an unlock may only add rows to a draw table`,
      );
    }
    // Each class keeps everything but its pool, by reference - and the walk is
    // off the class object rather than a list written here, for the same
    // reason the `RunContent` walk above is. A hand-written five-field list
    // was the one narrowing left in this gate: a field added to `RunClass`
    // tomorrow would have fallen outside it on the day it was added.
    const before = RUN_CONTENT.classes ?? [];
    const after = narrowed.classes ?? [];
    assert.equal(after.length, before.length);
    for (let i = 0; i < before.length; i++) {
      const classKeys = Object.keys(before[i]!) as (keyof RunClass)[];
      assert.ok(classKeys.length >= 5, `RunClass has ${classKeys.length} fields; the walk looks wrong`);
      assert.deepEqual(
        Object.keys(after[i]!).sort(),
        classKeys.slice().sort(),
        'narrowing added or dropped a class field',
      );
      for (const key of classKeys) {
        if (key === 'rewards') continue;
        assert.equal(
          after[i]![key],
          before[i]![key],
          `narrowing moved the ${before[i]!.name}'s "${key}" - an unlock may only add rows to a ` +
            `draw table`,
        );
      }
    }
  }
});

test('widening only ever adds rows, and never edits one', () => {
  // For any two sets where the second owns everything the first owns, the
  // first's tables are a subsequence of the second's, entry object for entry
  // object - so no weight, cost or order can move as something is unlocked.
  const ladder: UnlockSet[] = [
    FRESH_UNLOCKS,
    unlocksFor(['a_first_run']),
    unlocksFor(['a_first_run', 'a_act_one']),
    unlocksFor(['a_first_run', 'a_act_one', 'a_act_two']),
    unlocksFor(ACHIEVEMENTS.map((a) => a.id)),
    ALL_UNLOCKS,
  ];
  const isSubsequence = <T>(small: readonly T[], big: readonly T[]): boolean => {
    let at = 0;
    for (const item of small) {
      const found = big.indexOf(item, at);
      if (found < 0) return false;
      at = found + 1;
    }
    return true;
  };
  let widened = 0;
  for (let i = 0; i + 1 < ladder.length; i++) {
    const narrow = unlockedContent(RUN_CONTENT, ladder[i]!);
    const wide = unlockedContent(RUN_CONTENT, ladder[i + 1]!);
    assert.ok(
      isSubsequence(narrow.rewards, wide.rewards),
      `step ${i}: the narrower pool is not a subsequence of the wider one`,
    );
    assert.ok(isSubsequence(narrow.sigils, wide.sigils), `step ${i}: the sigils are not a subsequence`);
    for (let c = 0; c < (narrow.classes ?? []).length; c++) {
      assert.ok(
        isSubsequence(narrow.classes![c]!.rewards, wide.classes![c]!.rewards),
        `step ${i}: the ${narrow.classes![c]!.name}'s pool is not a subsequence of the wider one`,
      );
    }
    if (wide.rewards.length > narrow.rewards.length) widened++;
  }
  assert.ok(widened >= 3, `expected the ladder to widen; it widened at ${widened} of its steps`);
  assert.deepEqual(
    unlockedContent(RUN_CONTENT, ALL_UNLOCKS).rewards.map((r) => r.cardId),
    RUN_CONTENT.rewards.map((r) => r.cardId),
    'owning everything gated is not the same pool as no unlock layer',
  );
});

test('a run always starts with its class whole starting deck, whatever is locked', () => {
  for (const cls of CLASSES) {
    for (const set of [FRESH_UNLOCKS, ALL_UNLOCKS, null]) {
      const run = startRun(RUN_CONTENT, 3, cls.id, set);
      assert.deepEqual(
        run.deck.map((d) => d.cardId),
        cls.startingDeck.slice(),
        `${cls.name}: a locked card must never be missing from the deck a run is handed`,
      );
      assert.equal(run.hero.maxHealth, cls.hero.health, `${cls.name}: an unlock moved the life bar`);
    }
  }
});

test('a locked card is never offered and a locked sigil is never granted', () => {
  let gatedSeen = 0;
  let unnarrowedGated = 0;
  let shelves = 0;
  for (const route of ROUTES) {
    for (const seed of SEEDS) {
      const fresh = play(seed, route, FRESH_UNLOCKS);
      for (const dc of fresh.run.deck) {
        assert.ok(
          isUnlocked(FRESH_UNLOCKS, dc.cardId),
          `seed ${seed}/${route}: "${dc.cardId}" joined the deck and a fresh profile cannot draft it`,
        );
      }
      for (const g of fresh.run.sigils) {
        assert.ok(
          isUnlocked(FRESH_UNLOCKS, g.sigilId),
          `seed ${seed}/${route}: "${g.sigilId}" was granted and a fresh profile cannot draft it`,
        );
      }
      // The other direction, which is what makes this window able to tell
      // "passed" from "did not run": the same seed with nothing gated does
      // draft gated content, so the check above is not passing on emptiness.
      const open = play(seed, route, null);
      if (open.run.deck.some((d) => GATED_IDS.includes(d.cardId))) unnarrowedGated++;
      if (open.run.sigils.some((g) => GATED_IDS.includes(g.sigilId))) unnarrowedGated++;
      gatedSeen++;
    }
  }
  assert.equal(gatedSeen, SEEDS.length * ROUTES.length);
  assert.ok(
    unnarrowedGated >= SEEDS.length,
    `with nothing gated only ${unnarrowedGated} run(s) touched gated content, so the narrowed ` +
      `runs above prove little`,
  );

  // The offer functions directly, rather than only what a bot took from them.
  for (const seed of SEEDS) {
    const run = startRun(RUN_CONTENT, seed, 'knight', FRESH_UNLOCKS);
    const map = run.maps[0]!;
    for (const node of map.nodes) {
      const cursor = cloneRunState(run);
      for (const item of shopStock(cursor)) {
        assert.ok(isUnlocked(FRESH_UNLOCKS, item.cardId), `a shop stocked locked "${item.cardId}"`);
      }
      for (const option of rewardOffer(cloneRunState(run), node)) {
        const id = option.kind === 'card' ? option.cardId : option.sigil.id;
        assert.ok(isUnlocked(FRESH_UNLOCKS, id), `a shelf offered locked "${id}"`);
      }
      shelves++;
    }
  }
  assert.ok(shelves > 200, `expected a real corpus of shelves, drew only ${shelves}`);
});

test('the shipped content is playable at every unlock set a player can reach', () => {
  // The structural half of "every run is winnable from the first one": at no
  // reachable set is a pool shorter than the shelf it has to fill, and there is
  // always a card sigil for the card-sigil roll to offer.
  const reachable: UnlockSet[] = [
    FRESH_UNLOCKS,
    ALL_UNLOCKS,
    ...ACHIEVEMENTS.map((a) => unlocksFor([a.id])),
    unlocksFor(ACHIEVEMENTS.map((a) => a.id)),
  ];
  for (const set of reachable) {
    assert.deepEqual(unlockProblems(RUN_CONTENT, set), []);
  }
  assert.deepEqual(unlockProblems(RUN_CONTENT, null), []);

  // And it fires when it should, so the empty list above is a result.
  const starved = makeUnlockSet(RUN_CONTENT.rewards.map((r) => r.cardId), []);
  const problems = unlockProblems(RUN_CONTENT, starved);
  assert.ok(problems.length > 0, 'gating every card left no problem to report');
  assert.match(problems[0]!, /can draft 0 card\(s\)/);
  const noSigil = makeUnlockSet(SIGILS.filter((s) => s.kind === 'card').map((s) => s.id), []);
  assert.ok(
    unlockProblems(RUN_CONTENT, noSigil).some((p) => /no card sigil is unlocked/.test(p)),
    'gating every card sigil left no problem to report',
  );
});

// ---------------------------------------------------------------------------
// A recorded run replays against the pool it was played with
// ---------------------------------------------------------------------------

test('a run replays from the unlock set in its log, not from what is unlocked now', () => {
  let moved = 0;
  for (const route of ROUTES) {
    for (const seed of SEEDS) {
      const fresh = play(seed, route, FRESH_UNLOCKS);
      const open = play(seed, route, null);
      const freshHash = hashRun(fresh.run);

      assert.deepEqual(
        fresh.log.unlocked,
        FRESH_UNLOCKS,
        `seed ${seed}/${route}: the log did not record the set it was played with`,
      );
      assert.equal(open.log.unlocked, undefined, 'a run with no unlock layer wrote one into its log');

      // The log replays to its own run, and the content it is replayed against
      // is the *whole* content - what narrows it is the set inside the log.
      assert.equal(
        hashRun(replayRun(RUN_CONTENT, fresh.log)),
        freshHash,
        `seed ${seed}/${route}: the fresh-profile log did not replay to its own run`,
      );
      // And replaying it in a world where everything is unlocked reaches the
      // same run, because the log is what decides.
      assert.equal(
        hashRun(replayRun(unlockedContent(RUN_CONTENT, ALL_UNLOCKS), fresh.log)),
        freshHash,
        `seed ${seed}/${route}: the replay used the caller's pool instead of the log's`,
      );
      if (hashRun(open.run) !== freshHash) moved++;
    }
  }
  assert.equal(
    moved,
    SEEDS.length * ROUTES.length,
    'the unlock set changed no run at all, so nothing above was tested',
  );
});

test('owning everything gated plays the same run as no unlock layer, and says which it was', () => {
  // The filter is a filter: with nothing held back it changes no draw, no deck
  // and no generator position. The one thing that does differ is the digest,
  // and it differs on purpose - two runs that drafted from different pools are
  // different runs even where their states coincide.
  for (const seed of SEEDS) {
    const open = play(seed, 'greedy', null);
    const all = play(seed, 'greedy', ALL_UNLOCKS);
    const strip = (run: RunState): string => runToCanonical(run).replace(/;unlocked=.*$/, '');
    assert.equal(strip(all.run), strip(open.run), `seed ${seed}: owning everything changed the run`);
    assert.notEqual(
      hashRun(all.run),
      hashRun(open.run),
      `seed ${seed}: the digest does not record which pool the run drafted from`,
    );
    assert.match(runToCanonical(all.run), /;unlocked=g\[/);
    assert.doesNotMatch(runToCanonical(open.run), /unlocked=/);
  }
});

test('a log naming an unreadable unlock set is refused by name, never quietly widened', () => {
  const { log } = play(4, 'greedy', FRESH_UNLOCKS);
  const bad: [unknown, RegExp][] = [
    [7, /holds number where an unlock set belongs/],
    ['all', /holds string where an unlock set belongs/],
    [{ owned: [] }, /has no `gated` list/],
    [{ gated: [], owned: 'everything' }, /has no `owned` list/],
    [{ gated: [5], owned: [] }, /lists 5 in `gated`/],
    [{ gated: [], owned: [''] }, /lists "" in `owned`/],
  ];
  for (const [value, message] of bad) {
    const broken = { ...log, unlocked: value } as unknown as RunLog;
    assert.throws(() => replayRun(RUN_CONTENT, broken), message, `replayRun accepted ${JSON.stringify(value)}`);
    assert.throws(() => migrateRunLog(broken), message, `migrateRunLog accepted ${JSON.stringify(value)}`);
  }
  // A set it can read is carried through the upgrade untouched.
  assert.deepEqual(migrateRunLog(log).unlocked, FRESH_UNLOCKS);
  assert.equal(parseUnlockSet(undefined, 'x'), null);
  assert.equal(parseUnlockSet(null, 'x'), null);
});

/**
 * The reward table the two golden logs were recorded against, pinned here for
 * the reason `docs/policies/local-rules.md` gives: a saved log is a list of
 * indices into offers, so content retires it and the pin is a standing cost.
 * The same ten entries `test/sigils.test.ts` pins; this file asks a different
 * question of them.
 */
const LEGACY_REWARDS = [
  { cardId: 'u_squire', weight: 10 },
  { cardId: 'u_shieldbearer', weight: 10 },
  { cardId: 'u_pikeman', weight: 10 },
  { cardId: 'u_hornblower', weight: 8 },
  { cardId: 'u_ironguard', weight: 8 },
  { cardId: 'u_avenger', weight: 8 },
  { cardId: 'u_berserker', weight: 8 },
  { cardId: 'u_captain', weight: 4 },
  { cardId: 'u_sentinel', weight: 4 },
  { cardId: 'u_champion', weight: 4 },
] as const;

test('a golden log from before unlocks replays untouched, and names no unlock set', () => {
  // **The bound.** Two whole-run choice lists recorded at `c13a0cc`, before
  // sigils and before unlocks, against `RUN_CONTENT` with the table above.
  // What this asks that `test/sigils.test.ts` does not: that unit 12 moved
  // neither of those two runs. A log that names no set is a run that was
  // played with no unlock layer - the only thing such a run could have been -
  // so its canonical string must still carry no `unlocked=` clause and its
  // pre-class hash must still be the one it recorded.
  const legacy: RunContent = { ...RUN_CONTENT, rewards: LEGACY_REWARDS.map((r) => ({ ...r })) };
  delete (legacy as { classes?: unknown }).classes;

  let checked = 0;
  for (const path of [
    'test/golden/run-log-format-1-seed-6-random.json',
    'test/golden/run-log-format-1-seed-7-greedy.json',
  ]) {
    const fixture = JSON.parse(readFileSync(path, 'utf8')) as {
      hash: string;
      result: string;
      log: { seed: number; unlocked?: unknown };
    };
    assert.equal(fixture.log.unlocked, undefined, `${path} names an unlock set; it predates them`);

    const upgraded = migrateRunLog(fixture.log);
    assert.equal(upgraded.unlocked, undefined, 'the upgrade invented an unlock set');
    const replayed = replayRun(legacy, upgraded);
    assert.equal(replayed.unlocked, null, `${path}: replayed with an unlock layer it never had`);
    const canonical = runToCanonical(replayed);
    assert.doesNotMatch(
      canonical,
      /unlocked=/,
      `${path}: unit 12 put an unlock clause in a digest recorded before unlocks existed`,
    );
    assert.equal(replayed.result, fixture.result, `${path}: the run ended somewhere else`);
    assert.equal(
      hashString(canonical.replace(/;class=[a-z]+;/, ';')),
      fixture.hash,
      `${path}: the run this log records is not the run it reached`,
    );
    checked++;
  }
  assert.equal(checked, 2, 'a golden was skipped');
});

test('a saved run cannot be resumed against a pool it was not played with', () => {
  const { log } = play(5, 'greedy', FRESH_UNLOCKS);
  const partial = { ...log, nodes: log.nodes.slice(0, 4) };
  // Resumed with nothing said about unlocks, the log's own set is used.
  const same = createRunController(RUN_CONTENT, 5, { resume: partial });
  assert.deepEqual(same.unlocked, FRESH_UNLOCKS);
  assert.deepEqual(same.log.unlocked, FRESH_UNLOCKS);
  assert.equal(
    hashRun(same.state),
    hashRun(replayRun(RUN_CONTENT, partial)),
    'the resumed run is not the run its log records',
  );
  // Resumed against a wider pool, it is refused by name rather than obeyed.
  assert.throws(
    () => createRunController(RUN_CONTENT, 5, { resume: partial, unlocked: ALL_UNLOCKS }),
    /cannot resume a run played with/,
  );
  assert.throws(
    () => createRunController(RUN_CONTENT, 5, { resume: partial, unlocked: null }),
    /cannot resume a run played with/,
  );
  // A fresh run records what it was given.
  const fresh = createRunController(RUN_CONTENT, 5, { unlocked: FRESH_UNLOCKS });
  assert.deepEqual(fresh.log.unlocked, FRESH_UNLOCKS);
  assert.equal(createRunController(RUN_CONTENT, 5).log.unlocked, undefined);
});

// ---------------------------------------------------------------------------
// What a finished run earned
// ---------------------------------------------------------------------------

test('every achievement reads the finished run and nothing else', () => {
  const run = play(7, 'greedy', FRESH_UNLOCKS).run;
  assert.notEqual(run.result, 'ongoing', 'the fixture run did not finish');
  // Each condition, against the numbers it claims to read.
  assert.equal(achievementEarned(run, { kind: 'finished' }), true);
  assert.equal(achievementEarned(run, { kind: 'won' }), run.result === 'won');
  assert.equal(achievementEarned(run, { kind: 'actsCleared', amount: actsCleared(run) }), true);
  assert.equal(achievementEarned(run, { kind: 'actsCleared', amount: actsCleared(run) + 1 }), false);
  const attached = cardSigilsAttached(run);
  assert.equal(achievementEarned(run, { kind: 'cardSigils', amount: attached }), true);
  assert.equal(achievementEarned(run, { kind: 'cardSigils', amount: attached + 1 }), false);
  assert.equal(
    attached,
    run.sigils.filter((g) => g.target !== 'hero').length,
    'a hero sigil was counted as a card sigil',
  );

  // An ongoing run has earned nothing, not even "finished".
  const ongoing = startRun(RUN_CONTENT, 7, 'knight', FRESH_UNLOCKS);
  assert.equal(ongoing.result, 'ongoing');
  assert.deepEqual(earnedBy(ongoing, ACHIEVEMENTS), []);
  for (const a of ACHIEVEMENTS) assert.equal(achievementEarned(ongoing, a.condition), false);
});

test('the shipped achievements are all reachable, and each hands over gated content', () => {
  const fired = new Map<string, number>();
  for (const route of ROUTES) {
    for (const seed of SEEDS) {
      for (const a of earnedBy(play(seed, route, FRESH_UNLOCKS).run, ACHIEVEMENTS)) {
        fired.set(a.id, (fired.get(a.id) ?? 0) + 1);
      }
    }
  }
  for (const id of ['a_first_run', 'a_act_one', 'a_act_two', 'a_won_run']) {
    assert.ok((fired.get(id) ?? 0) > 0, `"${id}" fired on none of the ${SEEDS.length * 2} runs`);
  }
  // `a_cascade` asks for three card sigils in one run, which the bots take
  // rarely; it is exercised against a state built for it rather than left to
  // the window, so "did not fire" cannot read as "passed".
  const run = play(7, 'greedy', FRESH_UNLOCKS).run;
  const three: RunState = {
    ...run,
    sigils: [
      { target: { instanceId: 'a#0' }, sigilId: 'si_relay' },
      { target: { instanceId: 'b#1' }, sigilId: 'si_wake' },
      { target: { instanceId: 'c#2' }, sigilId: 'si_relay' },
      { target: 'hero', sigilId: 'si_oak' },
    ],
  };
  assert.equal(cardSigilsAttached(three), 3);
  assert.ok(earnedBy(three, ACHIEVEMENTS).some((a) => a.id === 'a_cascade'));

  // Every gated id is handed over by exactly one achievement, and every
  // achievement hands over something gated.
  for (const id of GATED_IDS) assert.ok(unlockedBy(id) !== undefined, `nothing unlocks "${id}"`);
  for (const a of ACHIEVEMENTS) {
    assert.ok(a.unlocks.length > 0, `"${a.id}" unlocks nothing`);
    for (const id of a.unlocks) assert.ok(GATED_IDS.includes(id), `"${a.id}" hands over ungated "${id}"`);
  }
  assert.equal(
    new Set(ACHIEVEMENTS.flatMap((a) => a.unlocks)).size,
    GATED_IDS.length,
    'the achievements between them do not cover the gated list exactly once',
  );
});

test('a profile only ever widens, and a finished run moves it by exactly one', () => {
  let profile = emptyProfile();
  assert.deepEqual(unlockSetFor(profile), FRESH_UNLOCKS);
  let finished = 0;
  let won = 0;
  let everGained = 0;
  for (const seed of SEEDS) {
    const run = play(seed, 'greedy', unlockSetFor(profile)).run;
    const before = profile;
    const result = applyRunToProfile(profile, run);
    profile = result.profile;
    finished++;
    if (run.result === 'won') won++;
    everGained += result.gained.length;
    assert.equal(profile.runsFinished, finished, 'a finished run did not move the counter by one');
    assert.equal(profile.runsWon, won);
    for (const id of before.earned) assert.ok(profile.earned.includes(id), `"${id}" was taken back`);
    for (const id of before.owned) assert.ok(profile.owned.includes(id), `"${id}" was taken back`);
    assert.deepEqual(
      result.gained.filter((id) => before.owned.includes(id)),
      [],
      'something already owned was reported as newly gained',
    );
    // What the run says it earned is in the profile afterwards.
    for (const a of earnedBy(run, ACHIEVEMENTS)) {
      assert.ok(profile.earned.includes(a.id), `"${a.id}" was earned and not recorded`);
      for (const id of a.unlocks) assert.ok(profile.owned.includes(id), `"${id}" was earned and not owned`);
    }
  }
  assert.ok(everGained > 0, 'nothing was unlocked across the window, so nothing above was tested');

  // An ongoing run changes nothing at all.
  const ongoing = startRun(RUN_CONTENT, 1, 'knight', FRESH_UNLOCKS);
  const untouched = applyRunToProfile(profile, ongoing);
  assert.equal(untouched.profile, profile);
  assert.deepEqual(untouched.gained, []);

  // An id in `owned` that no achievement grants is kept, because an unlock
  // that can be taken back by a content change is not an unlock.
  const odd = { ...emptyProfile(), owned: ['u_thane'], earned: [] };
  assert.ok(unlockSetFor(odd).owned.includes('u_thane'));
  const after = applyRunToProfile(odd, play(1, 'greedy', FRESH_UNLOCKS).run).profile;
  assert.ok(after.owned.includes('u_thane'), 'a stored unlock was dropped');
});

test('a stored profile is read strictly, and an unreadable one is refused by name', () => {
  const good = { ...emptyProfile(), earned: ['a_first_run'], owned: ['u_captain'], runsFinished: 2 };
  assert.deepEqual(parseProfile(JSON.parse(JSON.stringify(good))), good);
  const bad: [unknown, RegExp][] = [
    [null, /holds null where a profile belongs/],
    ['{}', /holds string where a profile belongs/],
    [{ ...good, version: PROFILE_VERSION + 1 }, /written in version/],
    [{ ...good, earned: 'a_first_run' }, /has no `earned` list/],
    [{ ...good, owned: [3] }, /lists 3 in `owned`/],
    [{ ...good, runsFinished: -1 }, /counts runs/],
    [{ ...good, runsWon: 1.5 }, /counts runs/],
  ];
  for (const [value, message] of bad) {
    assert.throws(() => parseProfile(value), message, `parseProfile accepted ${JSON.stringify(value)}`);
  }
});

// ---------------------------------------------------------------------------
// What the screens say
// ---------------------------------------------------------------------------

test('the class-pick screen promises the pool the run will actually have', () => {
  // The screen says "Drafts from N cards" and the run has to have N. Both
  // sides come from the run layer here: the number on the screen and the
  // number in `startRun`'s own content.
  for (const cls of CLASSES) {
    for (const set of [FRESH_UNLOCKS, ALL_UNLOCKS, unlocksFor(['a_act_one'])]) {
      const html = classPickHtml({ seed: 1, pool: CARD_POOL, mount: true, hatch: false, unlocked: set });
      const real = startRun(RUN_CONTENT, 1, cls.id, set).content.rewards.length;
      assert.match(
        html,
        new RegExp(`Drafts from ${real} cards`),
        `${cls.name}: the pick screen and the run disagree about the pool at this unlock set`,
      );
    }
    // With no unlock layer it is the screen it was before unlocks existed.
    assert.match(
      classPickHtml({ seed: 1, pool: CARD_POOL, mount: true, hatch: false }),
      new RegExp(`Drafts from ${cls.rewards.length} cards`),
      `${cls.name}: the unnarrowed screen moved`,
    );
  }
  // A fresh profile really does say something smaller, or the check above
  // would pass on two identical numbers.
  const fresh = classPickHtml({ seed: 1, pool: CARD_POOL, mount: true, hatch: false, unlocked: FRESH_UNLOCKS });
  const open = classPickHtml({ seed: 1, pool: CARD_POOL, mount: true, hatch: false });
  assert.notEqual(fresh, open, 'the pick screen reads the same locked and unlocked');
});

test('the collection lists every unlockable thing, owned or not, and how to open it', () => {
  const locked = collectionEntries(FRESH_UNLOCKS, CARD_POOL);
  assert.equal(locked.length, GATED_IDS.length);
  for (const entry of locked) {
    assert.equal(entry.owned, false, `"${entry.id}" reads as owned at a fresh profile`);
    assert.ok(entry.from !== null, `"${entry.id}" says nothing about how to open it`);
    assert.notEqual(entry.name, entry.id, `"${entry.id}" has no name on the collection screen`);
  }
  const open = collectionEntries(ALL_UNLOCKS, CARD_POOL);
  assert.equal(open.filter((e) => e.owned).length, GATED_IDS.length);

  const html = collectionHtml(emptyProfile(), FRESH_UNLOCKS, CARD_POOL);
  assert.match(html, new RegExp(`0 of ${GATED_IDS.length} unlocked`));
  for (const entry of locked) assert.ok(html.includes(entry.name), `"${entry.name}" is not on the screen`);
  for (const a of ACHIEVEMENTS) assert.ok(html.includes(a.how), `"${a.id}" does not say what to do`);
  // The screen says what an unlock is not, because a collection screen is the
  // first place a player assumes there is a permanent bonus.
  assert.match(html, /never raises a number/);

  // A card the pool no longer knows is listed by id rather than crashing.
  const thin: CardPool = {
    card: (id) => {
      throw new Error(`no card "${id}"`);
    },
    energyPerTurn: 3,
    handSize: 5,
  };
  const missing = collectionEntries(FRESH_UNLOCKS, thin).filter((e) => e.kind === 'card');
  assert.ok(missing.length > 0);
  for (const entry of missing) assert.equal(entry.what, 'no longer in the card pool');
});

test('the end screen says what the run unlocked, and only when it unlocked something', () => {
  const run = play(7, 'greedy', FRESH_UNLOCKS).run;
  const first = applyRunToProfile(emptyProfile(), run);
  assert.ok(first.newlyEarned.length > 0, 'the fixture run earned nothing');
  const html = runUnlocksHtml(first, CARD_POOL);
  for (const a of first.newlyEarned) assert.ok(html.includes(a.name), `"${a.id}" is not on the end screen`);
  for (const id of first.gained) {
    const name = SIGILS.find((s) => s.id === id)?.name ?? CARD_POOL.card(id).name;
    assert.ok(html.includes(name), `"${id}" was unlocked and the screen does not name it`);
  }
  assert.match(html, /does not make you stronger/);

  // The same run again earns nothing new, and the block disappears.
  const again = applyRunToProfile(first.profile, run);
  assert.deepEqual(again.newlyEarned, []);
  assert.equal(runUnlocksHtml(again, CARD_POOL), '');
  assert.equal(again.profile.runsFinished, 2, 'the counter still moves for a run that earned nothing');
});

test('?unlocks= pins the pool and is the only thing that can', () => {
  const profile = { ...emptyProfile(), earned: ['a_first_run'], owned: ['u_captain'] };
  assert.equal(unlockOverride('all'), 'all');
  assert.equal(unlockOverride('none'), 'none');
  for (const raw of [null, undefined, '', 'ALL', 'everything', '1']) {
    assert.equal(unlockOverride(raw), null, `"${String(raw)}" was read as an override`);
  }
  assert.equal(unlockSetFrom('all', profile), null, '?unlocks=all is no unlock layer');
  assert.deepEqual(unlockSetFrom('none', profile), FRESH_UNLOCKS);
  assert.deepEqual(unlockSetFrom(null, profile), unlockSetFor(profile));
  assert.ok(unlockSetFrom(null, profile)!.owned.includes('u_captain'));
});

test('the narrowing predicate has one implementation, and the screen uses it', () => {
  // `unlockedRewards` is what both `unlockedContent` and `classPickHtml` call.
  // Two filters that disagreed would put a pool size on the screen that no run
  // has, so the gate is that the one function answers for both.
  const set = unlocksFor(['a_act_one']);
  for (const cls of CLASSES) {
    assert.deepEqual(
      unlockedRewards(set, cls.rewards).map((r) => r.cardId),
      startRun(RUN_CONTENT, 1, cls.id, set).content.rewards.map((r) => r.cardId),
      `${cls.name}: the shared filter and the run's own pool disagree`,
    );
  }
  assert.equal(unlockedRewards(null, RUN_CONTENT.rewards), RUN_CONTENT.rewards);
  assert.deepEqual(stillLocked(FRESH_UNLOCKS), GATED_IDS.slice().sort());
  assert.deepEqual(stillLocked(ALL_UNLOCKS), []);
});

// ---------------------------------------------------------------------------
// Closing an independent review: the holes sixteen mutations left open
// ---------------------------------------------------------------------------

/**
 * A ladder of sets a real player passes through. `FRESH_UNLOCKS` and
 * `ALL_UNLOCKS` are the two ends and were the only two the first round of gates
 * used; the three in the middle are what a partly-unlocked profile is, which is
 * the ordinary case and was the one case nothing covered.
 */
const LADDER: readonly { readonly name: string; readonly set: UnlockSet }[] = [
  { name: 'a fresh profile', set: FRESH_UNLOCKS },
  { name: 'one deed earned', set: unlocksFor(['a_first_run']) },
  { name: 'two deeds earned', set: unlocksFor(['a_first_run', 'a_act_one']) },
  { name: 'four deeds earned', set: unlocksFor(['a_first_run', 'a_act_one', 'a_act_two', 'a_cascade']) },
  { name: 'everything owned', set: ALL_UNLOCKS },
];

test('a set arrives in any order and the run is still the run its own log replays', () => {
  // `UnlockSet` is a structural type: nothing forces a caller through
  // `makeUnlockSet`, and the digest quotes both lists in order. `replayRun`
  // reads its set through `parseUnlockSet`, which sorts and dedupes - so a run
  // started from an unsorted or duplicated list used to hash differently from
  // its own replay while being, draw for draw, the same run. That is the
  // keystone breaking on an input nothing rejected.
  const owned = ['u_captain', 'u_sentinel', 'si_guard'];
  const canonical = makeUnlockSet(GATED_IDS, owned);
  const shapes: readonly { readonly what: string; readonly set: UnlockSet }[] = [
    { what: 'reversed gated', set: { gated: [...GATED_IDS].reverse(), owned: [...owned].sort() } },
    { what: 'reversed owned', set: { gated: [...GATED_IDS].sort(), owned: [...owned].reverse() } },
    { what: 'a duplicate in owned', set: { gated: [...GATED_IDS].sort(), owned: [...owned, 'u_captain'] } },
    { what: 'a duplicate in gated', set: { gated: [...GATED_IDS, 'u_captain'], owned: [...owned].sort() } },
  ];
  for (const seed of [3, 7, 11]) {
    const straight = play(seed, 'greedy', canonical);
    const wanted = hashRun(straight.run);
    for (const { what, set } of shapes) {
      const run = startRun(RUN_CONTENT, seed, 'knight', set);
      assert.deepEqual(run.unlocked, canonical, `${what}: the run kept a non-canonical set`);

      const played = play(seed, 'greedy', set);
      assert.equal(
        hashRun(played.run),
        wanted,
        `seed ${seed}, ${what}: the run hashed differently from the same set written in order`,
      );
      assert.equal(
        hashRun(replayRun(RUN_CONTENT, played.log)),
        hashRun(played.run),
        `seed ${seed}, ${what}: the live run and its own replay disagree`,
      );
      assert.deepEqual(played.log.unlocked, canonical, `${what}: the log recorded the caller's order`);
    }
    // The window can tell "passed" from "did not run": a set that owns
    // *different* ids does reach a different run, so the equalities above are
    // not holding because the unlock set changes nothing.
    assert.notEqual(
      hashRun(play(seed, 'greedy', FRESH_UNLOCKS).run),
      wanted,
      `seed ${seed}: owning three things reached the same run as owning none`,
    );
  }
  // The same rule on the controller, which compares its set with the log's.
  const { log } = play(5, 'greedy', canonical);
  const resumed = createRunController(RUN_CONTENT, 5, {
    resume: { ...log, nodes: log.nodes.slice(0, 4) },
    unlocked: { gated: [...GATED_IDS].reverse(), owned: [...owned].reverse() },
  });
  assert.deepEqual(resumed.unlocked, canonical, 'the controller refused a resume on list order alone');
});

test('a run at a half-unlocked profile replays from its log, not from its gated list', () => {
  // The window the first round of gates did not have. Every replay assertion
  // it made ran at `owned: []`, so a `startRun` that recorded the *gated* list
  // with an empty `owned` - while still narrowing by the real set - was
  // invisible: at a fresh profile that record is the truth. A partly unlocked
  // profile is the ordinary case and is the one that catches it.
  let reached = 0;
  let distinct = new Set<string>();
  for (const { name, set } of LADDER) {
    for (const seed of SEEDS) {
      const played = play(seed, 'greedy', set);
      assert.deepEqual(
        played.log.unlocked,
        set,
        `seed ${seed}, ${name}: the log did not record the set the run was played with`,
      );
      assert.equal(
        hashRun(replayRun(RUN_CONTENT, played.log)),
        hashRun(played.run),
        `seed ${seed}, ${name}: the run did not replay from its own log`,
      );
      distinct.add(hashRun(played.run));
      reached++;
    }
  }
  assert.equal(reached, LADDER.length * SEEDS.length);
  // And the ladder is a ladder: the sets reach different runs, so the replays
  // above are not all the same run five times.
  assert.ok(
    distinct.size > SEEDS.length,
    `the ${LADDER.length} sets produced only ${distinct.size} distinct run(s) across ` +
      `${SEEDS.length} seeds, so nothing above distinguished them`,
  );
});

test('an unlock moves nothing in the run but the pool it drafts from', () => {
  // The "no persistent power" rule, past `unlockedContent`'s boundary. That
  // function's own gate walks `RunContent` and stops where the function stops:
  // a starting-gold bonus scaled by how much is still locked, written into
  // `startRun`, is outside it and survived every check. So this walks the
  // *state* a run begins in, key by key off the object, and every key but the
  // two that are the pool itself must be identical whatever is owned.
  //
  // `content` is one of those two, and skipping it wholesale was the second
  // escape, found by an independent review. `RunState` copies only `hero`,
  // `startingGold`, `mapShape` and `startingDeck` out of `RunContent`; every
  // other number a run obeys - `restHealFraction`, `shopBasePrice`,
  // `maxRounds`, `rewardOffers`, `cardSigilChance` - reaches it through
  // `run.content` alone. `unlockedContent`'s walk stops at that function's
  // boundary, `contentForClass` sits between the two, and so a catch-up bonus
  // written onto the content in `startRun` was outside **both**:
  // `restHealFraction + 0.25` while anything is still locked passed all 273
  // tests, and so did `shopBasePrice: 0` with `maxRounds + 5`. Both are
  // literally what this test's own message forbids.
  //
  // So `content` is walked too, and its three exceptions are not a new list:
  // they are exactly what the sibling test above already enumerates as the
  // only things `unlockedContent` may touch.
  const MAY_DIFFER = new Set(['content', 'unlocked']);
  const CONTENT_MAY_DIFFER = new Set(['rewards', 'sigils', 'classes']);

  const sameContent = (want: RunContent, got: RunContent, where: string): void => {
    const ckeys = Object.keys(want) as (keyof RunContent)[];
    assert.ok(ckeys.length >= 18, `RunContent has ${ckeys.length} fields; the walk looks wrong`);
    assert.deepEqual(
      Object.keys(got).sort(),
      ckeys.slice().sort(),
      `${where}: a content field appeared or vanished`,
    );
    for (const key of ckeys) {
      if (CONTENT_MAY_DIFFER.has(key)) continue;
      assert.deepEqual(
        got[key],
        want[key],
        `${where}: the unlock set moved "content.${key}". An unlock adds rows to a draw ` +
          `table; it may not move a number, a card or a map.`,
      );
    }
    // The class the run is played as travels inside `content.classes`, so its
    // non-pool fields are on the same rule - and the walk is off the class
    // object rather than a list written here.
    const wantCls = want.classes ?? [];
    const gotCls = got.classes ?? [];
    assert.equal(gotCls.length, wantCls.length, `${where}: the class list changed length`);
    for (let i = 0; i < wantCls.length; i++) {
      const clsKeys = Object.keys(wantCls[i]!) as (keyof RunClass)[];
      assert.ok(clsKeys.length >= 5, `RunClass has ${clsKeys.length} fields; the walk looks wrong`);
      for (const key of clsKeys) {
        if (key === 'rewards') continue;
        assert.deepEqual(
          gotCls[i]![key],
          wantCls[i]![key],
          `${where}: the unlock set moved "content.classes[${i}].${key}". An unlock adds ` +
            `rows to a draw table; it may not move a number, a card or a map.`,
        );
      }
    }
  };

  for (const cls of CLASSES) {
    for (const seed of [1, 4, 9]) {
      const base = startRun(RUN_CONTENT, seed, cls.id, ALL_UNLOCKS);
      const keys = Object.keys(base) as (keyof RunState)[];
      assert.ok(keys.length >= 20, `RunState has ${keys.length} fields; the walk looks wrong`);
      for (const { name, set } of LADDER) {
        const other = startRun(RUN_CONTENT, seed, cls.id, set);
        assert.deepEqual(Object.keys(other).sort(), keys.slice().sort(), 'a field appeared or vanished');
        for (const key of keys) {
          if (MAY_DIFFER.has(key)) continue;
          assert.deepEqual(
            other[key],
            base[key],
            `${cls.name} seed ${seed}, ${name}: the unlock set moved "${key}". An unlock adds ` +
              `rows to a draw table; it may not move a number, a card or a map.`,
          );
        }
        sameContent(base.content, other.content, `${cls.name} seed ${seed}, ${name}`);
      }
      // And with no unlock layer at all, which is what every measurement plays.
      const open = startRun(RUN_CONTENT, seed, cls.id, null);
      for (const key of keys) {
        if (MAY_DIFFER.has(key)) continue;
        assert.deepEqual(open[key], base[key], `${cls.name} seed ${seed}: null and ALL differ in "${key}"`);
      }
      sameContent(base.content, open.content, `${cls.name} seed ${seed}, no unlock layer`);
    }
  }
});

test('narrowing drops exactly what is still locked, and never an ungated row', () => {
  // The other direction, and the one the design actually cares about: "every
  // run is winnable from the first one" is broken by a filter that is too
  // *narrow*, not by one that is too wide. The subsequence check above cannot
  // see that - dropping an extra card leaves a subsequence - so this pins the
  // result exactly, against a list built from `stillLocked` rather than from
  // the predicate under test.
  const sets: readonly UnlockSet[] = [
    ...LADDER.map((l) => l.set),
    ...ACHIEVEMENTS.map((a) => unlocksFor([a.id])),
  ];
  let dropped = 0;
  let kept = 0;
  for (const set of sets) {
    const locked = new Set(stillLocked(set));
    const narrowed = unlockedContent(RUN_CONTENT, set);

    const wantRewards = RUN_CONTENT.rewards.filter((r) => !locked.has(r.cardId));
    assert.deepEqual(narrowed.rewards, wantRewards, 'the content pool is not what is still unlocked');
    const wantSigils = RUN_CONTENT.sigils.filter((s) => !locked.has(s.id));
    assert.deepEqual(narrowed.sigils, wantSigils, 'the sigil list is not what is still unlocked');
    for (let c = 0; c < (RUN_CONTENT.classes ?? []).length; c++) {
      const before = RUN_CONTENT.classes![c]!;
      assert.deepEqual(
        narrowed.classes![c]!.rewards,
        before.rewards.filter((r) => !locked.has(r.cardId)),
        `the ${before.name}'s pool is not what is still unlocked`,
      );
      // `unlockedRewards` is the one filter, so the screen is held to the same
      // claim as the run - too narrow there is a promise the run does not keep.
      assert.deepEqual(
        unlockedRewards(set, before.rewards),
        before.rewards.filter((r) => !locked.has(r.cardId)),
        `the ${before.name}'s pick-screen pool is not what is still unlocked`,
      );
      dropped += before.rewards.length - narrowed.classes![c]!.rewards.length;
      kept += narrowed.classes![c]!.rewards.length;
    }
  }
  assert.ok(dropped > 0, 'no set in the ladder dropped a single row, so nothing above was tested');
  assert.ok(kept > 0, 'every row was dropped, so "never an ungated row" proves nothing');
});

test('the digest names both halves of the set, so two pools cannot hash the same', () => {
  // `hashRun` exists to tell two runs apart that coincided in state, and the
  // pool they drafted from is one of the ways they differ. Two sets with the
  // same gated list and different owned lists start identical runs - that is
  // the test above - so the digest is the only thing between them, and it has
  // to carry the owned half as well as the gated one.
  const seen = new Map<string, string>();
  for (const { name, set } of LADDER) {
    const run = startRun(RUN_CONTENT, 7, 'knight', set);
    const canonical = runToCanonical(run);
    assert.match(
      canonical,
      new RegExp(`;unlocked=g\\[${set.gated.join(',')}\\]/o\\[${set.owned.join(',')}\\]`),
      `${name}: the canonical run does not quote both halves of the set`,
    );
    const digest = hashRun(run);
    const clash = seen.get(digest);
    assert.equal(
      clash,
      undefined,
      `${name} and ${String(clash)} start the same run and hash the same; the digest does not ` +
        `record which pool the run drafted from`,
    );
    seen.set(digest, name);
  }
  assert.equal(seen.size, LADDER.length);
  // Every set in the ladder gates the same ids, so it is the owned half alone
  // that is doing the work above.
  assert.equal(new Set(LADDER.map((l) => l.set.gated.join(','))).size, 1);
});

test('a format 1 log naming an unlock set is refused, because no version wrote one', () => {
  // Unlocks landed with the format already at 2, so `unlocked` on a format 1
  // log is a field no build ever produced. Accepting it would narrow shelves
  // the recorded picks were taken from with nothing gated.
  const fixture = JSON.parse(
    readFileSync('test/golden/run-log-format-1-seed-7-greedy.json', 'utf8'),
  ) as { log: RunLog };
  assert.equal(fixture.log.unlocked, undefined, 'the golden already names a set');
  assert.equal(migrateRunLog(fixture.log).unlocked, undefined, 'the upgrade invented a set');
  assert.throws(
    () => migrateRunLog({ ...fixture.log, unlocked: FRESH_UNLOCKS }),
    /format 1 log for seed 7 names an unlock set/,
    'a format 1 log naming a set was upgraded rather than refused',
  );
  // The same field on a current-format log is carried through, which is what
  // says the refusal is about the format and not about the field.
  const current = play(7, 'greedy', FRESH_UNLOCKS).log;
  assert.deepEqual(migrateRunLog(current).unlocked, FRESH_UNLOCKS);
});

// ---------------------------------------------------------------------------
// Stored state: what a pinned pool may touch, and what an old save still loads
// ---------------------------------------------------------------------------

/** A `localStorage` that lives in the test, so the storage path is reachable at all. */
function stubStorage(): { readonly store: Map<string, string>; restore: () => void } {
  const store = new Map<string, string>();
  const had = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    },
  });
  return {
    store,
    restore: () => {
      if (had === undefined) delete (globalThis as { localStorage?: unknown }).localStorage;
      else Object.defineProperty(globalThis, 'localStorage', had);
    },
  };
}

test('a run saved by an older build still loads, instead of being read then thrown away', () => {
  // `loadSaved` parsed the stored JSON and handed it straight to the
  // controller, which replays only the current format - so a run in progress
  // from a build before sigils was refused, caught, and `forget()`-ed. The
  // player lost the run and got a line in the console. `migrateRunLog` is the
  // upgrade path that exists for exactly this, and this was its missing caller.
  const fixture = JSON.parse(
    readFileSync('test/golden/run-log-format-1-seed-7-greedy.json', 'utf8'),
  ) as { log: RunLog };
  assert.equal((fixture.log as { format?: number }).format, undefined, 'the golden is not format 1');

  const loaded = parseSavedRun(JSON.stringify(fixture.log), 7);
  assert.notEqual(loaded, null, 'a format 1 save did not load');
  assert.equal(loaded!.format, RUN_LOG_FORMAT, 'the save was loaded without being upgraded');
  assert.ok(loaded!.nodes.length > 0);

  // Not silently lenient: the shape checks and the format refusal still bite.
  assert.equal(parseSavedRun(null, 7), null);
  assert.equal(parseSavedRun('{not json', 7), null);
  assert.equal(parseSavedRun(JSON.stringify({ ...fixture.log, seed: 8 }), 7), null, 'another seed loaded');
  assert.equal(
    parseSavedRun(JSON.stringify({ ...fixture.log, format: 99 }), 7),
    null,
    'a log from an unknown format was loaded',
  );
});

test('a refused save says why on screen, instead of vanishing into the console', () => {
  // `parseSavedRun` returned `null` for "nothing stored" and for "stored and
  // refused" alike, so `startRunApp` left `opened` at 'fresh' and the notice bar
  // said nothing: `migrateRunLog`'s refusals - written to name the format, the
  // seed and what to do next - reached the console and never the player, whose
  // run had just disappeared. `readSavedRun` keeps the sentence.
  const fixture = JSON.parse(
    readFileSync('test/golden/run-log-format-1-seed-7-greedy.json', 'utf8'),
  ) as { log: RunLog };

  // Nothing stored is not a problem, and must not produce a sentence.
  assert.deepEqual(readSavedRun(null, 7), { log: null, problem: null });
  assert.deepEqual(readSavedRun(undefined, 7), { log: null, problem: null });

  // A readable save is read, and says nothing.
  const good = readSavedRun(JSON.stringify(fixture.log), 7);
  assert.equal(good.problem, null, 'a readable save produced a problem');
  assert.equal(good.log?.format, RUN_LOG_FORMAT, 'a readable save was not upgraded');

  // Every way a stored run can be refused produces a sentence, and each names
  // the seed so a player with several runs knows which one went.
  const refusals: readonly (readonly [string, string, RegExp])[] = [
    ['not JSON at all', '{not json', /cannot read|not a run log|could not/i],
    [
      'an unknown format',
      JSON.stringify({ ...fixture.log, format: 99 }),
      /format 99/,
    ],
    [
      'a format 1 log carrying an unlock set',
      JSON.stringify({ ...fixture.log, unlocked: { gated: ["u_x"], owned: [] } }),
      /unlock set/,
    ],
    ['a log for another seed', JSON.stringify({ ...fixture.log, seed: 8 }), /seed 8/],
    ['not a run log', JSON.stringify({ hello: 'world' }), /not a run log/],
  ];
  const silent: string[] = [];
  for (const [what, raw, shape] of refusals) {
    const r = readSavedRun(raw, 7);
    assert.equal(r.log, null, `${what}: a refused save was returned as a log`);
    if (r.problem === null) {
      silent.push(what);
      continue;
    }
    assert.match(r.problem, shape, `${what}: the sentence does not say what happened`);
    assert.match(
      r.problem,
      /discarded|new run/i,
      `${what}: the sentence does not tell the player what becomes of the run`,
    );
    assert.doesNotMatch(
      r.problem,
      /^run log: /,
      `${what}: the sentence still wears the internal 'run log:' prefix`,
    );
  }
  assert.deepEqual(
    silent,
    [],
    'a stored run was refused with no sentence for the screen. A run that vanishes with only a console line is a run the player watched disappear for no stated reason.',
  );

  // H, in the same walk: a log in an unknown format that *also* carries a
  // malformed set is refused for the format. `parseUnlockSet` ran first, so
  // the one fact the player needs - this build cannot read that format - was
  // replaced by a complaint about a field inside a log it was never going to
  // read.
  const both = readSavedRun(
    JSON.stringify({ ...fixture.log, format: 99, unlocked: 'not a set' }),
    7,
  );
  assert.equal(both.log, null);
  assert.match(
    both.problem ?? "",
    /format 99/,
    'a log in an unknown format was refused for something other than its format',
  );
});

test('a pinned session says on screen that the run itself is not saved', () => {
  // `storageAllowed` is false for the whole session, so `?unlocks=` costs the
  // player the **run** as well as the unlocks. The only warning said "nothing
  // this run earns is saved to your profile", which is the smaller half: a
  // player who opens `?unlocks=all`, plays for twenty minutes and reloads loses
  // the run, having been told the opposite of what they needed.
  //
  // The sentence is gated rather than trusted because it lived inside
  // `startRunApp`, which needs a document - the same reason `PICKABLE_CLASSES`
  // is exported, and the same failure: a wiring nobody can test is a wiring
  // nobody is checking.
  assert.equal(pinnedNotice(null), null, 'an unpinned session was warned about nothing');

  for (const override of ['all', 'none'] as const) {
    const said = pinnedNotice(override);
    assert.notEqual(said, null, `?unlocks=${override} produced no sentence`);
    assert.equal(
      storageAllowed(override),
      false,
      `${override}: this test assumes a pinned session touches no storage`,
    );
    // The three things it has to say, each checked on its own: what is pinned,
    // that the profile is not written, and that **the run** is not saved.
    assert.match(said!, new RegExp(`\\?unlocks=${override}`), `${override}: the sentence does not name the parameter`);
    assert.match(said!, /profile/i, `${override}: the sentence does not mention the profile`);
    assert.match(
      said!,
      /the run itself is not saved|the run is not saved/i,
      `${override}: the sentence does not say the run itself is not saved, which is what a ` +
        `player loses by reloading`,
    );
    assert.match(
      said!,
      /reload/i,
      `${override}: the sentence does not say what costs them the run`,
    );
  }

  // And it says which way the pool is pinned, so the collection screen and the
  // address bar cannot disagree.
  assert.match(pinnedNotice('all')!, /everything is draftable/);
  assert.match(pinnedNotice('none')!, /nothing unlockable is draftable/);
});

test('a pinned pool touches no stored run and no stored profile', () => {
  // `?unlocks=all` is *no unlock layer*, so a pinned run's log carries no
  // `unlocked` field and is indistinguishable from one written before unlocks
  // existed. Reloading without the parameter resumed it - the log decides, and
  // that is right - so the run carried on fully unlocked, and with no override
  // in the address that time, it wrote its deeds into the player's collection.
  // The rule is not "does not write the profile" but "touches no stored state".
  assert.equal(storageAllowed(null), true);
  assert.equal(storageAllowed('all'), false, '?unlocks=all may not reach storage');
  assert.equal(storageAllowed('none'), false, '?unlocks=none may not reach storage');

  const stub = stubStorage();
  try {
    const { log } = play(7, 'greedy', FRESH_UNLOCKS);
    const persisted = { ...log, nodes: log.nodes.slice(0, 3) };

    // A pinned session writes nothing.
    saveRun(persisted, false);
    assert.equal(stub.store.size, 0, 'a pinned session wrote a run to storage');

    // A real session writes, and reads back the same run.
    saveRun(persisted, true);
    assert.equal(stub.store.size, 1);
    assert.equal(stub.store.has(`${SAVE_PREFIX}7`), true);
    const back = loadSavedRun(7, true);
    assert.equal(back.problem, null, `a readable save reported "${String(back.problem)}"`);
    assert.deepEqual(back.log?.nodes.length, 3);
    assert.deepEqual(back.log?.unlocked, FRESH_UNLOCKS);

    // A pinned session cannot see it, so it can never finish someone else's run
    // against the pinned pool.
    assert.deepEqual(
      loadSavedRun(7, false),
      { log: null, problem: null },
      'a pinned session read a stored run',
    );

    // And cannot delete it. Opening `?seed=7&unlocks=all` must not throw away
    // the real run in progress on seed 7.
    forgetRun(7, false);
    assert.equal(stub.store.has(`${SAVE_PREFIX}7`), true, 'a pinned session deleted a stored run');
    forgetRun(7, true);
    assert.equal(stub.store.has(`${SAVE_PREFIX}7`), false, 'a real session could not delete');
  } finally {
    stub.restore();
  }
});

test('a saved run resumes on its own set even when the profile has widened since', () => {
  // Why `runapp.ts` passes no `unlocked` when it resumes, and so why
  // `createRunController`'s refusal guard is not on the app's own path. A
  // player who unlocks something on another seed and comes back to this one is
  // the ordinary case, not an error: the log's set wins and the run continues.
  // Handing the guard today's profile would refuse, and the app's catch would
  // delete the run.
  const { log } = play(9, 'greedy', FRESH_UNLOCKS);
  const partial = { ...log, nodes: log.nodes.slice(0, 5) };
  const widened = unlocksFor(['a_first_run', 'a_act_one']);
  assert.notDeepEqual(widened, FRESH_UNLOCKS, 'the profile did not widen, so nothing is tested');

  const resumed = createRunController(RUN_CONTENT, 9, { resume: partial });
  assert.deepEqual(resumed.unlocked, FRESH_UNLOCKS, 'the resumed run did not keep the log\'s set');
  assert.equal(hashRun(resumed.state), hashRun(replayRun(RUN_CONTENT, partial)));

  // The guard is still a contract for a caller that insists on a set.
  assert.throws(
    () => createRunController(RUN_CONTENT, 9, { resume: partial, unlocked: widened }),
    /cannot resume a run played with/,
  );
});
