/**
 * A won fight's screens, and the marks a sigil leaves on the run's other
 * screens.
 *
 * Three decisions and the places their results show:
 *
 *   hero sigil   a won elite or boss: two sigils the run does not hold, each
 *                saying exactly what it does at the numbers the fight will
 *                use, or none
 *   the shelf    the fight's reward: three cards and, on the roll, a card
 *                sigil beside them, drawn as a card-shaped button with the
 *                sigil's seal, so "card or sigil?" is one row of buttons
 *   attach       every deck card, the ones that can take the sigil lit and the
 *                rest disabled with the reason, because a sigil on a card that
 *                already has the trait would change nothing
 *
 * The first two open with the same line - the rounds, the hero's Health and
 * the gold - and it is written once, in `wonLeadHtml`, from `heroNow`. The
 * shelf used to write its own copy inside `runapp.ts` and read the maximum off
 * the stale state, so after the Sigil of the Oak it printed "146 of 180
 * Health" under a HUD reading 146/210. All three screens are pure and exported
 * for the reason `runapp.ts` gives for `classPickHtml`: a sentence written
 * inside `startRunApp` is a sentence `node --test` cannot read, and that one
 * went wrong with no test able to see it.
 *
 * And then the HUD's chips for the hero's sigils, the deck panel's badges for
 * the sigilled cards, and the notice line that says what was taken. All HTML
 * strings, built the way `runapp.ts` builds its own screens, and every noun
 * from `render/sigil-terms.ts` so the shelf, the panel and the chips cannot
 * disagree about what a sigil is called or does.
 *
 * Nothing here advances the run. `runapp.ts` wires the buttons to the
 * controller, and the controller advances it through `replayRun` alone.
 */

import type { Trait, UnitCard } from '../engine/state.ts';
import { grantedTraits, hasTrait, resolveDeckCard } from '../run/deck.ts';
import { sigilById } from '../run/nodes.ts';
import type { CardSigilDef, DeckCard, HeroSigilDef, RunContent, RunState } from '../run/types.ts';
import { STAT_TERMS, TRAIT_TERMS } from '../render/glossary.ts';
import { iconSvg } from '../render/icons.ts';
import { NODE_ICON } from '../render/map.ts';
import { CARD_SIGIL_TERMS, SIGIL_TERM, heroEffectWords } from '../render/sigil-terms.ts';
import { type NodeOutcome, type RunPhase, type WonPhase, heroNow } from './run.ts';
import { escapeHtml as esc } from '../render/escape.ts';

/** The one line that says what a card sigil does when attached. */
function cardSigilWords(sigil: CardSigilDef): string {
  const trait = TRAIT_TERMS[sigil.trait];
  return `Attach to one card in your deck: it gains ${trait.name} for the rest of the run. ${trait.line}`;
}

/**
 * The line a won fight's screen opens with: how many rounds it took, the
 * hero's Health against its maximum, and what the fight paid.
 *
 * The numbers are `heroNow`'s, which is what the HUD reads, so the line and
 * the HUD above it say the same thing. `state.gold` is still the gold from
 * before the node - the state moves at the commit - which is what makes the
 * difference the pay.
 */
export function wonLeadHtml(p: WonPhase, state: RunState): string {
  const f = p.outcome.fight;
  const n = heroNow(state, p);
  return (
    `<p class="run__lead">Won in ${f.round} round${f.round === 1 ? '' : 's'}. Your hero stands at <b>${n.health}</b> of ${n.maxHealth} ${STAT_TERMS.health.name}.` +
    ` <b>+${n.gold - state.gold} gold</b> — you now have ${n.gold}.</p>`
  );
}

/**
 * The reward shelf: one of three cards into the deck, or the card sigil when
 * one rolled, or nothing. `cardButton` is the run screen's own card button,
 * handed in as `attachHtml`'s is, because it paints with the fight screen's
 * theme and hatching and those need the document.
 */
export function rewardHtml(
  p: Extract<RunPhase, { kind: 'reward' }>,
  state: RunState,
  cardButton: (card: UnitCard, attrs: string) => string,
): string {
  const pool = state.content.pool;
  return (
    `<h2 class="run__title">${iconSvg(NODE_ICON[p.node.type], { size: 22, decorative: true })} ${esc(p.encounter.name)} beaten</h2>` +
    wonLeadHtml(p, state) +
    `<p>Take one ${p.offer.some((o) => o.kind === 'sigil') ? 'card into your deck, or the sigil for a card you already hold,' : 'card into your deck,'} or none:</p>` +
    `<div class="run__offer">${p.offer
      .map((o, i) => (o.kind === 'card' ? cardButton(pool.card(o.cardId), `data-run="reward" data-pick="${i}"`) : sigilShelfButton(o.sigil, i)))
      .join('')}</div>` +
    `<p><button type="button" data-run="reward" data-pick="-1">Take nothing</button></p>`
  );
}

/**
 * The hero sigil offer. Each option says what it does at the number the fight
 * will use, and declining is its own button, because a run where you cannot
 * decline has one fewer decision. Never shown for an empty offer: the
 * controller declines on the player's behalf then, since -1 is the only
 * answer there is.
 */
export function heroSigilOfferHtml(p: Extract<RunPhase, { kind: 'sigil' }>, state: RunState): string {
  const held = heroNow(state, p).heroSigils;
  return (
    `<h2 class="run__title">${iconSvg('sigil', { size: 22, decorative: true })} ${esc(p.encounter.name)} beaten — a hero ${SIGIL_TERM.name.toLowerCase()}</h2>` +
    wonLeadHtml(p, state) +
    `<p>${esc(SIGIL_TERM.line)} Take one for your hero, or none${held.length > 0 ? ` — you already hold ${held.map((s) => `<b>${esc(s.name)}</b>`).join(' and ')}` : ''}:</p>` +
    `<div class="run__options">${p.offer
      .map(
        (s, i) =>
          `<button type="button" class="run__option run__option--sigil" data-run="sigil" data-pick="${i}" data-sigil-id="${esc(s.id)}">` +
          `<b>${iconSvg('sigil', { size: 15, decorative: true })} ${esc(s.name)}</b><small>${esc(heroEffectWords(s.effect))}</small></button>`,
      )
      .join('')}</div>` +
    `<p><button type="button" data-run="sigil" data-pick="-1">Take none</button></p>`
  );
}

/**
 * A card sigil on the shelf, shaped like the card buttons beside it so the
 * row reads as one choice. The seal is the art; the words say what it does.
 */
export function sigilShelfButton(sigil: CardSigilDef, pick: number): string {
  const trait = TRAIT_TERMS[sigil.trait];
  const words = cardSigilWords(sigil);
  return (
    `<button type="button" class="runcard runcard--sigil" data-run="reward" data-pick="${pick}" data-sigil-id="${esc(sigil.id)}"` +
    ` title="${esc(`${sigil.name}. ${words}`)}" aria-label="${esc(`${sigil.name}. ${words}`)}">` +
    `<span class="runcard__seal" aria-hidden="true">${iconSvg('sigil', { size: 44, decorative: true })}${iconSvg(trait.icon, { size: 18, decorative: true, className: 'runcard__seal-trait' })}</span>` +
    `<span class="runcard__name">${esc(sigil.name)}</span>` +
    `<span class="runcard__stats">${esc(`Grants ${trait.name} to a card of your choice, for the run`)}</span>` +
    '</button>'
  );
}

/**
 * The attach screen: the whole deck, the cards that can take the sigil as
 * buttons and the rest disabled with the reason on them. `cardButton` is the
 * run screen's own card button, handed in so a deck card here is drawn
 * exactly as it is at the forge, sigil marks included.
 */
export function attachHtml(
  p: Extract<RunPhase, { kind: 'attach' }>,
  state: RunState,
  cardButton: (card: UnitCard, attrs: string, foot: string, sigilTraits: readonly Trait[]) => string,
): string {
  const trait = TRAIT_TERMS[p.sigil.trait];
  const pool = state.content.pool;
  const cards = state.deck
    .map((dc, i) => {
      const card = resolveDeckCard(pool, dc);
      const can = p.offers.includes(i);
      const why = can
        ? ''
        : hasTrait(pool, dc, p.sigil.trait)
          ? `already ${trait.name}`
          : 'cannot take it';
      const marks = sigilMarks(dc, state.content);
      return cardButton(
        card,
        `data-run="attach" data-index="${i}"${can ? '' : ' disabled'}`,
        (marks.length > 0 ? `<span class="runcard__sigil">${esc(marks)}</span>` : '') +
          (can ? '' : `<span class="runcard__price is-short">${esc(why)}</span>`),
        grantedTraits(pool, dc),
      );
    })
    .join('');
  return (
    `<h2 class="run__title">${iconSvg('sigil', { size: 22, decorative: true })} Attach the ${esc(p.sigil.name)}</h2>` +
    `<p class="run__lead">${esc(cardSigilWords(p.sigil))}</p>` +
    `<p>Pick the card it goes on. ${p.offers.length} of your ${state.deck.length} can take it; the rest already have ${esc(trait.name)}.</p>` +
    `<div class="run__deckgrid">${cards}</div>`
  );
}

/**
 * The hero's sigils as HUD chips, each with its effect on hover. Empty when
 * none. Handed the list rather than the state, because inside a won fight the
 * state does not hold a sigil taken there yet - `heroNow` says which list is
 * the true one.
 */
export function heroSigilChips(held: readonly HeroSigilDef[]): string {
  if (held.length === 0) return '';
  return held
    .map(
      (s) =>
        `<span class="hud__stat hud__stat--sigil" title="${esc(`${s.name}. ${heroEffectWords(s.effect)}`)}">` +
        iconSvg('sigil', { size: 13, label: `hero ${SIGIL_TERM.name.toLowerCase()}` }) +
        `<b>${esc(s.name.replace(/^Sigil of (the )?/, ''))}</b></span>`,
    )
    .join('');
}

/** The names of the sigils on a deck card, comma-separated. Empty when none. */
export function sigilMarks(dc: DeckCard, content: RunContent): string {
  return dc.sigils
    .map((s) => {
      try {
        return sigilById(content, s.id).name;
      } catch {
        return CARD_SIGIL_TERMS[s.trait].name;
      }
    })
    .join(', ');
}

/** What a node's sigils did, for the notice line. Empty when it granted none. */
export function sigilOutcomeWords(
  o: NodeOutcome,
  content: RunContent,
  cardName: (instanceId: string) => string,
): string {
  return o.sigils
    .map((g) => {
      const def = sigilById(content, g.sigilId);
      return g.target === 'hero'
        ? ` <b>${esc(def.name)}</b> is on your hero.`
        : ` <b>${esc(def.name)}</b> is on <b>${esc(cardName(g.target.instanceId))}</b>.`;
    })
    .join('');
}

export type { HeroSigilDef };
