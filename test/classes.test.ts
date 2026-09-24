// Classes: the three the player picks from, and what picking one does.
//
// `docs/design/game.md`, all three marked [owner]:
//
//   "The player picks a class - Knight, Mage, Ranger - which sets the starting
//    deck and the card pool."
//   "Class sets the pool; races appear across all of it. A Knight drafts
//    dwarves, elves and humans alike."
//   "Health, plus a small class-flavoured attack. The Knight swings for 2, the
//    Ranger for 1 twice, the Mage for 1 with a rider."
//
// The engine's half - what Volley and Scorch do - is `test/hero-attacks.test.ts`.
// This file gates the content and the run: that the three classes are those
// three things and nothing else, that a run started as a class is that class
// from its first node to its hash, that the class is in the log and comes back
// out of it, and that a log written before classes existed still replays as
// the Knight it was.
//
// Bound of this file - what a green run does and does not prove:
//
//   The shipped content, deliberately. A class is content, so a fixture would
//   prove nothing about the classes a player can pick; what that costs is that
//   a content change - a card leaving a pool - can turn a test here red, and
//   the test's message says which rule it broke.
//   The run tests walk a seed window, 1..6 per class, with the greedy router
//   and append-right placement. A property that fails one seed in ten thousand
//   is not covered here; `npm run verify:run` covers 200 seeds of the Knight.
//   The unlock-ladder replay adds the random router and every rung
//   `unlockLadder` reads off the deeds, and it is the only gate that replays
//   a Ranger or a Mage at a partly unlocked profile or holds every fight they
//   play, elites and bosses included, to their ledgers; the tribal-coverage
//   test reads every combination of deeds.
//   Each of those asserts its own population, so a window that exercised
//   nothing fails rather than passes.
//   The race gate is bound to the three player races in `PLAYER_CARDS` today,
//   read from the cards rather than listed here, so a fourth race added to the
//   pool is asked of every class the day it lands.
//   The class-pick screen is checked as HTML - three buttons, each naming its
//   class - not as pixels. What it looks like is the probe's business.
//   Nothing here is a claim about balance. Whether a class wins is
//   `npm run measure:run -- --class <id>`'s to report, and per
//   `docs/policies/local-rules.md` that number is information, not a target.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { CARD_POOL, PLAYER_CARDS, PLAYER_HERO } from '../src/content/cards.ts';
import { CLASSES, CLASS_IDS, classById } from '../src/content/classes.ts';
import { ACHIEVEMENTS, FRESH_UNLOCKS, unlocksFor } from '../src/content/unlocks.ts';
import type { Fight } from '../src/engine/fight.ts';
import { swingsOf } from '../src/engine/resolver.ts';
import { TRIBAL_TRAITS, heroOf, makeHero } from '../src/engine/state.ts';
import type { CardPool, GameState, Trait, Tribe, UnitCard } from '../src/engine/state.ts';
import { CLASS_TERMS, classTermFor } from '../src/render/class-terms.ts';
import { TRAIT_TERMS } from '../src/render/glossary.ts';
import { RUN_CONTENT } from '../src/run/content.ts';
import { hashMaps, hashPlayed, hashRun, runToCanonical } from '../src/run/hash.ts';
import { fightSeedFor } from '../src/run/nodes.ts';
import {
  DEFAULT_CLASS_ID,
  type RunAgent,
  classOf,
  contentForClass,
  defaultClassId,
  migrateRunLog,
  replayRun,
  runRun,
  startRun,
  travelOptions,
} from '../src/run/run.ts';
import { fightSigilProblems, sigilProblems, watchFights } from '../src/run/sigils.ts';
import { type RunContent, type RunLog, type UnlockSet, RUN_LOG_FORMAT } from '../src/run/types.ts';
import { makeRunAgent } from '../src/sim/runbots.ts';
import { renderClassPick } from '../src/ui/classpick.ts';
import { PICKABLE_CLASSES, classPickHtml, pickableClassId } from '../src/ui/runapp.ts';
import { createRunController } from '../src/ui/run.ts';

const SEEDS = [1, 2, 3, 4, 5, 6];
const ROUTES = ['greedy', 'random'] as const;

function agentFor(seed: number) {
  return makeRunAgent({ route: 'greedy', placement: 'right', seed });
}

const playerRaces = new Set<Tribe>(PLAYER_CARDS.map((c) => c.tribe));

/**
 * The unlock sets a profile passes through, read off `ACHIEVEMENTS` in the
 * order it lists them: nothing earned, then each deed added in turn, ending
 * with everything owned. Derived rather than written out, so a deed added
 * tomorrow adds a rung the day it lands.
 */
function unlockLadder(): { readonly name: string; readonly set: UnlockSet }[] {
  const out = [{ name: 'a fresh profile', set: unlocksFor([]) }];
  for (let i = 1; i <= ACHIEVEMENTS.length; i++) {
    out.push({
      name: `${ACHIEVEMENTS[i - 1]!.name} and every deed listed before it`,
      set: unlocksFor(ACHIEVEMENTS.slice(0, i).map((a) => a.id)),
    });
  }
  return out;
}

// ------------------------------------------------------------- the content

test('the three classes are the design’s three, and each is a hero, a starting deck and a pool of known cards', () => {
  assert.deepEqual(CLASSES.map((c) => c.id), ['knight', 'ranger', 'mage']);
  assert.deepEqual([...CLASS_IDS], ['knight', 'ranger', 'mage']);
  for (const cls of CLASSES) {
    assert.equal(classById(cls.id), cls);
    assert.ok(cls.startingDeck.length > 0, `${cls.name}: a starting deck`);
    assert.ok(cls.rewards.length > 0, `${cls.name}: a pool`);
    for (const id of cls.startingDeck) assert.doesNotThrow(() => CARD_POOL.card(id), `${cls.name} starts with "${id}"`);
    for (const r of cls.rewards) {
      assert.doesNotThrow(() => CARD_POOL.card(r.cardId), `${cls.name} drafts "${r.cardId}"`);
      assert.ok(r.weight > 0, `${cls.name}: "${r.cardId}" has a positive weight`);
    }
  }
  assert.throws(() => classById('bard'), /no class "bard".*knight, ranger, mage/);
});

test('class sets the pool; races appear across all of it: every pool holds every player race, and every tribal trait', () => {
  // Mutation watched going red: the two elves removed from the Knight's pool.
  // For the second half, watched going red on its own: the Songkeeper and the
  // Elf Lord removed from the Knight's pool, which leaves the Knight holding
  // elves - the Wayfinder and the Sentinel - so the first half stays green
  // while no Knight can ever draft a Chorus.
  //
  // "A Knight drafts dwarves, elves and humans alike" is the design's own
  // example, and the first half is the general form of it, read off the cards:
  // the races a class can draft are all the races the player's cards come in.
  //
  // The second half is what unit 11 made checkable. Once a race is a rule, a
  // pool that holds a race but none of the cards that *read* it does not offer
  // that race as a direction - the design's "tribal identity is a direction you
  // commit to mid-run" fails for that class while the race count looks fine. So
  // every pool must also be able to draft every tribal trait, and the list of
  // those comes from the engine's `TRIBAL_TRAITS` rather than from this file.
  //
  // Bound: this reads the pool, not a run. It proves a class *can* be offered
  // one, not that any seed is - which is the shelf's business and
  // `test/run.test.ts`'s.
  assert.ok(playerRaces.size > 1, `the player's cards come in ${playerRaces.size} race(s); this gate needs more than one`);
  assert.ok(TRIBAL_TRAITS.length > 0, 'this gate needs at least one tribal trait to be worth running');
  for (const cls of CLASSES) {
    const cards = cls.rewards.map((r) => CARD_POOL.card(r.cardId));
    const drafted = new Set<Tribe>(cards.map((c) => c.tribe));
    for (const race of playerRaces) {
      assert.ok(
        drafted.has(race),
        `the ${cls.name}'s pool has no ${race}. Class sets the pool and races appear across all of it; ` +
          `the pool holds ${[...drafted].join(', ')} and the player's cards come in ${[...playerRaces].join(', ')}.`,
      );
    }
    const traits = new Set<Trait>(cards.flatMap((c) => c.traits));
    for (const trait of TRIBAL_TRAITS) {
      assert.ok(
        traits.has(trait),
        `the ${cls.name}'s pool holds no card printing ${trait}. Race is a rule now, so a pool ` +
          `that cannot draft the traits that read a race does not offer that race as a ` +
          `direction. The pool prints [${[...traits].join(', ')}].`,
      );
    }
  }
});

test('every class can draft every tribal trait and every player race at every unlock set a player can reach', () => {
  // The test above asks this of each class's *full* pool, and a player drafts
  // from the pool their unlock set allows. Nothing asked it there: gating both
  // Chorus cards left Chorus undraftable at a fresh profile for every class
  // with every gate green. The unlock rule gates the second card of each
  // tribal pair - the Runesmith, the Marshal, the Elf Lord - and what keeps
  // each trait draftable at a fresh profile is that the first card of each
  // pair is weighted above the rule's ceiling by some class. That is a fact
  // about today's weights, so it is held here rather than trusted.
  //
  // The sets are every combination of the shipped deeds, read off
  // `ACHIEVEMENTS` - 32 today. That is every set the deeds can produce and a
  // few they cannot (a won run without First Blood), which costs nothing:
  // owning more can only widen a pool, so a set the deeds cannot produce fails
  // here only if one they can produce fails too. The rung that binds is the
  // fresh profile, before First Blood fires and hands over the three 3-cost
  // tribal cards; the rungs after it are asked too, so the question stays
  // asked the day an unlock narrows something.
  //
  // The subject is the pool a run draws its shelves from, `startRun`'s own
  // `content.rewards`, not a filter called here.
  //
  // Mutations watched going red: `u_songkeeper` gated beside the Elf Lord on
  // First Blood (Chorus gone at every set First Blood is not in), and on the
  // won-run deed (gone at every set holding neither deed, because First
  // Blood's Elf Lord prints Chorus too). See `docs/learning/gate-proofs.md`,
  // 2026-09-23.
  //
  // Bound: the shipped pools and deeds, read at every set above. It says a
  // class *can* be offered each trait, not that any seed is.
  const deeds = ACHIEVEMENTS.map((a) => a.id);
  assert.ok(deeds.length > 0 && deeds.length <= 10, `${deeds.length} deeds; 2^n sets must stay small`);
  const sets: { readonly name: string; readonly set: UnlockSet }[] = [];
  for (let mask = 0; mask < 1 << deeds.length; mask++) {
    const earned = deeds.filter((_, i) => (mask & (1 << i)) !== 0);
    sets.push({
      name: earned.length === 0 ? 'a fresh profile' : `a profile holding ${earned.join(' + ')}`,
      set: unlocksFor(earned),
    });
  }
  assert.deepEqual(sets[0]!.set, FRESH_UNLOCKS, 'the first set asked is not a fresh profile');

  const missing: string[] = [];
  let asked = 0;
  let narrowed = 0;
  for (const { name, set } of sets) {
    for (const cls of CLASSES) {
      const pool = startRun(RUN_CONTENT, 1, cls.id, set).content.rewards.map((r) => CARD_POOL.card(r.cardId));
      if (pool.length < cls.rewards.length) narrowed++;
      const traits = new Set<Trait>(pool.flatMap((c) => c.traits));
      const races = new Set<Tribe>(pool.map((c) => c.tribe));
      for (const trait of TRIBAL_TRAITS) {
        if (!traits.has(trait)) missing.push(`the ${cls.name} at ${name} can draft no card printing ${trait}`);
      }
      for (const race of playerRaces) {
        if (!races.has(race)) missing.push(`the ${cls.name} at ${name} can draft no ${race}`);
      }
      asked++;
    }
  }
  assert.equal(asked, sets.length * CLASSES.length, 'a set or a class was skipped');
  assert.ok(narrowed > 0, 'no set narrowed any pool, so nothing above was asked of an unlock set');
  assert.deepEqual(
    missing.slice(0, 12),
    [],
    `${missing.length} (set, class) pair(s) cannot draft something every pool must offer. A tribal ` +
      `trait a class cannot draft is a race that class cannot take as a direction, and the design ` +
      `says races appear across all of the pool. Ungate a card that prints it ` +
      `(src/content/unlocks.ts), or list one that is already draftable in that class's pool ` +
      `(src/content/classes.ts).`,
  );
});

test('the three heroes are the design’s three attacks: the Knight swings for 2, the Ranger for 1 twice, the Mage for 1 with a rider', () => {
  // Mutation watched going red: the Ranger's hero given Power 2.
  const state: GameState = { board: { player: [], enemy: [] }, nextUid: 1 };
  const knight = makeHero(state, 'player', classById('knight').hero);
  const ranger = makeHero(state, 'player', classById('ranger').hero);
  const mage = makeHero(state, 'player', classById('mage').hero);

  assert.equal(knight.basePower, 2);
  assert.deepEqual(knight.traits, [], 'the Knight is the plain hero');
  assert.equal(swingsOf(knight), 1);

  assert.equal(ranger.basePower, 1);
  assert.deepEqual(ranger.traits, ['volley']);
  assert.equal(swingsOf(ranger), 2, '"for 1 twice"');

  assert.equal(mage.basePower, 1);
  assert.deepEqual(mage.traits, ['scorch'], '"for 1 with a rider"');
  assert.equal(swingsOf(mage), 1);

  for (const cls of CLASSES) {
    assert.ok(cls.hero.health > 0 && cls.hero.armour === 0, `${cls.name}: a bar and no printed Armour`);
    for (const t of cls.hero.traits ?? []) {
      assert.ok(t in TRAIT_TERMS, `${cls.name}'s ${t} is explained to the player`);
    }
  }
});

test('a class hero is named for its class, which is how the screen finds its words', () => {
  // Mutation watched going red: the Mage's hero renamed "Wizard".
  //
  // `class-terms.ts` looks a class up by the hero's name because that is what
  // a hero entity carries. A class whose hero is named anything else is a
  // hero with no crest and no class sentence on its plate.
  for (const cls of CLASSES) {
    const term = classTermFor(cls.hero.name);
    assert.ok(term !== null, `the ${cls.name}'s hero "${cls.hero.name}" has no class term`);
    assert.equal(term.id, cls.id);
    assert.equal(CLASS_TERMS[cls.id].name, cls.name);
    assert.ok(term.swing(cls.hero.power).length > 0);
    assert.ok(term.pool.length > 0);
  }
  assert.equal(classTermFor('Warchief'), null, 'an enemy hero is no class');
  assert.equal(
    classTermFor(PLAYER_HERO.name)?.id,
    'knight',
    'the single-fight page (`?encounter=`) fights as the Knight and its plate says so',
  );
  assert.deepEqual(PLAYER_HERO.traits ?? [], [], 'and that Knight is the plain hero every placement number was measured with');
});

// ------------------------------------------------------------- the run

test('startRun as a class: the hero, deck and pool are the class’s, and the log carries the class', () => {
  // Mutation watched going red: `startRun` ignoring `classId` and reading the
  // content's own fields.
  for (const cls of CLASSES) {
    const run = startRun(RUN_CONTENT, 7, cls.id);
    assert.equal(run.classId, cls.id);
    assert.equal(run.hero.health, cls.hero.health, `${cls.name}: the run's bar is the class's`);
    assert.equal(run.hero.maxHealth, cls.hero.health);
    // A claim about the run's *content*, and worded as one. It used to say
    // "fights are handed the class's hero" while comparing `run.content.hero`,
    // and a `heroSpecFor` that dropped the class's traits on the way into
    // every fight left it green. What a fight is handed is the next test's
    // claim, read off the hero the engine builds inside real fights.
    assert.equal(run.content.hero, cls.hero, `${cls.name}: the run's content carries the class's hero`);
    assert.deepEqual(run.deck.map((d) => d.cardId), [...cls.startingDeck], `${cls.name}: the starting deck`);
    assert.equal(run.content.rewards, cls.rewards, `${cls.name}: rewards draw from the class's pool`);

    const { log } = runRun(RUN_CONTENT, 7, agentFor(7), cls.id);
    assert.equal(log.classId, cls.id, `${cls.name}: the log records the class`);
  }
});

test('every fight a run plays is fought by its class’s own hero, traits and all', () => {
  // The claim the test above used to word and not check, checked where it is
  // true or false: inside the fight. The subject is the hero *entity* the
  // engine built from the spec the run handed it, read by wrapping the agent's
  // placement policy, which the engine calls with the live fight. Nothing here
  // rebuilds a setup or reads `heroSpecFor`, `fightSetupFor` or the run's
  // content; the expected side is the class of record in
  // `src/content/classes.ts`.
  //
  // Mutation watched going red: `heroSpecFor` rebuilt field by field without
  // `traits`, so the Ranger swings once and the Mage never burns. Before this
  // test and the widened `fightSigilProblems`, that passed every gate.
  //
  // Bound: seeds 1..6 per class, the greedy router, append-right placement. A
  // fight is observed when the player places a card in it, and the test
  // requires that to be every fight the run fought, so a fight the hook missed
  // fails here instead of quietly shrinking the claim. What the hero does with
  // its traits is `test/hero-attacks.test.ts`'s.
  let observed = 0;
  for (const cls of CLASSES) {
    const want = cls.hero.traits ?? [];
    for (const seed of SEEDS) {
      const bot = agentFor(seed);
      const fights = new Set<Fight>();
      const wrong: string[] = [];
      const agent: RunAgent = {
        ...bot,
        placement: (fight, plays) => {
          if (!fights.has(fight)) {
            fights.add(fight);
            const hero = heroOf(fight.state, 'player');
            if (hero.traits.join(',') !== want.join(',') || hero.cardId !== `hero:${cls.hero.name}`) {
              wrong.push(
                `fight ${fights.size} was fought by ${hero.cardId} with traits [${hero.traits.join(', ')}]`,
              );
            }
          }
          return bot.placement(fight, plays);
        },
      };
      const { run } = runRun(RUN_CONTENT, seed, agent, cls.id);
      assert.deepEqual(
        wrong,
        [],
        `${cls.name} seed ${seed}: a fight was not fought by the ${cls.name}'s hero, which is ` +
          `hero:${cls.hero.name} with traits [${want.join(', ')}] - the class's attack did not ` +
          `reach the engine`,
      );
      assert.equal(
        fights.size,
        run.fightsFought,
        `${cls.name} seed ${seed}: the run fought ${run.fightsFought} fight(s) and the placement ` +
          `hook saw ${fights.size}, so some fight's hero was never read`,
      );
      observed += fights.size;
    }
  }
  assert.ok(observed >= CLASSES.length * SEEDS.length, `only ${observed} fights observed across the window`);
});

test('a run of each class replays from its log to the same hash, and the three classes on one seed are three different runs', () => {
  // Mutation watched going red: `replayRun` ignoring `log.classId`, which
  // replays every log as the Knight.
  //
  // Seeds 1..6, three classes: determinism (the same seed and agent twice),
  // replay (the log with no agent in the loop), and that the hash can tell the
  // classes apart - a constant hash across classes would pass the first two
  // and mean nothing.
  for (const seed of SEEDS) {
    const hashes = new Set<string>();
    for (const cls of CLASSES) {
      const first = runRun(RUN_CONTENT, seed, agentFor(seed), cls.id);
      const again = runRun(RUN_CONTENT, seed, agentFor(seed), cls.id);
      const hash = hashRun(first.run);
      assert.equal(hashRun(again.run), hash, `${cls.name} seed ${seed}: the same run twice`);
      assert.equal(first.log.classId, cls.id);
      const replayed = replayRun(RUN_CONTENT, first.log);
      assert.equal(replayed.classId, cls.id, `${cls.name} seed ${seed}: the replay is the class the log names`);
      assert.equal(hashRun(replayed), hash, `${cls.name} seed ${seed}: replay from the log`);
      hashes.add(hash);
    }
    assert.equal(hashes.size, 3, `seed ${seed}: three classes, three final hashes`);
  }
});

test('every class replays from its saved log at every rung of the unlock ladder, and every fight it plays, elites and bosses included, is handed its ledger and its class’s hero', () => {
  // The product no gate held. `npm run verify:run` replays the Knight at three
  // unlock sets; `test/unlocks.test.ts` and `test/sigils.test.ts` play the
  // Knight; the test above replays every class with no unlock layer at all. So
  // a Ranger or a Mage at a partly unlocked profile - the ordinary case for
  // anyone who has finished a run and then picked another class - was replayed
  // by nothing, and its fights were held to its ledger and its hero by nothing.
  //
  // Each log goes the way a saved run does: `JSON.stringify`, `JSON.parse`,
  // `migrateRunLog`, then `replayRun` against the whole content, so the only
  // thing narrowing the replay is the set inside the log. Canonical strings are
  // compared rather than digests, so a failure says which field moved.
  //
  // "Every fight it plays" is read through `watchFights`: the agent's placement
  // policy, which the engine calls with the live fight, hands each fight to
  // `foughtSigilProblems` before its first round resolves. It reads each card
  // of the run's deck as the pool resolves it, the player's hero entity it
  // built, the deck it shuffled and the hand size and Energy, and holds them
  // to the run's content plus its ledger as it stands at that node. Of the
  // enemy side it reads only the enemy hero's Power and Armour.
  // Until the final acceptance review of `907c8e9` this test called only
  // `fightSigilProblems`, which builds one setup from the finished run at act
  // 0's first node - always an ordinary fight - so card sigils stripped from
  // every elite and boss fight passed it and all seven gates.
  //
  // Mutations watched going red: `heroSpecFor` dropping the class's traits
  // (through `fightSigilProblems`), a sigilled card's race set to human,
  // `startRun` recording a partial set with its owned half emptied for every
  // class but the default one, `startRun` handing every class the Knight's
  // hero whenever a set is passed, and the review's three: card sigils
  // stripped from every elite and boss fight, a sigilled card's race moved in
  // boss fights only, and hero-sigil Power and Armour dropped in boss fights
  // only. See `docs/learning/gate-proofs.md`, 2026-09-23.
  //
  // Bound: seeds 1..6 x both route styles x append-right placement, the rungs
  // `unlockLadder` reads off `ACHIEVEMENTS`, three classes. The population is
  // asserted per class - both kinds of sigil granted, sigilled cards in more
  // than one printed race, some elite and some boss fought with a card sigil
  // in the deck and some with a Power or Armour sigil in the ledger, not
  // necessarily the same fight, every fight a run fought seen by the watch,
  // and some partly unlocked rung that plays a different run from a fresh
  // profile. "Plays a different run" is `hashPlayed`, because `hashRun` names
  // the set and so differs between any two sets whatever the set did. A fight
  // is read as it is handed, not as it resolves, and the hero's own maximum
  // Health is not held: see `foughtSigilProblems`.
  const rungs = unlockLadder();
  assert.deepEqual(rungs[0]!.set, FRESH_UNLOCKS, 'the ladder does not start at a fresh profile');
  assert.ok(rungs.length >= 3, `a ladder of ${rungs.length} has no partly unlocked rung`);
  let runs = 0;
  for (const cls of CLASSES) {
    let heroSigils = 0;
    let cardSigils = 0;
    const sigilledRaces = new Set<Tribe>();
    let partialMoved = 0;
    const held = { elite: { fights: 0, withCardSigil: 0, withHeroSigil: 0 }, boss: { fights: 0, withCardSigil: 0, withHeroSigil: 0 } };
    for (const seed of SEEDS) {
      for (const route of ROUTES) {
        let fresh = '';
        for (let r = 0; r < rungs.length; r++) {
          const { name, set } = rungs[r]!;
          const label = `${cls.name} seed ${seed}/${route}, ${name}`;
          const watch = watchFights(makeRunAgent({ route, placement: 'right', seed }));
          const { run, log } = runRun(RUN_CONTENT, seed, watch.agent, cls.id, set);
          runs++;
          assert.deepEqual(
            watch.problems,
            [],
            `${label}: a fight the run played was not handed its content plus its ledger`,
          );
          const seen = watch.held.fight.fights + watch.held.elite.fights + watch.held.boss.fights;
          assert.equal(
            seen,
            run.fightsFought,
            `${label}: the run fought ${run.fightsFought} fight(s) and the watch held ${seen}, so ` +
              `some fight was never read`,
          );
          for (const kind of ['elite', 'boss'] as const) {
            held[kind].fights += watch.held[kind].fights;
            held[kind].withCardSigil += watch.held[kind].withCardSigil;
            held[kind].withHeroSigil += watch.held[kind].withHeroSigil;
          }
          assert.equal(log.classId, cls.id, `${label}: the log names another class`);
          assert.deepEqual(log.unlocked, set, `${label}: the log did not record the set the run was played with`);
          const saved = migrateRunLog(JSON.parse(JSON.stringify(log)));
          assert.equal(
            runToCanonical(replayRun(RUN_CONTENT, saved)),
            runToCanonical(run),
            `${label}: the saved log did not replay to the run it records`,
          );
          assert.deepEqual(sigilProblems(run), [], `${label}: the ledger and the deck disagree`);
          // The watch and `fightSigilProblems` hold each fight to
          // `run.content.hero`, so the content hero has to be held to the
          // class here, at this rung: the real-fight hero test above plays no
          // unlock set, and a hero swapped only when a set is passed would
          // pass both.
          assert.deepEqual(
            run.content.hero,
            cls.hero,
            `${label}: the run's content carries a hero that is not the ${cls.name}'s, so every ` +
              `fight above was held to the wrong hero`,
          );
          assert.deepEqual(
            fightSigilProblems(run),
            [],
            `${label}: the setup built from the finished run is not its content plus its ledger`,
          );
          for (const g of run.sigils) {
            if (g.target === 'hero') {
              heroSigils++;
              continue;
            }
            cardSigils++;
            const target = g.target;
            const dc = run.deck.find((d) => d.instanceId === target.instanceId);
            if (dc !== undefined) sigilledRaces.add(CARD_POOL.card(dc.cardId).tribe);
          }
          const played = hashPlayed(run);
          if (r === 0) fresh = played;
          else if (r < rungs.length - 1 && played !== fresh) partialMoved++;
        }
      }
    }
    assert.ok(heroSigils > 0, `${cls.name}: no hero sigil across the window, so its hero spec was never checked with one`);
    assert.ok(cardSigils > 0, `${cls.name}: no card sigil across the window, so no sigilled card was checked`);
    for (const kind of ['elite', 'boss'] as const) {
      const t = held[kind];
      assert.ok(
        t.withCardSigil > 0 && t.withHeroSigil > 0,
        `${cls.name}: the watch held ${t.fights} ${kind} fight(s), ${t.withCardSigil} with a card ` +
          `sigil in the deck and ${t.withHeroSigil} with a Power or Armour sigil in the ledger. ` +
          `This needs at least one ${kind} with each, not necessarily the same one, so for the ` +
          `kind at 0, "every ${kind} fight is handed its ledger" was never asked`,
      );
    }
    assert.ok(
      sigilledRaces.size > 1,
      `${cls.name}: every sigilled card printed one race (${[...sigilledRaces].join(', ')}), so a ` +
        `sigil that moved a race to that one would pass unseen`,
    );
    assert.ok(
      partialMoved > 0,
      `${cls.name}: no partly unlocked rung played a different run from a fresh profile on any ` +
        `seed, so the partial rungs replayed above were fresh-profile runs under another name`,
    );
  }
  assert.equal(runs, CLASSES.length * SEEDS.length * ROUTES.length * rungs.length, 'a run was skipped');
});

test('a log written before classes existed has no class and replays as the Knight', () => {
  // Mutation watched going red: `CLASSES` reordered to list the Ranger first.
  //
  // Save and replay compatibility is a contract (`AGENTS.md`). The old shape
  // is `{ seed, nodes }`, and it must keep replaying to the hash it always did
  // - which is only true while the shipped content's default class is the
  // Knight. `defaultClassId` is the first class listed, so the Knight's place
  // at the head of `CLASSES` is load-bearing and this is where it is held.
  assert.equal(defaultClassId(RUN_CONTENT), DEFAULT_CLASS_ID);
  assert.equal(DEFAULT_CLASS_ID, 'knight');
  assert.equal(RUN_CONTENT.hero, classOf(RUN_CONTENT).hero, 'the content’s own hero is its default class’s');
  assert.equal(RUN_CONTENT.startingDeck, classOf(RUN_CONTENT).startingDeck);
  assert.equal(RUN_CONTENT.rewards, classOf(RUN_CONTENT).rewards);

  for (const seed of SEEDS) {
    const knight = runRun(RUN_CONTENT, seed, agentFor(seed), 'knight');
    // `format` is carried because the *class* is what this test drops, and a
    // log with no class is still a log this code writes. A log with no
    // `format` either is unit 9's business: `test/sigils.test.ts` replays two
    // of those through `migrateRunLog`.
    const old: RunLog = { seed: knight.log.seed, format: RUN_LOG_FORMAT, nodes: knight.log.nodes };
    assert.equal('classId' in old, false, 'the fixture is the old shape');
    const replayed = replayRun(RUN_CONTENT, old);
    assert.equal(replayed.classId, 'knight');
    assert.equal(hashRun(replayed), hashRun(knight.run), `seed ${seed}: the old log is a Knight run`);

    const unnamed = runRun(RUN_CONTENT, seed, agentFor(seed));
    assert.equal(hashRun(unnamed.run), hashRun(knight.run), `seed ${seed}: naming no class is naming the Knight`);
  }
});

test('the maps and the fight seeds are the seed’s alone: three classes on one seed walk the same acts', () => {
  // Mutation watched going red: the run generator seeded from the class as
  // well as the seed, which gives each class its own maps and breaks the
  // comparison `npm run measure:run -- --class` rests on.
  for (const seed of SEEDS) {
    const runs = CLASSES.map((cls) => startRun(RUN_CONTENT, seed, cls.id));
    const maps = new Set(runs.map((r) => hashMaps(r)));
    assert.equal(maps.size, 1, `seed ${seed}: one map for three classes`);
    const firstFight = runs.map((r) => {
      const node = travelOptions(r).find((n) => n.type === 'fight' || n.type === 'elite') ?? travelOptions(r)[0]!;
      return fightSeedFor(r, node);
    });
    assert.equal(new Set(firstFight).size, 1, `seed ${seed}: the first fight is seeded the same for every class`);
  }
});

test('an unknown class is refused by name, and the refusal names the classes offered', () => {
  // Mutation watched going red: `classOf` falling back to the default class
  // instead of throwing.
  assert.throws(() => startRun(RUN_CONTENT, 1, 'bard'), /class "bard" is not one this content offers.*knight, ranger, mage/);
  assert.throws(() => runRun(RUN_CONTENT, 1, agentFor(1), 'Knight'), /class "Knight" is not one this content offers/);

  const fixture: RunContent = { ...RUN_CONTENT };
  delete (fixture as { classes?: unknown }).classes;
  assert.equal(fixture.classes, undefined);
  const only = classOf(fixture);
  assert.equal(only.id, 'knight', 'a content with no class list offers the Knight alone');
  assert.equal(only.hero, fixture.hero, 'made of its own hero');
  assert.throws(() => classOf(fixture, 'ranger'), /class "ranger" is not one this content offers.*no class list/);
});

test('contentForClass derives a content that lists one class and starts as it', () => {
  // Mutation watched going red: `contentForClass` keeping the full class
  // list, which makes the derived content start as the Knight whatever class
  // it was derived for - the trap `npm run measure:run -- --class` would fall
  // into, silently measuring the Knight three times.
  for (const cls of CLASSES) {
    const derived = contentForClass(RUN_CONTENT, cls.id);
    assert.deepEqual(derived.classes?.map((c) => c.id), [cls.id]);
    assert.equal(derived.hero, cls.hero);
    assert.equal(derived.startingDeck, cls.startingDeck);
    assert.equal(derived.rewards, cls.rewards);
    assert.equal(defaultClassId(derived), cls.id);

    const run = startRun(derived, 3);
    assert.equal(run.classId, cls.id, `${cls.name}: the derived content starts as its class when none is named`);
    assert.equal(hashRun(run), hashRun(startRun(RUN_CONTENT, 3, cls.id)), `${cls.name}: and it is the same run`);
  }
  const ranger = contentForClass(RUN_CONTENT, 'ranger');
  assert.throws(() => startRun(ranger, 3, 'knight'), /class "knight" is not one this content offers.*ranger\./);
});

// ------------------------------------------------------------- the screen

test('createRunController starts as the class it is given, records it, and refuses to resume a log as another class', () => {
  // Mutation watched going red: the class check on resume dropped, which
  // resumes a Ranger's log as a Mage and diverges at the first fight.
  const ranger = createRunController(RUN_CONTENT, 5, { classId: 'ranger' });
  assert.equal(ranger.classId, 'ranger');
  assert.equal(ranger.log.classId, 'ranger');
  assert.equal(ranger.state.hero.maxHealth, classById('ranger').hero.health);
  assert.deepEqual(ranger.state.deck.map((d) => d.cardId), [...classById('ranger').startingDeck]);

  const unnamed = createRunController(RUN_CONTENT, 5);
  assert.equal(unnamed.classId, 'knight', 'the default is the Knight, as it was');
  assert.equal(unnamed.log.classId, 'knight', 'and a fresh log says so rather than leaving it off');

  assert.throws(() => createRunController(RUN_CONTENT, 5, { classId: 'bard' }), /class "bard" is not one this content offers/);

  const { log } = runRun(RUN_CONTENT, 5, agentFor(5), 'ranger');
  const resumed = createRunController(RUN_CONTENT, 5, { resume: log });
  assert.equal(resumed.classId, 'ranger', 'a resumed run is the class its log names');
  assert.equal(createRunController(RUN_CONTENT, 5, { resume: log, classId: 'ranger' }).classId, 'ranger');
  assert.throws(
    () => createRunController(RUN_CONTENT, 5, { resume: log, classId: 'mage' }),
    /cannot resume a run started as the ranger as the mage/,
  );

  const old: RunLog = {
    seed: 5,
    format: RUN_LOG_FORMAT,
    nodes: runRun(RUN_CONTENT, 5, agentFor(5), 'knight').log.nodes,
  };
  assert.equal(createRunController(RUN_CONTENT, 5, { resume: old }).classId, 'knight', 'an old log resumes as the Knight');
});

test('the screen the app builds is handed every class the game has', () => {
  // **This test used to construct its own `renderClassPick({classes: CLASSES})`
  // call and never touch `src/ui/runapp.ts`.** An independent review proved
  // what that was worth: handing the screen `CLASSES.filter(c => c.id !==
  // 'mage')` at the one production call site left `npm test` green. So the
  // subject here is `classPickHtml`, which is the function `renderPick` calls,
  // and the classes it hands over are the app's own list.
  //
  // Mutation watched going red: `PICKABLE_CLASSES` set to
  // `CLASSES.filter((c) => c.id !== 'mage')`.
  //
  // Bound: HTML, not pixels. It says the three buttons and their numbers are in
  // the markup the app builds; what the screen LOOKS like is
  // `node tools/ui-probe/pick.ts`'s, and the shots are digested in
  // `docs/work/10_classes/plan.md`. It also says nothing about the click that
  // reaches `pickClass`, which needs a document - the probe covers that too.
  assert.deepEqual(
    PICKABLE_CLASSES.map((c) => c.id),
    CLASSES.map((c) => c.id),
    'the app offers the classes the game has; a class the game ships and the screen never shows ' +
      'cannot be picked and nothing else would say so',
  );
  const html = classPickHtml({ seed: 7, pool: CARD_POOL, mount: true, hatch: false });
  const buttons = [...html.matchAll(/data-run="pick-class" data-class="([a-z]+)"/g)].map((m) => m[1]);
  assert.deepEqual(buttons, ['knight', 'ranger', 'mage'], 'one button per class, in the order the classes are listed');
  for (const cls of CLASSES) {
    assert.match(html, new RegExp(`Play the ${cls.name}`), `${cls.name}: the button says which class it starts`);
    assert.match(html, new RegExp(`${cls.hero.health} Health`), `${cls.name}: the bar is on the card`);
    assert.match(html, new RegExp(`Starts with ${cls.startingDeck.length} cards`), `${cls.name}: the deck size is on the card`);
    assert.match(html, new RegExp(`Drafts from ${cls.rewards.length} cards`), `${cls.name}: the pool size is on the card`);
    for (const t of cls.hero.traits ?? []) {
      assert.match(html, new RegExp(TRAIT_TERMS[t].name), `${cls.name}: its trait is named`);
    }
  }
  assert.match(html, /Seed 7/);

  // The screen itself still draws exactly what it is given, which is what makes
  // the assertion above the whole story rather than half of it.
  const cards: readonly UnitCard[] = PLAYER_CARDS;
  const pool: CardPool = {
    card: (id) => {
      const c = cards.find((x) => x.id === id);
      if (c === undefined) throw new Error(`no card "${id}"`);
      return c;
    },
    energyPerTurn: 3,
    handSize: 5,
  };
  const oneOnly = renderClassPick({ seed: 7, classes: [classById('mage')], pool, mount: true, hatch: false });
  assert.deepEqual(
    [...oneOnly.matchAll(/data-run="pick-class" data-class="([a-z]+)"/g)].map((m) => m[1]),
    ['mage'],
  );
});

test('a class named from outside the app is refused unless it is one of the three', () => {
  // The other half of the same wiring, and the other mutation that left the
  // suite green: deleting the membership check in the pick handler. Both
  // callers - the `?class=` in the address bar and the `data-class` of whatever
  // was clicked - go through `pickableClassId`, so there is one gate rather
  // than two that can drift apart.
  //
  // Mutation watched going red: `pickableClassId` returning `raw` whenever it
  // is not null.
  //
  // Null, not a throw and not a fallback to the Knight: an address naming a
  // class that does not exist puts the pick screen up and lets the player
  // choose. `picking = classParam === null` in `startRunApp` is that sentence
  // in code.
  for (const cls of CLASSES) assert.equal(pickableClassId(cls.id), cls.id);
  assert.equal(pickableClassId('bard'), null, 'a class the game does not have');
  assert.equal(pickableClassId('Knight'), null, 'ids are lower case and are not guessed at');
  assert.equal(pickableClassId(''), null);
  assert.equal(pickableClassId(null), null, 'no ?class= at all');
  assert.equal(pickableClassId(undefined), null, 'and a dataset entry that was not there');

  // What the refusal is worth: every id it does admit starts a run, and every
  // id it refuses would have thrown one call later.
  for (const cls of CLASSES) {
    const id = pickableClassId(cls.id);
    assert.ok(id !== null);
    assert.equal(createRunController(RUN_CONTENT, 5, { classId: id }).classId, cls.id);
  }
  assert.throws(
    () => createRunController(RUN_CONTENT, 5, { classId: 'bard' }),
    /class "bard" is not one this content offers/,
    'the refusal above is what stands between a typed address and this',
  );
});
