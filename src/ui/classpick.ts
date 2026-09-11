/**
 * The class pick: the first screen of a run.
 *
 * `docs/design/game.md`: "The player picks a class - Knight, Mage, Ranger -
 * which sets the starting deck and the card pool." So the screen shows, for
 * each class, exactly the three things the pick decides - the hero, the
 * starting deck, and what the pool leans to - and one button. Nothing here
 * advances anything: `runapp.ts` hears the button and starts the run.
 *
 * Every choice shows its consequences before commit, in `ARCHITECTURE.md`'s
 * sense. The hero's Health and swing are the class's own numbers, the
 * sentence about the swing is written from them by `class-terms.ts`, and the
 * starting deck is drawn card by card so a player can hover any of them and
 * read it in full before choosing.
 */

import type { ClassDef } from '../content/classes.ts';
import type { CardPool } from '../engine/state.ts';
import { compressedCard } from '../render/board.ts';
import { CLASS_TERMS } from '../render/class-terms.ts';
import { STAT_TERMS, TRAIT_TERMS } from '../render/glossary.ts';
import { iconSvg } from '../render/icons.ts';
import { cardEntityView } from '../render/view.ts';
import { escapeHtml as esc } from '../render/escape.ts';

export type ClassPickOptions = {
  readonly seed: number;
  readonly classes: readonly ClassDef[];
  /** Resolves the deck's card ids to cards, for the mini cards and their labels. */
  readonly pool: CardPool;
  readonly mount: boolean;
  readonly hatch: boolean;
};

/** The deck as distinct cards with a count, in the order they first appear. */
function grouped(deck: readonly string[]): { id: string; count: number }[] {
  const out: { id: string; count: number }[] = [];
  for (const id of deck) {
    const hit = out.find((g) => g.id === id);
    if (hit === undefined) out.push({ id, count: 1 });
    else hit.count++;
  }
  return out;
}

function classCard(cls: ClassDef, opts: ClassPickOptions): string {
  const term = CLASS_TERMS[cls.id];
  const hero = cls.hero;
  const traits = (hero.traits ?? []).map((t) => TRAIT_TERMS[t]);
  const deck = grouped(cls.startingDeck)
    .map(({ id, count }) => {
      const card = opts.pool.card(id);
      const label =
        `${count} × ${card.name}, ${card.power} ${STAT_TERMS.power.name}, ${card.health} ` +
        `${STAT_TERMS.health.name}, ${card.cost} ${STAT_TERMS.cost.name}` +
        (card.traits.length > 0 ? `, ${card.traits.map((t) => TRAIT_TERMS[t].name).join(', ')}` : '');
      return (
        `<span class="runcard runcard--mini" data-card-id="${esc(id)}" tabindex="0" aria-label="${esc(label)}">` +
        `<span class="card__art">${compressedCard(cardEntityView(card), 52, opts.mount, opts.hatch)}</span>` +
        `<span class="runcard__forged classcard__count" aria-hidden="true">×${count}</span>` +
        '</span>'
      );
    })
    .join('');
  const poolNames = cls.rewards.map((r) => opts.pool.card(r.cardId).name);
  const swingWords =
    `${hero.power} ${STAT_TERMS.power.name}` +
    (traits.length > 0 ? `, ${traits.map((t) => t.name).join(', ')}` : '');

  return (
    `<div class="classcard" data-class-card="${cls.id}">` +
    `<div class="classcard__head">` +
    `<span class="classcard__crest">${iconSvg(term.icon, { size: 30, decorative: true })}</span>` +
    `<span class="classcard__name">${esc(cls.name)}</span>` +
    `<span class="classcard__hero">${hero.health} ${STAT_TERMS.health.name} · ${esc(swingWords)}</span>` +
    '</div>' +
    `<p class="classcard__swing">${esc(term.swing(hero.power))}</p>` +
    `<h3 class="run__h">${iconSvg('deck', { size: 14, decorative: true })} Starts with ${cls.startingDeck.length} cards</h3>` +
    `<div class="run__deckgrid run__deckgrid--small classcard__deck">${deck}</div>` +
    `<h3 class="run__h">${iconSvg('shop', { size: 14, decorative: true })} Drafts from ${cls.rewards.length} cards</h3>` +
    `<p class="classcard__pool">${esc(term.pool)}</p>` +
    `<p class="run__muted classcard__poollist">${esc(poolNames.join(', '))}.</p>` +
    `<p class="classcard__act"><button type="button" class="btn--primary" data-run="pick-class" data-class="${cls.id}"` +
    ` aria-label="${esc(`Play the ${cls.name}: ${hero.health} Health, ${swingWords}, ${cls.startingDeck.length} cards`)}">` +
    `Play the ${esc(cls.name)}</button></p>` +
    '</div>'
  );
}

/** The whole screen, as HTML for `#run-node`. */
export function renderClassPick(opts: ClassPickOptions): string {
  return (
    `<h2 class="run__title">${iconSvg('hero', { size: 22, decorative: true })} Choose your class</h2>` +
    `<p class="run__lead">A class is your hero, your starting deck and the pool you draft from. ` +
    `Every race runs through every pool — which tribe you build toward is decided on the road, by what the run offers.</p>` +
    `<p class="run__muted">Seed ${opts.seed}. The map and every fight on it are the seed's alone; the class changes what you bring to them. Hover a card to read it.</p>` +
    `<div class="classpick">${opts.classes.map((cls) => classCard(cls, opts)).join('')}</div>`
  );
}
