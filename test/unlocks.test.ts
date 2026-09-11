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
// Bound of this file - what a green run does and does not prove:
//
//   Content: the shipped `RUN_CONTENT` and `GATED_IDS`, plus a two-card
//   fixture content for the cases the shipped one cannot reach (an empty
//   pool, a set that gates everything).
//   Windows: 12 shipped seeds x 2 route styles for the whole-run checks, all
//   three classes for the starting-deck and pick-screen checks, and the two
//   golden format 1 logs for the "an old log still replays" half. Windows, not
//   spaces.
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
import type { RunContent, RunLog, RunState, UnlockSet } from '../src/run/types.ts';
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
import { classPickHtml, unlockOverride, unlockSetFrom } from '../src/ui/runapp.ts';
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
    // Each class keeps everything but its pool, by reference.
    const before = RUN_CONTENT.classes ?? [];
    const after = narrowed.classes ?? [];
    assert.equal(after.length, before.length);
    for (let i = 0; i < before.length; i++) {
      assert.equal(after[i]!.id, before[i]!.id);
      assert.equal(after[i]!.name, before[i]!.name);
      assert.equal(after[i]!.hero, before[i]!.hero, 'narrowing moved a class hero');
      assert.equal(
        after[i]!.startingDeck,
        before[i]!.startingDeck,
        'narrowing moved a class starting deck',
      );
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
