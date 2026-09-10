// What each node type offers, and what accepting an offer does to run state.
//
// Split from `run.ts` for one reason: replay has to recompute every offer from
// the run state alone and take nothing but the *choice* from the log. Keeping
// the offers in named pure-ish functions is what makes "recompute, then apply
// the recorded index" a thing the loop can do without a second code path.
//
// Two different sources of randomness meet here, and the split between them is
// the run's determinism story:
//
//   - **The run stream.** One `Rng` on `RunState`, threaded through every
//     reward offer, shop shelf, event draw and sigil offer. Consuming a
//     different number of draws - by taking a shop instead of a forge - shifts
//     everything after it, which is what makes a route a route.
//
//   - **Node-keyed derivation.** A fight's seed and its encounter are
//     `mixSeeds(runSeed, act, nodeId, tag)`: a pure function of *which node it
//     is*, and of nothing the player did on the way there. So the fight at act
//     2's node 11 is the same fight whatever route reached it and whatever the
//     run stream has been up to. This is the clause in the unit's brief - "a
//     different routing choice cannot perturb a fight's internals" - as
//     arithmetic rather than as a convention, and it is gated by
//     "a node's fight is a function of the node, not of the route" in
//     `test/run.test.ts`.
//
// Sigils draw from the run stream and only the run stream. A sigil offer is a
// draw like a reward card is a draw, so taking one route rather than another
// changes which sigils come up later, and no sigil can ever reach into a
// fight's own streams - `checkStreamSeparation` in `src/sim/runmeasure.ts`
// burns run-stream draws and requires every fight seed to hold still.

import { RELAY_POWER, WAKE_POWER } from '../engine/resolver.ts';
import { type Rng, mixSeeds, nextFloat, nextInt } from '../engine/rng.ts';
import type { SideRules } from '../engine/state.ts';
import { attachSigil, hasTrait, makeDeckCard } from './deck.ts';
import type {
  CardSigilDef,
  EventEffect,
  ForgeOffer,
  HeroSigilDef,
  MapNode,
  RewardEntry,
  RewardOption,
  RunContent,
  RunEncounter,
  RunEventDef,
  RunState,
  ShopItem,
  SigilDef,
} from './types.ts';
import { FORGE_MODES } from './types.ts';

/** Distinguishes the two node-keyed derivations. Arbitrary, and fixed forever. */
const TAG_FIGHT_SEED = 0x1f19;
const TAG_ENCOUNTER = 0x0e11;

/**
 * Weighted draw of `k` distinct entries. Draws are taken one at a time from the
 * run stream, so `k` offers cost exactly `k` draws. Shared by the card shelf,
 * the shop and both sigil offers, so they cannot disagree about what a
 * weighted draw is.
 */
export function drawDistinct<T extends { readonly weight: number }>(
  rng: Rng,
  table: readonly T[],
  k: number,
): T[] {
  const pool = table.slice();
  const out: T[] = [];
  const want = Math.min(k, pool.length);
  for (let i = 0; i < want; i++) {
    let total = 0;
    for (const p of pool) total += p.weight;
    if (total <= 0) break;
    let roll = nextFloat(rng) * total;
    let chosen = pool.length - 1;
    for (let j = 0; j < pool.length; j++) {
      roll -= pool[j]!.weight;
      if (roll < 0) {
        chosen = j;
        break;
      }
    }
    out.push(pool[chosen]!);
    pool.splice(chosen, 1);
  }
  return out;
}

/** `k` distinct card ids from a reward table. Exactly `k` draws. */
export function drawDistinctCards(
  rng: Rng,
  table: readonly RewardEntry[],
  k: number,
): string[] {
  return drawDistinct(rng, table, k).map((e) => e.cardId);
}

// ---------------------------------------------------------------------------
// Sigils: what the content has, what the run holds, what is on offer
// ---------------------------------------------------------------------------

export function cardSigils(content: RunContent): CardSigilDef[] {
  return content.sigils.filter((s): s is CardSigilDef => s.kind === 'card');
}

export function heroSigils(content: RunContent): HeroSigilDef[] {
  return content.sigils.filter((s): s is HeroSigilDef => s.kind === 'hero');
}

/** A sigil by id. Throws for an id the content does not define; names what it does. */
export function sigilById(content: RunContent, id: string): SigilDef {
  const s = content.sigils.find((x) => x.id === id);
  if (s === undefined) {
    throw new Error(
      `run: no sigil "${id}" in this run's content. It defines ` +
        `${content.sigils.length === 0 ? 'none' : content.sigils.map((x) => x.id).join(', ')}.`,
    );
  }
  return s;
}

/** The hero sigils this run holds, in the order they were taken. */
export function heldHeroSigils(run: RunState): HeroSigilDef[] {
  const out: HeroSigilDef[] = [];
  for (const g of run.sigils) {
    if (g.target !== 'hero') continue;
    const def = sigilById(run.content, g.sigilId);
    if (def.kind === 'hero') out.push(def);
  }
  return out;
}

/**
 * The rules the run's hero sigils have bent, as the engine's `SideRules`: an
 * amount in force per rule, present only when some sigil moved it. Deltas add,
 * so two sigils on one rule stack; the shipped content offers each hero sigil
 * once, and `heroSigilOffer` never re-offers a held one.
 */
export function heroRules(run: RunState): SideRules {
  let relay = 0;
  let wake = 0;
  for (const s of heldHeroSigils(run)) {
    if (s.effect.kind === 'relayPower') relay += s.effect.amount;
    else if (s.effect.kind === 'wakePower') wake += s.effect.amount;
  }
  return {
    ...(relay !== 0 ? { relayPower: RELAY_POWER + relay } : {}),
    ...(wake !== 0 ? { wakePower: WAKE_POWER + wake } : {}),
  };
}

/** The hand size the run's fights draw to: the pool's, plus every held hand sigil. */
export function handSizeFor(run: RunState): number {
  let extra = 0;
  for (const s of heldHeroSigils(run)) if (s.effect.kind === 'handSize') extra += s.effect.amount;
  return run.content.pool.handSize + extra;
}

/**
 * The hero sigils a won elite or boss puts on offer: `heroSigilOffers` distinct
 * ones the run does not already hold, weighted. Costs one draw per sigil
 * offered, and nothing when there is nothing left to offer - in which case the
 * node asks no `sigil` choice at all, the same way an empty deck asks no forge.
 */
export function heroSigilOffer(run: RunState): HeroSigilDef[] {
  const held = new Set(run.sigils.filter((g) => g.target === 'hero').map((g) => g.sigilId));
  const available = heroSigils(run.content).filter((s) => !held.has(s.id));
  return drawDistinct(run.rng, available, run.content.heroSigilOffers);
}

/**
 * The deck indices a card sigil could go on: every card that does not already
 * have the trait, printed or from an earlier sigil. The order is deck order,
 * so a replayed `attach` choice names a deck index and finds it here.
 */
export function attachOffers(run: RunState, sigil: CardSigilDef): number[] {
  const out: number[] = [];
  for (let i = 0; i < run.deck.length; i++) {
    if (!hasTrait(run.content.pool, run.deck[i]!, sigil.trait)) out.push(i);
  }
  return out;
}

/**
 * What a won fight puts on the shelf. `rewardOffers` cards, drawn as before,
 * then - at an ordinary fight only - one roll on `cardSigilChance` and, when it
 * hits, one weighted draw among the card sigils that have somewhere to go.
 *
 * The cards are drawn first so that the card half of the shelf consumes the
 * run stream exactly as it did before sigils existed. A sigil that no deck card
 * can take is never offered: an offer the player cannot use is not a decision,
 * and the `attach` choice that follows a sigil pick must always have a target.
 */
export function rewardOffer(run: RunState, node: MapNode): RewardOption[] {
  const out: RewardOption[] = drawDistinctCards(
    run.rng,
    run.content.rewards,
    run.content.rewardOffers,
  ).map((cardId) => ({ kind: 'card', cardId }));
  if (node.type !== 'fight') return out;
  const eligible = cardSigils(run.content).filter((s) => attachOffers(run, s).length > 0);
  if (eligible.length === 0 || run.content.cardSigilChance <= 0) return out;
  if (nextFloat(run.rng) >= run.content.cardSigilChance) return out;
  const drawn = drawDistinct(run.rng, eligible, 1)[0];
  if (drawn !== undefined) out.push({ kind: 'sigil', sigil: drawn });
  return out;
}

/** A shop's shelf. Price is a function of the card's printed cost. */
export function shopStock(run: RunState): ShopItem[] {
  const ids = drawDistinctCards(run.rng, run.content.rewards, run.content.shopStock);
  return ids.map((cardId) => ({
    cardId,
    price: run.content.shopBasePrice + run.content.shopPricePerCost * run.content.pool.card(cardId).cost,
  }));
}

/** Every upgrade the forge could apply, deck order then mode order. No draws. */
export function forgeOffers(run: RunState): ForgeOffer[] {
  const out: ForgeOffer[] = [];
  for (let i = 0; i < run.deck.length; i++) {
    for (const mode of FORGE_MODES) out.push({ deckIndex: i, mode });
  }
  return out;
}

/** Which event this node is. One draw from the run stream. */
export function drawEvent(run: RunState): RunEventDef {
  const events = run.content.events;
  if (events.length === 0) {
    throw new Error('run: an event node was reached but the content defines no events');
  }
  return events[nextInt(run.rng, events.length)]!;
}

/**
 * The seed the fight at this node is fought with.
 *
 * A pure function of the run seed and the node. Not of the route, not of the
 * run stream's position, not of the deck.
 */
export function fightSeedFor(run: RunState, node: MapNode): number {
  return mixSeeds(run.seed, run.act, node.id, TAG_FIGHT_SEED);
}

/** The encounter this node fields. Node-keyed for the same reason as the seed. */
export function encounterFor(run: RunState, node: MapNode): RunEncounter {
  const act = run.content.acts[run.act];
  if (act === undefined) {
    throw new Error(
      `run: act index ${run.act} has no content; the run content defines ` +
        `${run.content.acts.length} act(s)`,
    );
  }
  if (node.type === 'boss') return act.boss;
  const list = node.type === 'elite' ? act.elites : act.fights;
  if (list.length === 0) {
    throw new Error(
      `run: act ${run.act + 1} defines no ${node.type} encounters, but its map has a ` +
        `${node.type} node at row ${node.row}`,
    );
  }
  const idx = mixSeeds(run.seed, run.act, node.id, TAG_ENCOUNTER) % list.length;
  return list[idx]!;
}

/** Gold a won fight at this node pays. */
export function goldFor(run: RunState, node: MapNode): number {
  const act = run.content.acts[run.act]!;
  if (node.type === 'boss') return act.goldPerBoss;
  if (node.type === 'elite') return act.goldPerElite;
  return act.goldPerFight;
}

// ---------------------------------------------------------------------------
// Applying a choice
// ---------------------------------------------------------------------------

export function healHero(run: RunState, amount: number): void {
  run.hero.health = Math.min(run.hero.maxHealth, run.hero.health + Math.max(0, amount));
}

/** Damage outside a fight. Cannot kill: it floors at 1. See the note in `run.ts`. */
export function hurtHero(run: RunState, amount: number): void {
  run.hero.health = Math.max(1, run.hero.health - Math.max(0, amount));
}

/** What a rest node restores: a fraction of max Health, at least 1. */
export function restAmount(run: RunState): number {
  return Math.max(1, Math.round(run.hero.maxHealth * run.content.restHealFraction));
}

export function applyEventEffect(run: RunState, effect: EventEffect): void {
  switch (effect.kind) {
    case 'heal':
      healHero(run, effect.amount);
      return;
    case 'damage':
      hurtHero(run, effect.amount);
      return;
    case 'gold':
      run.gold += effect.amount;
      return;
    case 'card': {
      const drawn = drawDistinctCards(run.rng, run.content.rewards, 1)[0];
      if (drawn !== undefined) addCard(run, drawn);
      return;
    }
  }
}

/**
 * Mint a new instance of `cardId` and append it to the deck.
 *
 * Instance numbers only ever go up, so an id is unique for the life of a run
 * and is never reused - which is what lets a forge address one copy of a card
 * the deck holds three of.
 */
export function addCard(run: RunState, cardId: string): void {
  run.deck.push(makeDeckCard(cardId, run.nextInstance));
  run.nextInstance++;
  run.cardsGained++;
}

/**
 * Take a hero sigil. It goes in the ledger, and the one effect that is a state
 * change rather than a rule - `maxHealth` - is applied here and now: the bar
 * grows and the hero heals by the same amount, because a bigger bar with the
 * same hole in it would be a reward the player cannot feel at the boss they
 * just beat. The rule effects are read off the ledger by `heroRules` and
 * `handSizeFor` whenever a fight is set up, so they need no state of their own.
 *
 * Refuses a sigil the run already holds: `heroSigilOffer` never offers one,
 * and a ledger with the same hero sigil twice would stack a rule the shelf
 * said could not stack.
 */
export function grantHeroSigil(run: RunState, sigil: HeroSigilDef): void {
  if (run.sigils.some((g) => g.target === 'hero' && g.sigilId === sigil.id)) {
    throw new Error(
      `run: the hero already holds "${sigil.id}"; a hero sigil is taken at most once a run`,
    );
  }
  run.sigils.push({ target: 'hero', sigilId: sigil.id });
  if (sigil.effect.kind === 'maxHealth') {
    run.hero.maxHealth += sigil.effect.amount;
    run.hero.health = Math.min(run.hero.maxHealth, run.hero.health + sigil.effect.amount);
  }
}

/**
 * Attach a card sigil to the deck card at `deckIndex`: the trait goes on the
 * instance through `attachSigil`, and the grant goes in the ledger keyed by
 * the instance id, so the two can be held to each other.
 */
export function attachCardSigil(run: RunState, deckIndex: number, sigil: CardSigilDef): void {
  attachSigil(run.content.pool, run.deck, deckIndex, { id: sigil.id, trait: sigil.trait });
  run.sigils.push({ target: { instanceId: run.deck[deckIndex]!.instanceId }, sigilId: sigil.id });
}
