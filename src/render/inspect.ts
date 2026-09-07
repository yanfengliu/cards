/**
 * The panel that explains a card completely.
 *
 * The board is the compressed tier: an outline, a field tincture, two numerals,
 * a strip of trait icons. Every one of those is a symbol, and until this panel
 * existed the meaning of every one of them lived in `docs/design/game.md` -
 * which is to say, nowhere a player will ever look. The owner asking what
 * "Wake" and "hue" meant is not a lapse of memory; it is the card failing to
 * say.
 *
 * The rule this file implements: **nothing drawn on a card is left unnamed.**
 * Power, Health, Energy, Armour, target chance, race, field tincture, charge,
 * card shape, and every trait by name - each gets its icon, its name and a plain
 * sentence, all out of `glossary.ts`, which is keyed off the engine's own types
 * so it cannot describe a rule the game no longer has.
 *
 * One thing here is not drawn on the card and is explained anyway: the trade.
 * Combat is mutual, so a card's Power is also what it deals back, and the cost
 * of attacking is invisible on a board that draws only the numbers. A rule the
 * player can only meet by losing a unit to it is exactly the case this panel
 * exists for.
 *
 * Height is a design constraint here, not an afterthought. The panel has to fit
 * in the space *between* the two lines of the board or below them, because a
 * panel that explains one card by hiding the rest of the board has answered the
 * question by deleting it. So the four numbers share one strip and one sentence,
 * with each chip carrying its own full sentence on hover, and the three heraldry
 * channels share one block. What used to be nine paragraphs is five.
 *
 * `ARCHITECTURE.md`'s division still holds: nothing *required for a turn
 * decision* lives only here. Everything here is also on the card as a numeral, a
 * shape or a pip. This tier is where those become sentences.
 */

import type { Trait } from '../engine/state.ts';
import { type EntityView, power } from './view.ts';
import { type CardView, renderCard } from './heraldry/card.ts';
import { parseBlazon } from './heraldry/blazon.ts';
import { hexOf } from './heraldry/tinctures.ts';
import { iconSvg, type IconName } from './icons.ts';
import {
  HERALDRY_TERMS,
  NUMBERS_SUMMARY,
  POSITION_HERO,
  POSITION_UNIT,
  RACE_HAS_NO_RULE,
  RETALIATION_HERO,
  RETALIATION_UNIT,
  STAT_TERMS,
  TINCTURE_TERMS,
  TRAIT_TERMS,
  type Term,
  chargeName,
  hatchWords,
  tribeTerm,
} from './glossary.ts';

/** The art width inside the panel. Big enough for the charge to be a picture. */
export const INSPECT_ART_W = 116;

export interface InspectContext {
  /** Chance the next enemy attack lands on this entity, or null when not shown. */
  readonly chance: number | null;
  /** Power a Relay on this line will hand it when the turn resolves. */
  readonly pendingPower: number;
  readonly hatch: boolean;
  /** Formats a probability the way the board does, so the two never disagree. */
  readonly pct: (p: number) => string;
}

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) =>
    c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;' : '&quot;',
  );
}

/**
 * One number, as a chip.
 *
 * The chip shows the icon, the value *and* the word - "2 Power", never a sword
 * and a 2 - so the icon is decorative and the meaning survives a reader who
 * cannot see it, a printout, and a player who has never met this game. The full
 * sentence is on `title` for the pointer and on `aria-label` for everyone else.
 */
function chip(term: Term, value: string, cls = ''): string {
  const label = `${value} ${term.name}. ${term.line}`;
  return (
    `<span class="xp__chip ${cls}" title="${esc(label)}" role="img" aria-label="${esc(label)}">` +
    iconSvg(term.icon, { size: 13, decorative: true }) +
    `<b>${value}</b><span class="xp__unit">${esc(term.name)}</span></span>`
  );
}

/** One explained rule: icon, name, sentence. Traits and warnings look like this. */
function rule(icon: IconName, name: string, line: string, cls = ''): string {
  return (
    `<li class="xp__rule ${cls}">` +
    iconSvg(icon, { size: 15, decorative: true }) +
    `<span><b>${esc(name)}</b> — ${esc(line)}</span>` +
    '</li>'
  );
}

/** One line of the "how this card is drawn" block: channel, value, meaning. */
function channel(icon: IconName | 'swatch', swatchHex: string, name: string, value: string, why: string): string {
  const mark =
    icon === 'swatch'
      ? `<span class="xp__swatch" style="background:${swatchHex}" aria-hidden="true"></span>`
      : iconSvg(icon, { size: 13, decorative: true });
  return (
    `<li class="xp__channel">${mark}` +
    `<span class="xp__cname">${esc(name)}</span>` +
    `<span class="xp__cval">${esc(value)}</span>` +
    `<span class="xp__cwhy">${esc(why)}</span></li>`
  );
}

function traitRule(trait: Trait): string {
  const term = TRAIT_TERMS[trait];
  return rule(term.icon, term.name, term.line, 'xp__rule--trait');
}

/**
 * Everything one card is, as HTML.
 *
 * Heroes come through the same function. A hero plate draws a crest, a name, two
 * numerals and a health bar, and every one of those was as unexplained as a
 * unit's - and the hero is the card whose Health *is* the fight.
 */
export function explainCard(e: EntityView, card: CardView, ctx: InspectContext): string {
  const blazon = parseBlazon(card.blazon);
  const tincture = TINCTURE_TERMS[blazon.field];
  const tribe = tribeTerm(e.tribe);
  const guard = e.traits.includes('guard');

  const art = `<div class="xp__art">${renderCard(card, {
    tier: 'expanded',
    width: INSPECT_ART_W,
    label: false,
    ...(ctx.hatch ? { hatch: true } : {}),
  })}</div>`;

  // ---- the numbers, as one strip
  const chips: string[] = [
    chip(STAT_TERMS.power, String(power(e))),
    chip(STAT_TERMS.health, `${Math.max(0, e.health)}/${e.maxHealth}`),
  ];
  if (e.armour > 0) chips.push(chip(STAT_TERMS.armour, String(e.armour)));
  if (!e.isHero) chips.push(chip(STAT_TERMS.cost, String(e.cost)));
  if (ctx.chance !== null && e.alive) {
    chips.push(chip(STAT_TERMS.target, ctx.pct(ctx.chance), ctx.chance === 0 ? 'is-safe' : ''));
  }

  // One line under the strip, not five: every chip carries its own full rule on
  // `title` and `aria-label`, and the panel's height is what decides whether it
  // can be placed without covering the board.
  //
  // The trade rides here rather than in a rule row of its own. It is the one
  // thing about a card's Power that the board never draws - the number is on the
  // card, "and it is also what comes back at you" is not - and a row for it
  // costs 54px against a panel that has none to spare. Two sentences at most, so
  // the paragraph stays the two lines it already was: `glossary.ts` carries the
  // measurement, and it is the Guard case that is nearest the wrap.
  const trade = e.isHero ? RETALIATION_HERO : RETALIATION_UNIT;
  const numbersLine =
    ctx.chance === 0 && e.alive
      ? `A Guard on this side is alive, so nothing behind it can be targeted at all. ${trade}`
      : `${trade} ${NUMBERS_SUMMARY}`;

  // ---- the rules
  const rules: string[] = [];
  if (ctx.pendingPower > 0) {
    rules.push(
      rule(
        'relay',
        `Incoming +${ctx.pendingPower} Power`,
        'A Relay standing to its left will hand it this much when you commit the turn. The printed number does not change.',
        'xp__rule--pending',
      ),
    );
  }
  for (const t of e.traits) rules.push(traitRule(t));
  if (e.traits.length === 0) {
    rules.push(
      rule(
        'blank',
        'No trait',
        e.isHero
          ? 'Heroes carry no trait. Yours acts after every unit on your line.'
          : 'Nothing triggers off this one. Where it stands still matters — it changes who the enemy can hit.',
      ),
    );
  }
  rules.push(
    rule(
      'position',
      HERALDRY_TERMS.position.name,
      e.isHero ? POSITION_HERO : POSITION_UNIT,
    ),
  );

  // ---- how it is drawn: the four heraldic channels, one line each
  const channels: string[] = [
    channel(
      'swatch',
      hexOf(blazon.field),
      HERALDRY_TERMS.field.name,
      `${tincture.name} (${tincture.plain})`,
      `race: ${tribe.name} · ${ctx.hatch ? 'ruled' : 'hatching'}: ${hatchWords(blazon.field)}`,
    ),
  ];
  if (blazon.charge !== undefined) {
    channels.push(
      channel('charge', '', HERALDRY_TERMS.charge.name, chargeName(blazon.charge.id), 'this card alone'),
    );
  }
  channels.push(
    channel(
      'guard',
      '',
      HERALDRY_TERMS.silhouette.name,
      guard ? 'shield, heavy border' : 'plain rectangle',
      guard ? 'this is a Guard' : 'not a Guard',
    ),
  );

  // The race's own flavour goes on the badge rather than into the body: it is
  // the least load-bearing sentence in the panel and the panel is fighting for
  // vertical space with the board.
  const head =
    '<div class="xp__head">' +
    `<span class="xp__name">${esc(e.name)}</span>` +
    `<span class="xp__kind" title="${esc(`${tribe.name}. ${tribe.line}`)}">` +
    iconSvg(tribe.icon, { size: 12, decorative: true }) +
    `${esc(e.isHero ? (e.side === 'player' ? 'Your hero' : 'Enemy hero') : `${tribe.name} unit`)}</span>` +
    '</div>';

  return (
    art +
    '<div class="xp__text">' +
    head +
    `<div class="xp__chips">${chips.join('')}</div>` +
    `<p class="xp__gloss">${esc(numbersLine)}</p>` +
    `<ul class="xp__rules">${rules.join('')}</ul>` +
    `<ul class="xp__channels">${channels.join('')}</ul>` +
    `<p class="xp__note">${esc(RACE_HAS_NO_RULE)}</p>` +
    '</div>'
  );
}
