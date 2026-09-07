// A placement policy must be a pure function of the fight it is handed.
//
// Why this file exists: the earlier policies were stateful closures -
// `lookaheadPlacer` carried a `salt` counter across calls, `randomPlacer`
// carried its generator - so a policy's decisions depended on how many fights
// its instance had already seen. Nothing was wrong in practice only because
// `measure.ts` builds a fresh policy per fight, and nothing said so. Hoisting
// the construction out of that loop - an obvious optimisation, since the
// policies are stateless-looking factories - would have changed every placement
// and every final hash in the measurement, silently, with every gate still
// green.
//
// It landed at `src/sim/bots.test.ts` because `test/` was being edited by
// another worker in the same wave, and moved here on 2026-09-06. Nothing about
// the tests changed with the path.
//
// Bound of these tests -- what a green run does and does not prove:
//
//   Proves   for each of the four policies, on the seeds listed below, that a
//            warmed instance places identically to a fresh one, that one
//            instance hoisted across a whole sweep gives the same fights as one
//            instance per fight, and that calling a policy twice on the same
//            fight returns the same indices.
//   Does not prove anything about a policy added later. A new stateful policy
//            is caught only if it is added to `POLICIES` below.
//   Does not prove determinism of the engine itself - `test/determinism.test.ts`
//            owns that. These tests would still pass on an engine that was
//            deterministic and wrong.

import assert from 'node:assert/strict';
import test from 'node:test';

import { type PlacementPolicy, runFight } from '../src/engine/fight.ts';
import { hashFight } from '../src/engine/hash.ts';
import {
  appendLeftPlacer,
  appendRightPlacer,
  lookaheadPlacer,
  randomPlacer,
} from '../src/sim/bots.ts';
import { setupFor } from '../src/sim/measure.ts';

/** Every policy this repo ships, each as a factory that builds a new instance. */
const POLICIES: ReadonlyArray<readonly [string, () => PlacementPolicy]> = [
  ['lookahead', () => lookaheadPlacer()],
  ['random', () => randomPlacer(3, 'placement-a')],
  ['appendRight', () => appendRightPlacer()],
  ['appendLeft', () => appendLeftPlacer()],
];

const SEEDS = [1, 2, 3, 7, 11, 19, 23, 41];

test('a warmed policy instance places exactly as a fresh one does', () => {
  for (const [name, make] of POLICIES) {
    for (const seed of SEEDS) {
      const fresh = runFight(setupFor(seed), make());

      // Warm one instance on other fights before asking it the same question.
      // Two prior fights, one of them the very fight under test, because a
      // policy carrying a counter and one carrying a generator advance for
      // different reasons.
      const warm = make();
      runFight(setupFor(seed + 500), warm);
      runFight(setupFor(seed), warm);
      const after = runFight(setupFor(seed), warm);

      assert.deepEqual(
        after.log.map((r) => r.placements),
        fresh.log.map((r) => r.placements),
        `${name}: a warmed instance placed differently from a fresh one on seed ${seed}`,
      );
      assert.equal(
        hashFight(after.fight),
        hashFight(fresh.fight),
        `${name}: a warmed instance produced a different final hash on seed ${seed}`,
      );
    }
  }
});

test('one policy instance hoisted across a sweep gives the same fights as one per fight', () => {
  const sweep = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
  for (const [name, make] of POLICIES) {
    const perFight = sweep.map((seed) => runFight(setupFor(seed), make()));

    const hoisted = make();
    const shared = sweep.map((seed) => runFight(setupFor(seed), hoisted));

    for (let i = 0; i < sweep.length; i++) {
      assert.deepEqual(
        shared[i]!.log.map((r) => r.placements),
        perFight[i]!.log.map((r) => r.placements),
        `${name}: hoisting the policy changed the placements on seed ${sweep[i]}`,
      );
      assert.equal(
        hashFight(shared[i]!.fight),
        hashFight(perFight[i]!.fight),
        `${name}: hoisting the policy changed the final hash on seed ${sweep[i]}`,
      );
    }
  }
});

test('a policy asked the same question twice gives the same answer', () => {
  for (const [name, make] of POLICIES) {
    const policy = make();
    let decisions = 0;
    runFight(setupFor(5), (f, plays) => {
      const first = policy(f, plays);
      const second = policy(f, plays);
      assert.deepEqual(
        second,
        first,
        `${name}: two calls on the same fight and hand returned different indices`,
      );
      if (plays.length > 0) decisions++;
      return first;
    });
    // A policy that never faced a decision would pass the assertion above
    // without the assertion ever running.
    assert.ok(decisions > 0, `${name}: the probe never saw a placement decision`);
  }
});
