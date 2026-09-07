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
    ...(e.traits.length > 0 ? { trait: e.traits.map(titleCase).join(', ') } : {}),
    blazon: blazonFor(e.cardId, e.tribe, guard),
  };
}

export function titleCase(s: string): string {
  return s.length === 0 ? s : s[0]!.toUpperCase() + s.slice(1);
}

/** The glyph strip under a compressed card. See `TRAIT_GLYPH` for why it exists. */
const TRAIT_GLYPH: Readonly<Record<string, { glyph: string; title: string }>> = {
  relay: { glyph: '→', title: 'Relay - after acting, the unit to my right gains +2 Power this turn' },
  ward: { glyph: '◇', title: 'Ward - the unit to my right cannot be struck this turn' },
  wake: { glyph: '▲', title: 'Wake - when the unit to my left dies this turn, gain +2 Power' },
  guard: { glyph: '◆', title: 'Guard - while I live, attacks against my side must target a Guard' },
};

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

function paintCard(node: HTMLElement, card: CardView, width: number, mount: boolean): void {
  // Re-rasterising the SVG is the expensive part of a frame, so it is only
  // redone when something it draws has actually changed.
  const signature = `${card.id}|${card.power}|${card.health}|${card.guard}|${width}|${mount}`;
  if (node.dataset['sig'] === signature) return;
  node.dataset['sig'] = signature;
  node.innerHTML = renderCard(card, {
    tier: 'compressed',
    width,
    showCharge: true,
    label: true,
    mount,
  });
}

function paintTraits(
  node: HTMLElement,
  traits: readonly string[],
  width: number,
  pending = 0,
): void {
  const shown = traits.filter((t) => t !== 'guard');
  const signature = `${shown.join('+')}|${width}|${pending}`;
  if (node.dataset['sig'] === signature) return;
  node.dataset['sig'] = signature;
  node.textContent = '';
  for (const t of shown) {
    const def = TRAIT_GLYPH[t];
    if (def === undefined) continue;
    const pip = el('span', 'pip');
    pip.textContent = def.glyph;
    pip.title = def.title;
    node.append(pip);
  }
  if (pending > 0) {
    const pip = el('span', 'pip pip--pending');
    pip.textContent = `+${pending}`;
    pip.title = `A Relay on this line will give this unit +${pending} Power when the turn resolves`;
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
        paintCard(node.querySelector('.card__art') as HTMLElement, cardViewOf(e), width, opts.mount);
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
        paintCard(node.querySelector('.card__art') as HTMLElement, cardViewOf(e), width, opts.mount);
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
        hero.setAttribute(
          'aria-label',
          `${e.name}, hero, ${power(e)} power, ${Math.max(0, e.health)} of ${e.maxHealth} health`,
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
  node.title =
    p === 0
      ? 'Cannot be targeted while a Guard on this side lives'
      : `Each attack against this side has a ${pct(p)} chance of landing here`;
}

/** The expanded tier, for hover and inspect. Returns an SVG string. */
export function expandedCardOf(card: CardView): string {
  return renderCard(card, { tier: 'expanded', width: EXPANDED_W, label: true });
}

/** One compressed card on its own, for the hand. */
export function compressedCard(e: EntityView, width: number, mount: boolean): string {
  return renderCard(cardViewOf(e), { tier: 'compressed', width, showCharge: true, label: true, mount });
}

/** The trait glyphs a compressed card carries, for callers rendering their own. */
export function traitPips(traits: readonly string[]): { glyph: string; title: string }[] {
  const out: { glyph: string; title: string }[] = [];
  for (const t of traits) {
    if (t === 'guard') continue;
    const def = TRAIT_GLYPH[t];
    if (def !== undefined) out.push(def);
  }
  return out;
}
