/**
 * The sigil screens, and the marks a sigil leaves on the run's other screens.
 *
 * Three decisions and the places their results show:
 *
 *   hero sigil   a won elite or boss: two sigils the run does not hold, each
 *                saying exactly what it does at the numbers the fight will
 *                use, or none
 *   the shelf    a card sigil beside the cards on a won fight's shelf, drawn
 *                as a card-shaped button with the sigil's seal, so "card or
 *                sigil?" is one row of buttons
 *   attach       every deck card, the ones that can take the sigil lit and the
 *                rest disabled with the reason, because a sigil on a card that
 *                already has the trait would change nothing
 *
 * and then the HUD's chips for the hero's sigils, the deck panel's badges for
 * the sigilled cards, and the notice line that says what was taken. All HTML
 * strings, built the way `runapp.ts` builds its own screens, and every noun
 * from `render/sigil-terms.ts` so the shelf, the panel and the chips cannot
 * disagree about what a sigil is called or does.
 *
 * Nothing here advances the run. `runapp.ts` wires the buttons to the
 * controller, and the controller advances it through `replayRun` alone.
 */

import type { UnitCard } from '../engine/state.ts';
import { hasTrait } from '../run/deck.ts';
import { heldHeroSigils, sigilById } from '../run/nodes.ts';
import type { CardSigilDef, DeckCard, HeroSigilDef, RunContent, RunState } from '../run/types.ts';
import { STAT_TERMS, TRAIT_TERMS } from '../render/glossary.ts';
import { iconSvg } from '../render/icons.ts';
import { CARD_SIGIL_TERMS, SIGIL_TERM, heroEffectWords } from '../render/sigil-terms.ts';
import type { NodeOutcome, RunPhase } from './run.ts';

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) =>
    c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;' : '&quot;',
  );
}

/** The one line that says what a card sigil does when attached. */
function cardSigilWords(sigil: CardSigilDef): string {
  const trait = TRAIT_TERMS[sigil.trait];
  return `Attach to one card in your deck: it gains ${trait.name} for the rest of the run. ${trait.line}`;
}

/**
 * The hero sigil offer. Each option says what it does at the amount in force
 * - "+3 instead of +2" - and declining is its own button, because a run where
 * you cannot decline has one fewer decision.
 */
export function heroSigilOfferHtml(p: Extract<RunPhase, { kind: 'sigil' }>, state: RunState): string {
  const f = p.outcome.fight;
  const held = heldHeroSigils(state);
  return (
    `<h2 class="run__title">${iconSvg('sigil', { size: 22, decorative: true })} ${esc(p.encounter.name)} beaten — a hero ${SIGIL_TERM.name.toLowerCase()}</h2>` +
    `<p class="run__lead">Won in ${f.round} round${f.round === 1 ? '' : 's'}. Your hero stands at <b>${p.healthAfter}</b> of ${p.maxHealthAfter} ${STAT_TERMS.health.name}.` +
    ` <b>+${p.goldAfter - state.gold} gold</b> — you now have ${p.goldAfter}.</p>` +
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
 * exactly as it is at the forge.
 */
export function attachHtml(
  p: Extract<RunPhase, { kind: 'attach' }>,
  state: RunState,
  cardButton: (card: UnitCard, attrs: string, foot: string) => string,
  resolve: (dc: DeckCard) => UnitCard,
): string {
  const trait = TRAIT_TERMS[p.sigil.trait];
  const cards = state.deck
    .map((dc, i) => {
      const card = resolve(dc);
      const can = p.offers.includes(i);
      const why = can
        ? ''
        : hasTrait(state.content.pool, dc, p.sigil.trait)
          ? `already ${trait.name}`
          : 'cannot take it';
      return cardButton(
        card,
        `data-run="attach" data-index="${i}"${can ? '' : ' disabled'}`,
        (sigilMarks(dc, state.content).length > 0
          ? `<span class="runcard__sigil">${esc(sigilMarks(dc, state.content))}</span>`
          : '') + (can ? '' : `<span class="runcard__price is-short">${esc(why)}</span>`),
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

/** The hero's sigils as HUD chips, each with its effect on hover. Empty when none. */
export function heroSigilChips(state: RunState): string {
  const held = heldHeroSigils(state);
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
