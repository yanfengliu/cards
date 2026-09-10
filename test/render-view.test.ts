// The board on screen is derived from the event stream, and it lands where the
// engine did.
//
// `ARCHITECTURE.md` forbids the shortcut this gate protects: render consumes
// the resolver's events and derives its own view state, and never adds a field
// to `GameState`. That means the view is a *second* implementation of what a
// turn does to the board - one that reads events rather than applying effects -
// and a second implementation drifts unless something compares the two.
//
// So this replays real fights, applies every beat to a view, and requires the
// view to agree with the engine's own state at the end of every phase. It also
// pins the buff attribution, which is the one thing the animation needs that
// the event stream does not carry outright: a Relay `+2` that does not visibly
// leave the card that granted it teaches the player nothing.
//
// Bound of this gate - what a green run does and does not prove:
//
//   Walks 80 seeds at `even` and 40 at `hard`, every round of every fight,
//   comparing health, bonus Power and alive for every entity the engine
//   still has. Corpses are not compared: they leave the engine's board at the
//   state-based checkpoint and stay in the view so they can be seen dying.
//   Covers the three shipped traits, because the shipped decks contain them. It
//   says nothing about a trait that does not exist yet, and the attribution
//   assertion is exactly as strong as the trait set it ran against - a future
//   power source that is neither Relay nor Wake would come back `unknown` and
//   this gate would say so rather than mis-draw an arrow.
//   Says nothing about pixels, timing, or the DOM.
//
//   The odds tests carry their own bounds and are stated at each. What all of
//   them share: every fight walked here was a KNIGHT's until classes landed, so
//   `swingsOf` was only ever asked about entities that return 1 and no Scorch
//   ever stood on the attacking line. "the odds corpus is walked as each of the
//   three classes" is what fixes that, and it asserts that both were seen
//   rather than assuming it.
//
// Made to go red: deleting the `bonusPower` line from `applyBeat`'s `buff`
// case fails on seed 1 with "uid 5 bonusPower: view 0, engine 2"; dropping the
// Relay branch of `attributeBuff` fails the attribution test with a buff whose
// source is `unknown`. See `docs/learning/gate-proofs.md`.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  type Fight,
  type FightSetup,
  type Placement,
  selectPlays,
  setupFight,
} from '../src/engine/fight.ts';
import {
  type CardPool,
  type Entity,
  type GameState,
  type HeroSpec,
  type Side,
  type Trait,
  type UnitCard,
  cloneState,
  heroOf,
  insertUnit,
  makeHero,
  makeUnit,
  unitCount,
} from '../src/engine/state.ts';
import { SCORCH_DAMAGE, VOLLEY_SWINGS, resolvePhase } from '../src/engine/resolver.ts';
import { classById } from '../src/content/classes.ts';
import { makeRng, mixSeeds, nextInt } from '../src/engine/rng.ts';
import {
  CARD_POOL,
  ENEMY_DECK,
  MAX_ROUNDS,
  PLAYER_DECK,
  PLAYER_HERO,
  encounterById,
} from '../src/content/cards.ts';
import { beginRound, commitRound } from '../src/ui/session.ts';
import {
  type Beat,
  type BoardView,
  applyBeat,
  buildBeats,
  snapshot,
  viewDrift,
} from '../src/render/view.ts';
import { fitWidth, CARD_GAP, MIN_CARD_W, MAX_CARD_W } from '../src/render/board.ts';
import { burnTotal, incomingOdds, projectOwnPhase } from '../src/render/odds.ts';
import { blazonFor } from '../src/render/blazons.ts';
import { parseBlazon, blazonWarnings } from '../src/render/heraldry/blazon.ts';

function setup(seed: number, encounterId: string, playerHero: HeroSpec = PLAYER_HERO): FightSetup {
  const encounter = encounterById(encounterId);
  return {
    seed,
    pool: CARD_POOL,
    playerDeck: PLAYER_DECK,
    enemyDeck: ENEMY_DECK,
    enemyOpening: encounter.opening,
    playerHero,
    enemyHero: encounter.enemyHero,
    maxRounds: MAX_ROUNDS,
  };
}

/** A human-ish turn: play everything affordable, scattered across the line. */
function decide(f: Fight): Placement[] {
  const chosen = selectPlays(f.player.hand, f.pool.energyPerTurn, f.pool).map(
    (i) => f.player.hand[i]!,
  );
  const rng = makeRng(mixSeeds(f.seed, f.round), 'view-gate');
  let units = unitCount(f.state, 'player');
  return chosen.map((cardId) => {
    const index = nextInt(rng, units + 1);
    units++;
    return { cardId, index };
  });
}

type Walk = { rounds: number; beats: number; buffs: number; attributed: number; deaths: number };

function walkFight(seed: number, encounter: string, acc: Walk): void {
  const f = setupFight(setup(seed, encounter));
  while (beginRound(f)) {
    const committed = commitRound(f, decide(f));
    acc.rounds++;

    let view = snapshot(committed.stateAtStart, CARD_POOL);
    let from: GameState = committed.stateAtStart;

    for (const segment of committed.segments) {
      if (segment.kind === 'spawns') {
        view = snapshot(segment.stateAfter, CARD_POOL);
        from = segment.stateAfter;
        continue;
      }
      const beats = buildBeats(snapshot(from, CARD_POOL), segment.events);
      for (const beat of beats) {
        applyBeat(view, beat);
        acc.beats++;
        if (beat.kind === 'death') acc.deaths++;
        if (beat.kind === 'buff') {
          acc.buffs++;
          if (beat.source.via !== 'unknown') acc.attributed++;
          assert.notEqual(
            beat.source.via,
            'unknown',
            `seed ${seed}/${encounter} round ${f.round}: a +${beat.amount} buff on uid ` +
              `${beat.uid} could not be attributed to the card that granted it, so the ` +
              `animation would have nothing to draw an arrow from`,
          );
          assert.notEqual(beat.source.sourceUid, null);
          assert.notEqual(beat.source.sourceUid, beat.uid, 'a buff cannot come from its own target');
        }
      }
      const drift = viewDrift(view, segment.stateAfter);
      assert.deepEqual(
        drift,
        [],
        `seed ${seed}/${encounter} round ${f.round}: the view derived from the ${segment.side} ` +
          `phase's events disagrees with the engine's state`,
      );
      view = snapshot(segment.stateAfter, CARD_POOL);
      from = segment.stateAfter;
    }
    if (committed.result !== 'ongoing') break;
  }
}

test('the view derived from the event stream matches the engine, every phase', () => {
  const acc: Walk = { rounds: 0, beats: 0, buffs: 0, attributed: 0, deaths: 0 };
  for (let seed = 1; seed <= 80; seed++) walkFight(seed, 'even', acc);
  for (let seed = 1; seed <= 40; seed++) walkFight(seed, 'hard', acc);

  // The instrument, before the measurement: a walk that saw no buffs and no
  // deaths would pass every assertion above without exercising either.
  assert.ok(acc.rounds > 300, `expected a real corpus, walked ${acc.rounds} rounds`);
  assert.ok(acc.beats > 3000, `expected a real corpus, applied ${acc.beats} beats`);
  assert.ok(acc.buffs > 100, `expected Relay and Wake to fire, saw ${acc.buffs} buffs`);
  assert.ok(acc.deaths > 100, `expected units to die, saw ${acc.deaths} deaths`);
  assert.equal(acc.attributed, acc.buffs);
});

test('target odds are exactly the engine’s uniform pick', () => {
  // The fairness claim on screen is "each attack is 1/N onto each of N
  // targets", and it has to be the same N the resolver picks from.
  for (let seed = 1; seed <= 40; seed++) {
    const f = setupFight(setup(seed, 'hard'));
    let guarded = 0;
    while (beginRound(f)) {
      for (const side of ['player', 'enemy'] as const) {
        const odds = incomingOdds(f.state, side);
        const total = [...odds.chance.values()].reduce((a, b) => a + b, 0);
        if (odds.poolSize > 0) {
          assert.ok(
            Math.abs(total - 1) < 1e-9,
            `seed ${seed}: the shown chances sum to ${total}, not 1`,
          );
          for (const p of odds.chance.values()) {
            assert.ok(Math.abs(p - 1 / odds.poolSize) < 1e-9, 'targets are not uniform');
          }
        }
        if (odds.guarded) guarded++;
      }
      const committed = commitRound(f, decide(f));
      if (committed.result !== 'ongoing') break;
    }
    if (seed === 1) assert.ok(guarded > 0, 'seed 1 should reach a board where Guard narrows the pool');
  }
});

// --------------------------------------------------------- the class damage

/**
 * A hand-built board, so the comparison below is exact rather than sampled.
 *
 * `pool` serves back exactly the cards `add` made, so `snapshot` can be taken
 * of one of these boards - the shipped `CARD_POOL` throws for a `test:` id, by
 * design, and that message is what says the board was built from nothing real.
 */
function board(playerHero: HeroSpec, enemyHero: HeroSpec): {
  state: GameState;
  pool: CardPool;
  add: (side: Side, id: string, power: number, health: number, armour: number, traits?: readonly Trait[]) => Entity;
} {
  const state: GameState = { board: { player: [], enemy: [] }, nextUid: 1 };
  state.board.player.push(makeHero(state, 'player', playerHero));
  state.board.enemy.push(makeHero(state, 'enemy', enemyHero));
  const made = new Map<string, UnitCard>();
  return {
    state,
    pool: {
      energyPerTurn: CARD_POOL.energyPerTurn,
      handSize: CARD_POOL.handSize,
      card(id) {
        const c = made.get(id);
        if (c === undefined) {
          throw new Error(`fixture: no card with id "${id}"; this board made [${[...made.keys()].join(', ')}]`);
        }
        return c;
      },
    },
    add(side, id, power, health, armour, traits = []) {
      const c: UnitCard = { id, name: id, cost: 1, power, health, armour, tribe: 'human', traits };
      made.set(id, c);
      const u = makeUnit(state, side, c);
      insertUnit(state, side, u, unitCount(state, side));
      return u;
    },
  };
}

test('everything the odds promise is everything the phase then deals: Volley swings and a Scorch burn', () => {
  // `ARCHITECTURE.md`: fair means the odds were visible before you committed.
  // That is a claim about the WHOLE turn, and it is the claim that broke twice
  // over when classes landed - a Volley entity's second swing was counted by
  // `swingsOf` but nothing gated it, and a Scorch was not in this file at all,
  // so a Mage facing three units read "1 of yours will swing for 1 Power" while
  // it was about to deal 1 and burn 3 more.
  //
  // So both are checked against the resolver rather than against themselves:
  // the board is built so that targeting is forced (one enemy Guard, nothing
  // dies, nothing fizzles), the phase is resolved, and the damage the enemy
  // line actually lost is compared with what the pre-commit numbers said.
  //
  // Made to go red: `attackers += 1; totalPower += power(e)` in place of the
  // two `swingsOf` lines fails the Volley half at "5 attacks promised, 3
  // counted"; deleting the `burnOn` loop fails the Mage half. See
  // `docs/learning/gate-proofs.md`.
  //
  // Bound: two hand-built boards, one seed each, with targeting forced by a
  // single Guard so no roll enters. It proves the arithmetic on the line, not
  // that it survives a unit dying mid-phase - the label on screen says "as the
  // line stands" for exactly that reason, and the shipped-corpus walk below
  // covers real boards instead.
  {
    // Volley: a Ranger hero, a Volley body and a plain body, all swinging into
    // one Guard that cannot kill anything back.
    const f = board(
      { name: 'Ranger', health: 30, power: 1, armour: 0, traits: ['volley'] },
      { name: 'Warchief', health: 99, power: 0, armour: 0 },
    );
    f.add('player', 'test:archer', 2, 20, 0, ['volley']);
    f.add('player', 'test:grunt', 3, 20, 0);
    const wall = f.add('enemy', 'test:wall', 0, 99, 0, ['guard']);

    const odds = incomingOdds(f.state, 'player');
    assert.equal(odds.attackers, 2 * VOLLEY_SWINGS + 1, 'two Volley entities and one plain body');
    assert.equal(odds.totalPower, (1 + 2) * VOLLEY_SWINGS + 3);
    assert.equal(odds.scorchers, 0);
    assert.equal(burnTotal(odds), 0, 'no Scorch on this line, so no burn is promised');

    const before = wall.health;
    const events = resolvePhase(f.state, 'player', makeRng(1, 'combat'));
    const swings = events.filter((e) => e.kind === 'attacked');
    assert.equal(
      swings.length,
      odds.attackers,
      `the line promised ${odds.attackers} attacks and threw ${swings.length}`,
    );
    assert.equal(
      before - wall.health,
      odds.totalPower,
      `the line promised ${odds.totalPower} Power and dealt ${before - wall.health}`,
    );
  }
  {
    // Scorch: a Mage hero and a second scorcher, so the per-target burn is a
    // multiple and not just `SCORCH_DAMAGE`. One target carries Armour, which
    // is the case a flat total would get wrong.
    const f = board(
      { name: 'Mage', health: 30, power: 1, armour: 0, traits: ['scorch'] },
      { name: 'Warchief', health: 99, power: 0, armour: 0 },
    );
    f.add('player', 'test:ember', 0, 20, 0, ['scorch']);
    const wall = f.add('enemy', 'test:wall', 0, 99, 0, ['guard']);
    const soft = f.add('enemy', 'test:soft', 0, 99, 0);
    const plated = f.add('enemy', 'test:plated', 0, 99, SCORCH_DAMAGE);
    const enemyHero = heroOf(f.state, 'enemy');

    const odds = incomingOdds(f.state, 'player');
    assert.equal(odds.scorchers, 2);
    assert.equal(odds.burnOn.get(wall.uid), 2 * SCORCH_DAMAGE);
    assert.equal(odds.burnOn.get(soft.uid), 2 * SCORCH_DAMAGE);
    assert.equal(odds.burnOn.get(plated.uid), undefined, 'Armour stops it, so nothing is promised');
    assert.equal(odds.burnOn.get(enemyHero.uid), undefined, 'a rider never reaches a hero');
    assert.equal(burnTotal(odds), 4 * SCORCH_DAMAGE);

    const health = new Map(
      [wall, soft, plated, enemyHero].map((e) => [e.uid, e.health] as const),
    );
    const events = resolvePhase(f.state, 'player', makeRng(2, 'combat'));
    assert.equal(events.filter((e) => e.kind === 'attacked').length, odds.attackers);

    // Everything the enemy line lost, against everything the screen promised.
    let lost = 0;
    for (const e of [wall, soft, plated, enemyHero]) lost += (health.get(e.uid) ?? 0) - e.health;
    assert.equal(
      lost,
      odds.totalPower + burnTotal(odds),
      `the screen promised ${odds.totalPower} Power and ${burnTotal(odds)} burn; the line lost ${lost}`,
    );
    assert.equal(plated.health, health.get(plated.uid), 'the plated unit took nothing, as promised');
    assert.equal(enemyHero.health, health.get(enemyHero.uid), 'and the hero was never in the burn');
  }
});

test('the odds corpus is walked as each of the three classes, so Volley and Scorch are in it', () => {
  // The corpus half. Before this, every fight the odds were ever checked
  // against was a Knight's: `swingsOf` was exercised only through entities that
  // return 1, and no Scorch ever stood on the attacking line.
  //
  // Bound: 20 seeds a class at `hard`, and the exact comparison runs only on
  // player phases in which nothing of the player's died - a unit that dies to
  // retaliation mid-phase never swings, and the pre-commit number is honestly
  // an over-statement there, which is what "as the line stands" means. All
  // three populations are counted and asserted, so a version of this that skips
  // everything cannot pass.
  //
  // **The second exclusion is the sharper one, and it is counted separately for
  // that reason.** A phase that ENDS the fight is skipped too, because
  // `resolvePhase` breaks between entities the moment a hero falls and the rest
  // of the line never swings - so the pre-commit count is an over-statement
  // there by construction. That is exactly the phase the epilogue rule governs,
  // which means **this gate can say nothing about it in either direction**.
  // What covers it is "once the fight is decided the screen stops narrating
  // blows that moved nothing", below, whose whole population is decided fights.
  let checked = 0;
  let skippedForDeath = 0;
  let skippedForDecided = 0;
  let volleySeen = 0;
  let scorchSeen = 0;
  for (const cls of ['knight', 'ranger', 'mage'] as const) {
    for (let seed = 1; seed <= 20; seed++) {
      const f = setupFight(setup(seed, 'hard', classById(cls).hero));
      while (beginRound(f)) {
        const committed = commitRound(f, decide(f));
        const playerPhase = committed.segments[0]!;
        if (playerPhase.kind !== 'phase') throw new Error('fixture: first segment is the player phase');

        const projected = projectOwnPhase(committed.stateAtStart, 'player');
        const odds = incomingOdds(projected, 'player');
        if (odds.attackers > committed.stateAtStart.board.player.filter((e) => e.alive).length) {
          volleySeen++;
        }
        if (odds.scorchers > 0) scorchSeen++;

        const died = playerPhase.events.some((e) => e.kind === 'died' && e.side === 'player');
        if (committed.result !== 'ongoing') {
          skippedForDecided++;
        } else if (died) {
          skippedForDeath++;
        } else {
          const swings = playerPhase.events.filter((e) => e.kind === 'attacked');
          assert.equal(
            swings.length,
            odds.attackers,
            `${cls} seed ${seed} round ${f.round}: the screen promised ${odds.attackers} attacks ` +
              `and the phase threw ${swings.length}`,
          );
          let raw = 0;
          for (const e of swings) if (e.kind === 'attacked') raw += e.raw;
          assert.equal(
            raw,
            odds.totalPower,
            `${cls} seed ${seed} round ${f.round}: the screen promised ${odds.totalPower} Power ` +
              `and the phase swung for ${raw}`,
          );
          checked++;
        }
        if (committed.result !== 'ongoing') break;
      }
    }
  }
  assert.ok(checked > 50, `expected a real corpus, compared ${checked} phases`);
  assert.ok(skippedForDeath > 0, 'no phase lost a unit, so that exclusion is hiding nothing');
  assert.ok(
    skippedForDecided > 0,
    'no phase in this corpus ended a fight, so the exclusion this gate is blind to never ran ' +
      'and the note above about the epilogue rule is describing nothing',
  );
  assert.ok(volleySeen > 0, 'no phase in the corpus held a Volley entity, so swingsOf was never exercised');
  assert.ok(scorchSeen > 0, 'no phase in the corpus held a Scorch entity, so the burn was never exercised');
});

test('once the fight is decided the screen stops narrating blows that moved nothing', () => {
  // The epilogue rule, stated at `buildBeats` in `src/render/view.ts`.
  //
  // An act that ended the fight still finishes - `resolvePhase` breaks between
  // entities, never inside one - so the rest of that act resolves against a
  // board whose hero is dead. The engine is right to report it: it announces
  // every effect that REACHED a target, and a Scorch stopped by an Orc
  // Shieldwall's Armour reached the Shieldwall. What the player read was
  // "Warchief dies." and then "scorches Orc Shieldwall for 0", which is a line
  // about a fight that was already over describing nothing. Deciding that is
  // this layer's job, and this is where it is held.
  //
  // Three arms, and the middle one is what stops the rule being satisfied by a
  // view that drops every zero-dealt beat:
  //
  //   1. after the fight-ending death, no beat that moved no Health survives
  //   2. BEFORE it, a zero-dealt blow is still drawn - a burn Armour ate is
  //      what a Mage's player has to see, and it is drawn at 0
  //   3. a trade is one blow: a retaliation never appears without its swing
  //
  // Bound: 120 seeds a class at `even` and 60 at `trivial`, driven through
  // `src/ui/session.ts`'s `beginRound`/`commitRound` and `buildBeats` - the
  // pipeline `src/ui/app.ts` itself runs, from the same per-segment source
  // state. Every population is counted and asserted non-empty, separately per
  // event kind, so a run that reached none of them cannot report green. It says
  // nothing about pixels or timing, and nothing about a class that does not
  // exist yet: the two tails it covers are the Ranger's second swing and the
  // Mage's rider, and a third would have to be added here.
  let decidedFights = 0;
  let tailZeroAttacks = 0;
  let tailZeroBurns = 0;
  let liveZeroBlows = 0;
  let trades = 0;

  for (const cls of ['knight', 'ranger', 'mage'] as const) {
    for (const [encounter, seeds] of [['even', 120], ['trivial', 60]] as const) {
      for (let seed = 1; seed <= seeds; seed++) {
        const f = setupFight(setup(seed, encounter, classById(cls).hero));
        const heroUids = new Set(
          (['player', 'enemy'] as const).map((s) => heroOf(f.state, s).uid),
        );
        while (beginRound(f)) {
          const committed = commitRound(f, decide(f));
          let decided = false;

          for (let i = 0; i < committed.segments.length; i++) {
            const segment = committed.segments[i]!;
            if (segment.kind !== 'phase') continue;
            const source = i === 0 ? committed.stateAtStart : committed.segments[i - 1]!.stateAfter;
            const beats = buildBeats(snapshot(source, CARD_POOL), segment.events);
            const where = `${cls} seed ${seed}/${encounter} round ${f.round} ${segment.side} phase`;

            // Arm 3, read off the beats the screen will actually play.
            for (let b = 0; b < beats.length; b++) {
              const beat = beats[b]!;
              if (beat.kind !== 'retaliate') continue;
              const before = beats[b - 1];
              assert.equal(
                before?.kind,
                'attack',
                `${where}: a retaliation is drawn with no swing above it, so the log reads ` +
                  `"hits back" with nothing to hit back at`,
              );
              trades++;
            }

            // Arms 1 and 2, read off the engine's own stream: every blow that
            // moved no Health, and whether its beat survived.
            const shown = new Set(beats.map((x) => `${x.kind}:${x.uid}:${'targetUid' in x ? x.targetUid : ''}:${'dealt' in x ? x.dealt : ''}`));
            let dead = decided;
            for (const ev of segment.events) {
              const zero =
                (ev.kind === 'attacked' || ev.kind === 'damaged' || ev.kind === 'retaliated') &&
                ev.dealt === 0;
              if (zero && ev.kind !== 'retaliated') {
                const kind = ev.kind === 'attacked' ? 'attack' : 'spell';
                const key = `${kind}:${ev.uid}:${ev.targetUid}:0`;
                if (dead) {
                  assert.equal(
                    shown.has(key),
                    false,
                    `${where}: the fight was already decided and the screen still narrates a ` +
                      `${kind} on uid ${ev.targetUid} that moved no Health`,
                  );
                  if (ev.kind === 'attacked') tailZeroAttacks++;
                  else tailZeroBurns++;
                } else {
                  assert.equal(
                    shown.has(key),
                    true,
                    `${where}: a ${kind} that Armour ate was dropped while the fight was still ` +
                      `live - that is the blow a player needs to see, drawn at 0`,
                  );
                  liveZeroBlows++;
                }
              }
              if (ev.kind === 'died' && heroUids.has(ev.uid)) dead = true;
            }
            if (dead) decided = true;
          }
          if (decided) decidedFights++;
          if (committed.result !== 'ongoing') break;
        }
      }
    }
  }

  assert.ok(decidedFights > 100, `expected a real corpus of decided fights, walked ${decidedFights}`);
  assert.ok(
    tailZeroAttacks > 0,
    'no swing after a fight-ending death moved nothing, so the Ranger tail this rule was ' +
      'written for was never reached and arm 1 did not run for attacks',
  );
  assert.ok(
    tailZeroBurns > 0,
    'no burn after a fight-ending death moved nothing, so the Mage tail this rule was ' +
      'written for was never reached and arm 1 did not run for spell damage',
  );
  assert.ok(
    liveZeroBlows > 0,
    'no blow was stopped by Armour while a fight was still live, so arm 2 - the half that ' +
      'stops this being satisfied by dropping every zero-dealt beat - did not run',
  );
  assert.ok(trades > 0, 'no retaliation was drawn at all, so arm 3 did not run');
});

test('a trade after the fight is decided is drawn whole or not at all', () => {
  // Arm 3's own fixture, because the shipped corpus does not reach it: the
  // 4500 fights the probe walked produced no swing-after-the-death that drew a
  // retaliation, so the pairing in `buildBeats` would otherwise be an unproven
  // claim. A Volley UNIT is what reaches it - a hero takes nothing back.
  //
  // The board: the enemy hero is a Guard, so the first swing is forced onto it
  // and kills it; at the second swing the hero is dead and `legalTargets` falls
  // back to the living units, so targeting is forced both times and no roll
  // enters. The plated body carries enough Armour to eat the swing whole.
  //
  // Bound: two hand-built boards, one seed each. It pins the pairing, not the
  // frequency; the corpus walk above is the frequency half.
  for (const backPower of [3, 0]) {
    const f = board(
      { name: 'Knight', health: 30, power: 0, armour: 0 },
      { name: 'Warchief', health: 1, power: 0, armour: 0, traits: ['guard'] },
    );
    const archer = f.add('player', 'test:archer', 1, 20, 0, ['volley']);
    const plated = f.add('enemy', 'test:plated', backPower, 20, 5);
    const enemyHero = heroOf(f.state, 'enemy');

    const from = cloneState(f.state);
    const events = resolvePhase(f.state, 'player', makeRng(3, 'combat'));
    assert.equal(enemyHero.alive, false, 'the first swing was forced onto the Guard hero and killed it');
    assert.deepEqual(
      events.map((e) => e.kind),
      ['acted', 'attacked', 'retaliated', 'died', 'attacked', 'retaliated', 'afterActed'],
      'the act finished: the second swing reached the plated body and drew its answer',
    );
    const second = events.filter((e) => e.kind === 'attacked')[1]!;
    assert.equal(second.kind === 'attacked' && second.dealt, 0, 'Armour 5 ate the whole point');

    const beats = buildBeats(snapshot(from, f.pool), events);
    const after = beats.slice(beats.findIndex((b) => b.kind === 'death') + 1);
    if (backPower > 0) {
      assert.deepEqual(
        after.map((b) => b.kind),
        ['attack', 'retaliate'],
        'the trade moved Health, so the whole trade is drawn - the 0 included',
      );
      assert.equal(plated.health, 20, 'and the swing really did move nothing on the plated body');
      assert.ok(archer.health < 20, 'while the answer really did move something on the archer');
    } else {
      assert.deepEqual(
        after.map((b) => b.kind),
        [],
        'nothing in the trade moved Health, so neither half is drawn',
      );
    }
    assert.deepEqual(
      viewDrift(applyAll(snapshot(from, f.pool), beats), f.state),
      [],
      'and a suppressed beat moved no Health, so the view still lands where the engine did',
    );
  }
});

/** Every beat applied to one view, so a suppression can be checked for drift. */
function applyAll(view: BoardView, beats: readonly Beat[]): BoardView {
  for (const b of beats) applyBeat(view, b);
  return view;
}

test('the Relays shown before commit are the ones that land, on a phase nothing died in', () => {
  // The odds and the pips on screen are computed against a *projection* of the
  // player's own phase: `projectOwnPhase` walks the line left to right and adds
  // the +2 each Relay will hand its right-hand neighbour. The projection has to
  // be exactly right or it has replaced one wrong number with another.
  //
  // Made to go red: dropping the `right.bonusPower += RELAY` line drops every
  // predicted buff and the first fight that plays a Squire fails.
  //
  // **The bound moved when combat became mutual, and this is the honest form of
  // it.** A unit can now die during its own side's phase, to the retaliation its
  // own attack drew, and that breaks the exactness argument in two directions: a
  // Relay unit that dies mid-swing never reaches `afterAct`, so its +2 never
  // lands, and a Wake unit answering that death gains +2 the projection does not
  // model at all. So the exact comparison runs only over phases in which nothing
  // of the player's died - and both counts are asserted, so a version of this
  // test that skips everything cannot pass.
  let phases = 0;
  let skippedForDeaths = 0;
  let relayedSeen = 0;
  for (let seed = 1; seed <= 60; seed++) {
    const f = setupFight(setup(seed, 'even'));
    while (beginRound(f)) {
      const placements = decide(f);
      const committed = commitRound(f, placements);
      const playerPhase = committed.segments[0]!;
      if (playerPhase.kind !== 'phase') throw new Error('fixture: first segment is the player phase');

      // The one case the projection deliberately does not model: `resolvePhase`
      // stops the moment a hero dies, so units to the right of the killing blow
      // never act and never grant their Relay. The projection is for deciding
      // what the enemy will do to you next turn, and there is no next turn in a
      // round that ends the fight.
      if (committed.result !== 'ongoing') break;

      if (playerPhase.events.some((e) => e.kind === 'died' && e.side === 'player')) {
        skippedForDeaths++;
        continue;
      }

      const predicted = projectOwnPhase(committed.stateAtStart, 'player');
      const predictedPower = new Map(
        predicted.board.player.map((e) => [e.uid, e.bonusPower] as const),
      );
      for (const e of playerPhase.stateAfter.board.player) {
        assert.equal(
          predictedPower.get(e.uid) ?? 0,
          e.bonusPower,
          `seed ${seed} round ${f.round}: uid ${e.uid} was shown ` +
            `${predictedPower.get(e.uid) ?? 0} bonus Power before commit and ended on ` +
            `${e.bonusPower}`,
        );
        if (e.bonusPower > 0) relayedSeen++;
      }
      phases++;
    }
  }
  assert.ok(phases > 100, `expected a real corpus, checked ${phases} phases`);
  assert.ok(relayedSeen > 40, `expected Relay to actually fire, saw ${relayedSeen} buffed units`);
  assert.ok(
    skippedForDeaths > 0,
    'expected some phase to lose a unit to retaliation; if none did, mutual damage is not ' +
      'reaching the player line and the exclusion above is hiding nothing',
  );
});

test('the board compresses and never needs a second row', () => {
  // The layout rule ARCHITECTURE.md calls unplayable to break. `fitWidth` must
  // fit the row whenever it returns a width above the legibility floor, and
  // must bottom out at the floor rather than shrinking to nothing.
  const available = 1300;
  let hitFloor = false;
  for (let n = 1; n <= 40; n++) {
    const w = fitWidth(available, n);
    assert.ok(w >= MIN_CARD_W, `width ${w} at ${n} cards is below the reviewed floor`);
    assert.ok(w <= MAX_CARD_W, `width ${w} at ${n} cards is above the cap`);
    const used = n * w + (n - 1) * CARD_GAP;
    if (w > MIN_CARD_W) {
      assert.ok(
        used <= available,
        `${n} cards at ${w}px need ${used}px of ${available}px: the row would wrap or scroll ` +
          `while cards could still have shrunk`,
      );
    } else {
      hitFloor = true;
    }
  }
  assert.ok(hitFloor, 'the sweep never reached the floor, so the floor was not exercised');
  assert.equal(fitWidth(available, 0), MAX_CARD_W);
});

test('every shipped card has a blazon that parses and respects the rule of tincture', () => {
  const ids = [...PLAYER_DECK, ...ENEMY_DECK];
  assert.ok(ids.length > 0);
  const seen = new Set<string>();
  for (const id of ids) {
    if (seen.has(id)) continue;
    seen.add(id);
    const card = CARD_POOL.card(id);
    const guard = card.traits.includes('guard');
    const blazon = blazonFor(card.id, card.tribe, guard);
    const parsed = parseBlazon(blazon);
    assert.equal(
      parsed.bordure !== undefined,
      guard,
      `${card.id}: the bordure is the Guard channel, so it must be present exactly when Guard is`,
    );
    assert.deepEqual(
      blazonWarnings(parsed),
      [],
      `${card.id}: ${blazon} breaks the rule of tincture, which is what keeps a device legible ` +
        `at seventy pixels`,
    );
  }
  assert.ok(seen.size >= 14, `expected the whole pool, saw ${seen.size} cards`);
  // An id the pool has never seen still renders, because the card pool is
  // growing under this file.
  const unknown = blazonFor('u_not_a_real_card', 'human', false);
  assert.doesNotThrow(() => parseBlazon(unknown));
  assert.equal(blazonFor('u_squire_nc', 'human', false), blazonFor('u_squire', 'human', false));
});
