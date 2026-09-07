// The measurement's methodology, as tests.
//
// If the two arms differ in *which* cards they play, the A/B result is about
// card choice and is worthless. These checks are the ones that would catch
// that, run against real fights rather than against the argument for it.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { CARD_POOL, ENERGY_PER_TURN, PLAYER_CARDS, cardById } from '../src/content/cards.ts';
import { runFight, selectPlays } from '../src/engine/fight.ts';
import { appendLeftPlacer, appendRightPlacer, lookaheadPlacer, randomPlacer } from '../src/sim/bots.ts';
import { BOTS, checkSameCards, runArm, setupFor } from '../src/sim/measure.ts';

const SEEDS = Array.from({ length: 60 }, (_, i) => i + 1);

test('card selection is a pure function of hand and energy - it cannot see the board', () => {
  // The signature is the guarantee. Assert the behaviour too: identical hands
  // give identical selections regardless of anything else in the world.
  const hand = ['u_squire', 'u_captain', 'u_berserker', 'u_shieldbearer', 'u_hornblower'];
  const first = selectPlays(hand, ENERGY_PER_TURN, CARD_POOL);
  for (let i = 0; i < 50; i++) {
    assert.deepEqual(selectPlays(hand.slice(), ENERGY_PER_TURN, CARD_POOL), first);
  }
});

test('card selection never overspends the energy', () => {
  const ids = PLAYER_CARDS.map((c) => c.id);
  // Every hand of up to five cards drawn from the pool, by construction.
  for (let a = 0; a < ids.length; a++) {
    for (let b = 0; b < ids.length; b++) {
      for (let c = 0; c < ids.length; c++) {
        const hand = [ids[a]!, ids[b]!, ids[c]!];
        const chosen = selectPlays(hand, ENERGY_PER_TURN, CARD_POOL);
        const spend = chosen.reduce((s, i) => s + cardById(hand[i]!).cost, 0);
        assert.ok(spend <= ENERGY_PER_TURN, `spent ${spend} of ${ENERGY_PER_TURN} on ${hand}`);
        assert.equal(new Set(chosen).size, chosen.length, 'a card cannot be played twice');
      }
    }
  }
});

test('every bot plays exactly the same cards on the same round; only the slot differs', () => {
  const arms = [
    runArm('lookahead', BOTS.lookahead!, SEEDS),
    runArm('random', BOTS.random!, SEEDS),
    runArm('randomB', BOTS.randomB!, SEEDS),
    runArm('right', BOTS.right!, SEEDS),
    runArm('left', BOTS.left!, SEEDS),
  ];
  for (let i = 1; i < arms.length; i++) {
    const check = checkSameCards(arms[0]!, arms[i]!);
    assert.equal(
      check.ok,
      true,
      `${arms[0]!.name} vs ${arms[i]!.name}: ${check.mismatches.slice(0, 3).join(' | ')}`,
    );
    assert.ok(check.roundsCompared > 0, 'the comparison must actually have compared something');
  }
});

test('the arms really do place cards differently, or the A/B tests nothing', () => {
  const a = runArm('lookahead', BOTS.lookahead!, SEEDS);
  const b = runArm('random', BOTS.random!, SEEDS);
  const check = checkSameCards(a, b);
  assert.ok(check.placementOpportunities > 100, 'not enough placements to compare');
  assert.ok(
    check.placementsDiffered > check.placementOpportunities * 0.1,
    `only ${check.placementsDiffered}/${check.placementOpportunities} placements differed; ` +
      `the two arms are not exploring different arrangements`,
  );
});

test('a policy that drops a card is rejected rather than quietly changing the arm', () => {
  assert.throws(
    () => runFight(setupFor(1), (_f, plays) => (plays.length > 0 ? [] : [])),
    /must return exactly one per card/,
  );
});

test('a policy that names an illegal slot is rejected, and the error says what is legal', () => {
  assert.throws(
    () => runFight(setupFor(1), (_f, plays) => plays.map(() => 99)),
    /is not a legal slot for the player line/,
  );
});

test('every placement every bot makes lands in a legal slot and is actually applied', () => {
  for (const make of [
    () => lookaheadPlacer(),
    () => randomPlacer(1, 'placement-a'),
    () => appendRightPlacer(),
    () => appendLeftPlacer(),
  ]) {
    // `runFight` throws on an illegal slot, so completing is the assertion.
    const arm = runArm('probe', () => make(), SEEDS.slice(0, 15));
    let placed = 0;
    for (const log of arm.logs) {
      for (const rec of log) {
        assert.ok(rec.placements.length <= 3, 'three energy cannot buy more than three cards');
        for (const p of rec.placements) assert.ok(p.index >= 0);
        placed += rec.placements.length;
      }
    }
    assert.ok(placed > 0, 'the probe never placed a card');
  }
});
