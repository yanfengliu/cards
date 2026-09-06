// The keystone invariant, as a property test:
//
//   Given a seed and an ordered list of player actions, a match replays to a
//   byte-identical final state.
//
// Two things have to hold, and only the pair is meaningful. The hash must be
// stable across runs, and it must actually vary with the seed - a constant
// hash would pass a determinism test while measuring nothing.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { fightToCanonical, hashFight, hashString } from '../src/engine/hash.ts';
import { replayFight, runFight } from '../src/engine/fight.ts';
import { lookaheadPlacer, randomPlacer } from '../src/sim/bots.ts';
import { setupFor } from '../src/sim/measure.ts';
import { makeRng, nextU32 } from '../src/engine/rng.ts';

const SEEDS = Array.from({ length: 60 }, (_, i) => i + 1);

test('same seed and same bot produce an identical final state hash, over many trials', () => {
  for (const seed of SEEDS) {
    const first = runFight(setupFor(seed), randomPlacer(seed, 'placement-a'));
    const h = hashFight(first.fight);
    for (let trial = 0; trial < 3; trial++) {
      const again = runFight(setupFor(seed), randomPlacer(seed, 'placement-a'));
      assert.equal(hashFight(again.fight), h, `seed ${seed} diverged on trial ${trial}`);
      assert.equal(fightToCanonical(again.fight), fightToCanonical(first.fight));
    }
  }
});

test('seed plus action list replays to the same final state, with no bot in the loop', () => {
  for (const seed of SEEDS) {
    const live = runFight(setupFor(seed), randomPlacer(seed, 'placement-a'));
    const replayed = replayFight(setupFor(seed), live.log);
    assert.equal(hashFight(replayed), hashFight(live.fight), `seed ${seed} did not replay`);
    assert.equal(replayed.result, live.fight.result);
    assert.equal(replayed.round, live.fight.round);
  }
});

test('the searching bot is deterministic too: its rollouts consume no fight randomness', () => {
  for (const seed of SEEDS.slice(0, 20)) {
    const a = runFight(setupFor(seed), lookaheadPlacer());
    const b = runFight(setupFor(seed), lookaheadPlacer());
    assert.equal(hashFight(b.fight), hashFight(a.fight));
    assert.deepEqual(
      b.log.map((r) => r.placements),
      a.log.map((r) => r.placements),
    );
    const replayed = replayFight(setupFor(seed), a.log);
    assert.equal(hashFight(replayed), hashFight(a.fight));
  }
});

test('the hash is not degenerate: different seeds give different final states', () => {
  const hashes = new Set<string>();
  for (const seed of SEEDS) {
    hashes.add(hashFight(runFight(setupFor(seed), randomPlacer(seed, 'placement-a')).fight));
  }
  assert.ok(
    hashes.size > SEEDS.length * 0.8,
    `expected mostly distinct hashes across ${SEEDS.length} seeds, got ${hashes.size}`,
  );
});

test('the hash notices a one-field change', () => {
  const run = runFight(setupFor(1), randomPlacer(1, 'placement-a'));
  const before = hashFight(run.fight);
  run.fight.state.board.player[run.fight.state.board.player.length - 1]!.health -= 1;
  assert.notEqual(hashFight(run.fight), before);
  assert.notEqual(hashString('a'), hashString('b'));
});

test('the generator is a pure function of its state', () => {
  const a = makeRng(42, 'combat');
  const b = makeRng(42, 'combat');
  const c = makeRng(42, 'deck');
  const seqA: number[] = [];
  const seqB: number[] = [];
  const seqC: number[] = [];
  for (let i = 0; i < 500; i++) {
    seqA.push(nextU32(a));
    seqB.push(nextU32(b));
    seqC.push(nextU32(c));
  }
  assert.deepEqual(seqA, seqB);
  assert.notDeepEqual(seqA, seqC, 'named streams must be independent');
});

test('no engine or sim module reaches for a clock or an unseeded random', async () => {
  const { readFile, readdir } = await import('node:fs/promises');
  const { join } = await import('node:path');
  const banned = /\b(Math\.random|Date\.now|performance\.now)\b/;
  const roots = ['src/engine', 'src/content', 'src/sim'];
  const offenders: string[] = [];
  for (const root of roots) {
    for (const name of await readdir(root)) {
      if (!name.endsWith('.ts')) continue;
      const path = join(root, name);
      const text = await readFile(path, 'utf8');
      for (const [i, line] of text.split('\n').entries()) {
        // The ban is on calling them; naming them in a comment is the point.
        if (banned.test(line) && !line.trimStart().startsWith('//') && !line.trimStart().startsWith('*')) {
          offenders.push(`${path}:${i + 1}: ${line.trim()}`);
        }
      }
    }
  }
  assert.deepEqual(offenders, []);
});
