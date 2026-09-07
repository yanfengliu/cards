/**
 * The board, as DOM.
 *
 * `ARCHITECTURE.md`: DOM and CSS, not Canvas - cards are rectangles with text,
 * which is what the DOM is best at - and:
 *
 *   > The unlimited board must compress, never wrap.
 *
 * That is enforced twice over here, because it is the one layout bug that makes
 * the game unplayable rather than ugly: the row is `flex-wrap: nowrap` in CSS,
 * and the card width is *computed* from the container and the number of cards
 * (`fitWidth`) so cards shrink toward a 44px floor instead of pushing the row
 * wider. The moment "the unit to my right" is on a second line, every adjacency
 * trait becomes unreadable.
 *
 * Elements are reconciled by key rather than rebuilt, so a card keeps its DOM
 * node across renders and CSS transitions on it survive.
 */

import { renderCard, type CardView } from './heraldry/card.ts';
import { blazonFor } from './blazons.ts';
import { type EntityView, power } from './view.ts';
import { pct } from './odds.ts';
import { iconSvg } from './icons.ts';
import { STAT_TERMS, TRAIT_TERMS } from './glossary.ts';

export const MIN_CARD_W = 44;
export const MAX_CARD_W = 92;
export const CARD_GAP = 6;
export const EXPANDED_W = 190;
/** Width of an armed drop slot, matching `.row.is-armed .slot` in `app.css`. */
export const SLOT_W = 30;

/**
 * One item in a rendered line, in board order. Heroes are the last item.
 *
 * A `ghost` is a card the player has placed but not yet committed. It carries a
 * real `EntityView` rather than a card template, because it is taken from a
 * *preview* board - the current fight cloned with the pending placements
 * applied - which is the only way the odds shown on it, and on everything
 * around it, are the odds that will actually be rolled. Dropping a Guard into
 * the line changes every target chance on that side, and a preview that ignored
 * the ghosts would show the player the odds for a board they are not going to
 * have.
 */
export type LineItem =
  | { readonly kind: 'unit'; readonly entity: EntityView }
  | { readonly kind: 'hero'; readonly entity: EntityView }
  | { readonly kind: 'ghost'; readonly id: number; readonly entity: EntityView }
  | { readonly kind: 'slot'; readonly index: number };

export type RowOptions = {
  /** Pixel width available to the row. */
  readonly available: number;
  /** Fixed card width; when absent it is fitted to `available`. */
  readonly cardWidth?: number;
  readonly mount: boolean;
  /**
   * Rule every field with its heraldic hatching, so tribe is carried by pattern
   * as well as by hue. Off by default; see `RenderOptions.hatch`.
   */
  readonly hatch?: boolean;
  /** uid -> chance the next enemy attack lands here. Null hides the badge. */
  readonly odds: ReadonlyMap<number, number> | null;
  /**
   * uid -> Power a Relay in this line will hand it when the turn resolves.
   *
   * Deliberately a *badge* rather than a bigger number in the Power disc. The
   * printed value has to stay printed: folding the forecast into it would make
   * the number drop back on commit and then climb again as the buff travels,
   * and a stat that moves backwards when you press the button is worse than one
   * that waits. The badge says the same thing and nothing reverses.
   */
  readonly pendingPower?: ReadonlyMap<number, number>;
  readonly resolving: boolean;
};

/**
 * The widest card that lets `count` cards and their gaps fit in `available`,
 * clamped to the reviewed legibility range. Below `MIN_CARD_W` the row is
 * allowed to overflow and scroll horizontally rather than wrap: a scrollbar
 * costs the player a drag, a second row costs them the rules.
 */
export function fitWidth(available: number, count: number): number {
  if (count <= 0) return MAX_CARD_W;
  const per = (available - CARD_GAP * (count - 1)) / count;
  return Math.max(MIN_CARD_W, Math.min(MAX_CARD_W, Math.floor(per)));
}

export function cardViewOf(e: EntityView): CardView {
  const guard = e.traits.includes('guard');
  return {
    id: e.cardId,
    name: e.name,
    tribe: e.tribe,
    power: power(e),
    health: Math.max(0, e.health),
    guard,
    // Not painted; they are what the card's `aria-label` needs so the spoken
    // card says everything the drawn card says.
    cost: e.cost,
    armour: e.armour,
    ...(e.traits.length > 0 ? { trait: e.traits.map(titleCase).join(', ') } : {}),
    blazon: blazonFor(e.cardId, e.tribe, guard),
  };
}

export function titleCase(s: string): string {
  return s.length === 0 ? s : s[0]!.toUpperCase() + s.slice(1);
}

/**
 * The trait strip under a compressed card.
 *
 * Derived from `glossary.ts` rather than written here, which is the whole point:
 * the icon a card wears and the sentence the hover panel gives for it come out
 * of one table keyed by the engine's own `Trait` union, so a trait deleted from
 * the engine cannot survive as a pip whose tooltip describes a rule the game no
 * longer has.
 *
 * Guard is excluded because Guard is already the card's *shape* - a Guard is
 * drawn as a shield with a heavy bordure, per `ARCHITECTURE.md`'s channel table
 * - and a pip repeating it would spend the strip's only room on the one trait
 * that does not need it.
 */
function traitPipsOf(traits: readonly string[]): { name: string; icon: string; title: string }[] {
  const out: { name: string; icon: string; title: string }[] = [];
  for (const t of traits) {
    if (t === 'guard') continue;
    const term = (TRAIT_TERMS as Readonly<Record<string, { name: string; icon: string; line: string } | undefined>>)[t];
    if (term === undefined) continue;
    out.push({ name: term.name, icon: term.icon, title: `${term.name} — ${term.line}` });
  }
  return out;
}

/**
 * Icon size for the strip under a card `width` px wide.
 *
 * The floor is the constraint. At `MIN_CARD_W` the row is already at the width
 * `ARCHITECTURE.md`'s compression rule bottoms out at, and a strip that grows
 * past the card pushes the row into a scroll it does not need. A pip is the icon
 * plus 4px of padding and 2px of border, so two pips and their gap must fit in
 * the card: `2 * (icon + 6) + 3 <= width`.
 */
export function pipIconSize(width: number): number {
  return Math.max(9, Math.min(13, Math.floor((width - 3) / 2) - 6));
}

function el(tag: string, cls: string): HTMLElement {
  const node = document.createElement(tag);
  node.className = cls;
  return node;
}

/**
 * Match `container`'s children to `keys`, creating what is missing, removing
 * what is gone and moving the rest into order. Keeping a card's element across
 * renders is what lets CSS animate it - a rebuilt node restarts every
 * transition and the buff pulse would never be seen.
 */
export function reconcile(
  container: HTMLElement,
  keys: readonly string[],
  make: (key: string) => HTMLElement,
): HTMLElement[] {
  const existing = new Map<string, HTMLElement>();
  for (const child of Array.from(container.children)) {
    const node = child as HTMLElement;
    const key = node.dataset['key'];
    if (key !== undefined) existing.set(key, node);
    else node.remove();
  }
  const out: HTMLElement[] = [];
  for (const key of keys) {
    let node = existing.get(key);
    if (node === undefined) {
      node = make(key);
      node.dataset['key'] = key;
    }
    existing.delete(key);
    out.push(node);
  }
  for (const stale of existing.values()) stale.remove();
  keys.forEach((_key, i) => {
    const want = out[i]!;
    if (container.children[i] !== want) {
      container.insertBefore(want, container.children[i] ?? null);
    }
  });
  return out;
}

function keyOf(item: LineItem): string {
  switch (item.kind) {
    case 'unit':
    case 'hero':
      return `u:${item.entity.uid}`;
    case 'ghost':
      return `g:${item.id}`;
    case 'slot':
      return `s:${item.index}`;
  }
}

function paintCard(
  node: HTMLElement,
  card: CardView,
  width: number,
  mount: boolean,
  hatch: boolean,
): void {
  // Re-rasterising the SVG is the expensive part of a frame, so it is only
  // redone when something it draws *or says* has actually changed. Cost, armour
  // and the trait list are in the signature because they are in the
  // `aria-label`: a node recycled onto a different card would otherwise keep
  // announcing the previous one.
  const signature =
    `${card.id}|${card.power}|${card.health}|${card.guard}|${card.cost ?? ''}|` +
    `${card.armour ?? ''}|${card.trait ?? ''}|${width}|${mount}|${hatch}`;
  if (node.dataset['sig'] === signature) return;
  node.dataset['sig'] = signature;
  node.innerHTML = renderCard(card, {
    tier: 'compressed',
    width,
    showCharge: true,
    label: true,
    mount,
    ...(hatch ? { hatch: true } : {}),
  });
}

function paintTraits(
  node: HTMLElement,
  traits: readonly string[],
  width: number,
  pending = 0,
): void {
  const pips = traitPipsOf(traits);
  const size = pipIconSize(width);
  const signature = `${pips.map((p) => p.name).join('+')}|${size}|${pending}`;
  if (node.dataset['sig'] === signature) return;
  node.dataset['sig'] = signature;
  node.textContent = '';
  for (const p of pips) {
    const pip = el('span', 'pip');
    // `title` for the pointer, `aria-label` for the reader, and the same words
    // in both. The icon is never the only place the rule is written: the hover
    // panel spells it out in full, and this is its short form.
    pip.title = p.title;
    pip.setAttribute('aria-label', p.title);
    pip.setAttribute('role', 'img');
    pip.innerHTML = iconSvg(p.icon as Parameters<typeof iconSvg>[0], {
      size,
      decorative: true,
    });
    node.append(pip);
  }
  if (pending > 0) {
    const pip = el('span', 'pip pip--pending');
    pip.textContent = `+${pending}`;
    const title =
      `${TRAIT_TERMS.relay.name} incoming — a Relay on this line will give this unit ` +
      `+${pending} ${STAT_TERMS.power.name} when the turn resolves`;
    pip.title = title;
    pip.setAttribute('aria-label', title);
    node.append(pip);
  }
}

function buildUnit(): HTMLElement {
  const node = el('div', 'card');
  node.append(el('div', 'card__art'), el('div', 'card__pips'), el('div', 'card__odds'));
  node.tabIndex = 0;
  return node;
}

function buildHero(): HTMLElement {
  const node = el('div', 'hero');
  const crest = el('div', 'hero__crest');
  const name = el('div', 'hero__name');
  const stats = el('div', 'hero__stats');
  stats.append(el('span', 'hero__pw'), el('span', 'hero__hp'));
  const bar = el('div', 'hero__bar');
  bar.append(el('i', ''));
  node.append(crest, name, stats, bar, el('div', 'card__odds'));
  node.tabIndex = 0;
  return node;
}

function buildGhost(): HTMLElement {
  const node = el('div', 'card card--ghost');
  node.append(
    el('div', 'card__art'),
    el('div', 'card__pips'),
    el('div', 'card__odds'),
    el('div', 'card__pull'),
  );
  const pull = node.querySelector('.card__pull') as HTMLElement;
  pull.textContent = '×';
  pull.title = 'Take this card back';
  node.tabIndex = 0;
  return node;
}

function buildSlot(): HTMLElement {
  const node = el('button', 'slot');
  node.setAttribute('type', 'button');
  node.append(el('span', 'slot__mark'));
  (node.querySelector('.slot__mark') as HTMLElement).textContent = '+';
  return node;
}

export function renderRow(container: HTMLElement, items: readonly LineItem[], opts: RowOptions): number {
  const cards = items.filter((i) => i.kind !== 'slot').length;
  const slots = items.length - cards;
  // Slots are only rendered while a card is selected, and an armed slot is
  // `SLOT_W` wide plus its gap. Charging the cards for that is what stops the
  // row from overflowing the instant the player picks a card up.
  const budget = (extra: number): number =>
    fitWidth(opts.available - slots * (CARD_GAP + SLOT_W) - extra, Math.max(1, cards));
  let width = opts.cardWidth ?? budget(0);

  container.classList.toggle('is-resolving', opts.resolving);

  const nodes = reconcile(container, items.map(keyOf), (key) => {
    if (key.startsWith('s:')) return buildSlot();
    if (key.startsWith('g:')) return buildGhost();
    return key.startsWith('u:') ? buildUnit() : buildUnit();
  });

  paintItems(container, nodes, items, width, opts);

  /*
   * One corrective pass, measured rather than predicted.
   *
   * `fitWidth` knows about cards and gaps. It does not know about the row's own
   * padding, the hero plate's separator margin, or the hero's minimum width -
   * and every one of those is a CSS number that can move without this file
   * hearing about it. Guessing a constant for them would be wrong the first
   * time the stylesheet changed. So the row is laid out, the real overflow is
   * read back, and the cards are re-fitted once with that number subtracted.
   * Bounded at one retry, and skipped entirely once the cards are at the
   * legibility floor - past that point the row is *meant* to scroll rather than
   * shrink further.
   */
  if (opts.cardWidth === undefined && width > MIN_CARD_W) {
    const over = container.scrollWidth - container.clientWidth;
    if (over > 0) {
      const shrunk = budget(over);
      if (shrunk < width) {
        width = shrunk;
        paintItems(container, nodes, items, width, opts);
      }
    }
  }

  return width;
}

function paintItems(
  container: HTMLElement,
  nodes: HTMLElement[],
  items: readonly LineItem[],
  width: number,
  opts: RowOptions,
): void {
  container.style.setProperty('--card-w', `${width}px`);
  items.forEach((item, i) => {
    const node = nodes[i]!;
    switch (item.kind) {
      case 'slot': {
        node.dataset['index'] = String(item.index);
        // Named, because a slot is a real button with no text in it: the
        // accessibility tree showed a row of anonymous `button` entries, which
        // is what a screen reader would have read out for the only decision the
        // game asks the player to make.
        const total = items.filter((x) => x.kind === 'slot').length;
        node.setAttribute(
          'aria-label',
          item.index === total - 1
            ? `Place here, at the right end of the line, next to your hero`
            : `Place here, at position ${item.index + 1} of ${total}`,
        );
        break;
      }
      case 'ghost': {
        const e = item.entity;
        node.style.setProperty('--w', `${width}px`);
        node.dataset['ghost'] = String(item.id);
        node.dataset['uid'] = String(e.uid);
        paintCard(
          node.querySelector('.card__art') as HTMLElement,
          cardViewOf(e),
          width,
          opts.mount,
          opts.hatch === true,
        );
        paintTraits(
          node.querySelector('.card__pips') as HTMLElement,
          e.traits,
          width,
          opts.pendingPower?.get(e.uid) ?? 0,
        );
        paintOdds(node.querySelector('.card__odds') as HTMLElement, opts.odds, e);
        break;
      }
      case 'unit': {
        const e = item.entity;
        node.style.setProperty('--w', `${width}px`);
        node.dataset['uid'] = String(e.uid);
        // A hero element and a unit element share the `u:` key space, so a
        // recycled node has to be told which it is on every pass.
        node.classList.toggle('is-acting', e.acting);
        node.classList.toggle('is-dead', !e.alive);
        node.classList.toggle('is-warded', e.warded);
        node.classList.toggle('is-buffed', e.bonusPower > 0);
        paintCard(
          node.querySelector('.card__art') as HTMLElement,
          cardViewOf(e),
          width,
          opts.mount,
          opts.hatch === true,
        );
        paintTraits(
          node.querySelector('.card__pips') as HTMLElement,
          e.traits,
          width,
          opts.pendingPower?.get(e.uid) ?? 0,
        );
        paintOdds(node.querySelector('.card__odds') as HTMLElement, opts.odds, e);
        break;
      }
      case 'hero': {
        const e = item.entity;
        if (!node.classList.contains('hero')) {
          const fresh = buildHero();
          fresh.dataset['key'] = keyOf(item);
          node.replaceWith(fresh);
          nodes[i] = fresh;
        }
        const hero = nodes[i]!;
        hero.style.setProperty('--w', `${Math.max(width, 76)}px`);
        hero.dataset['uid'] = String(e.uid);
        hero.classList.toggle('is-acting', e.acting);
        hero.classList.toggle('is-dead', !e.alive);
        hero.classList.toggle('is-warded', e.warded);
        hero.classList.toggle('is-buffed', e.bonusPower > 0);
        hero.classList.toggle('hero--enemy', e.side === 'enemy');
        (hero.querySelector('.hero__crest') as HTMLElement).textContent = '♗';
        (hero.querySelector('.hero__name') as HTMLElement).textContent = e.name;
        (hero.querySelector('.hero__pw') as HTMLElement).textContent = String(power(e));
        (hero.querySelector('.hero__hp') as HTMLElement).textContent = String(Math.max(0, e.health));
        const frac = Math.max(0, e.health) / Math.max(1, e.maxHealth);
        (hero.querySelector('.hero__bar i') as HTMLElement).style.width = `${frac * 100}%`;
        // Extended rather than replaced: the original wording is what a reader
        // already learns this board by. Armour and the side are added because
        // they are drawn - the plate's border colour is the only thing that
        // says whose hero this is, and colour is not a channel a reader has.
        hero.setAttribute(
          'aria-label',
          [
            e.name,
            e.side === 'player' ? 'your hero' : 'enemy hero',
            `${power(e)} power`,
            `${Math.max(0, e.health)} of ${e.maxHealth} health`,
            ...(e.armour > 0 ? [`${e.armour} armour`] : []),
            'acts last on its line',
          ].join(', '),
        );
        paintOdds(hero.querySelector('.card__odds') as HTMLElement, opts.odds, e);
        break;
      }
    }
  });
}

function paintOdds(
  node: HTMLElement,
  odds: ReadonlyMap<number, number> | null,
  e: EntityView,
): void {
  if (odds === null || !e.alive) {
    node.hidden = true;
    return;
  }
  const p = odds.get(e.uid) ?? 0;
  node.hidden = false;
  node.textContent = pct(p);
  node.classList.toggle('is-safe', p === 0);
  const title =
    p === 0
      ? `${STAT_TERMS.target.name}: none. Cannot be targeted while a Guard on this side lives.`
      : `${STAT_TERMS.target.name}: each attack against this side has a ${pct(p)} chance of landing here.`;
  node.title = title;
  // The badge is a bare number on the board. Named here so a reader is told
  // what the number is a number *of*.
  node.setAttribute('aria-label', title);
}

/** The expanded tier, for hover and inspect. Returns an SVG string. */
export function expandedCardOf(card: CardView, hatch = false): string {
  return renderCard(card, {
    tier: 'expanded',
    width: EXPANDED_W,
    label: true,
    ...(hatch ? { hatch: true } : {}),
  });
}

/** One compressed card on its own, for the hand. */
export function compressedCard(
  e: EntityView,
  width: number,
  mount: boolean,
  hatch = false,
): string {
  return renderCard(cardViewOf(e), {
    tier: 'compressed',
    width,
    showCharge: true,
    label: true,
    mount,
    ...(hatch ? { hatch: true } : {}),
  });
}

/**
 * The trait pips a compressed card carries, for callers rendering their own -
 * the hand's hint line reads this so the strip and the sentence never disagree.
 */
export function traitPips(traits: readonly string[]): { name: string; icon: string; title: string }[] {
  return traitPipsOf(traits);
}
