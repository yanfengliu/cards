/**
 * The game, as a screen.
 *
 * Three modes and one loop:
 *
 *   planning   the hand is drawn, energy is unspent, and every placement is a
 *              ghost the player can take back. Nothing has been committed, so
 *              the odds shown are the odds of the board *as they would be* -
 *              the preview is the fight cloned with the pending placements
 *              applied, which is the only honest way to answer "what happens if
 *              I put the Guard here".
 *   resolving  the committed round is already fully resolved in the engine; the
 *              screen replays its event stream one beat at a time.
 *   over       a hero is at zero, or the round cap ran out.
 *
 * The engine is never asked to be interactive. A committed round is resolved in
 * full by `session.commitRound`, and what the player watches is a replay of the
 * events it produced against a view this layer owns. That is what keeps the
 * animation out of the determinism story entirely: pause it, speed it up, skip
 * it, and the fight is the same fight.
 */

import { type Fight, type Placement, setupFight, cloneFight, applyPlacements } from '../engine/fight.ts';
import { heroOf, type GameState, type UnitCard } from '../engine/state.ts';
import {
  CARD_POOL,
  ENCOUNTERS,
  ENERGY_PER_TURN,
  MAX_ROUNDS,
  PLAYER_DECK,
  PLAYER_HERO,
  ENEMY_DECK,
  PRIMARY_ENCOUNTER,
  encounterById,
} from '../content/cards.ts';
import {
  type LineItem as PlanItem,
  beginRound,
  commitRound,
  lineCost,
  placementsFrom,
} from './session.ts';
import { type Beat, type BoardView, type EntityView, findView, snapshot, applyBeat, buildBeats, viewDrift } from '../render/view.ts';
import {
  type LineItem,
  cardViewOf,
  compressedCard,
  fitWidth,
  renderRow,
} from '../render/board.ts';
import { explainCard } from '../render/inspect.ts';
import { STAT_TERMS, TRAIT_TERMS, tribeTerm } from '../render/glossary.ts';
import { incomingOdds, pct, projectOwnPhase } from '../render/odds.ts';
import { type Playback, type Step, play, schedule } from '../render/anim.ts';
import { makeFx } from '../render/fx.ts';
import { type Intent, wireInput } from './input.ts';

type Mode = 'planning' | 'resolving' | 'over';

/**
 * A trait's rule, in one sentence, from the one table that has them.
 *
 * This used to be a copy of the rules written out in this file, which is how
 * two of them came to disagree with the resolver's own numbers. `glossary.ts` is
 * keyed by the engine's `Trait` union and reads `RELAY_POWER`/`WAKE_POWER` out
 * of the resolver, so a trait that is deleted from the engine stops compiling
 * here rather than lingering as a sentence about a rule the game no longer has.
 */
function traitRule(trait: string): string | null {
  const term = (TRAIT_TERMS as Readonly<Record<string, { name: string; line: string } | undefined>>)[
    trait
  ];
  return term === undefined ? null : `<b>${term.name}</b> — ${term.line}`;
}

function need<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (node === null) {
    throw new Error(
      `ui: no element with id "${id}" in index.html. The app cannot bind its board to a page ` +
        `that does not have it; add the element or fix the id.`,
    );
  }
  return node as T;
}

export function startApp(): void {
  const dom = {
    app: need<HTMLElement>('app'),
    subtitle: need<HTMLElement>('subtitle'),
    seed: need<HTMLInputElement>('seed'),
    encounter: need<HTMLSelectElement>('encounter'),
    enemyName: need<HTMLElement>('enemy-name'),
    enemyIntent: need<HTMLElement>('enemy-intent'),
    playerIntent: need<HTMLElement>('player-intent'),
    enemyRow: need<HTMLElement>('enemy-row'),
    playerRow: need<HTMLElement>('player-row'),
    sideEnemy: need<HTMLElement>('side-enemy'),
    sidePlayer: need<HTMLElement>('side-player'),
    log: need<HTMLElement>('log'),
    hand: need<HTMLElement>('hand'),
    energy: need<HTMLElement>('energy'),
    hint: need<HTMLElement>('hint'),
    commit: need<HTMLButtonElement>('commit'),
    skip: need<HTMLButtonElement>('skip'),
    banner: need<HTMLElement>('banner-slot'),
    fx: need<HTMLElement>('fx'),
    inspect: need<HTMLElement>('inspect'),
  };

  const fx = makeFx(dom.fx);

  /*
   * The fight is addressable: `?seed=12&encounter=hard` opens exactly that
   * fight. `ARCHITECTURE.md` makes a seed plus an action list the whole bug
   * report, and a link is the cheapest possible way to hand one over.
   */
  const params = new URLSearchParams(globalThis.location.search);
  const seedParam = Number.parseInt(params.get('seed') ?? '', 10);
  const startSeed = Number.isFinite(seedParam) && seedParam > 0 ? seedParam : 7;
  const encounterParam = params.get('encounter');
  let encounterId = ENCOUNTERS.some((e) => e.id === encounterParam)
    ? (encounterParam as string)
    : PRIMARY_ENCOUNTER;
  let encounter = encounterById(encounterId);

  dom.seed.value = String(startSeed);
  for (const e of ENCOUNTERS) {
    const option = document.createElement('option');
    option.value = e.id;
    option.textContent = `${e.id} — ${e.name}`;
    option.selected = e.id === encounterId;
    dom.encounter.append(option);
  }

  let mode: Mode = 'planning';
  /** The line being built: real units, with pending cards spliced in. */
  let plan: PlanItem[] = [];
  /** ghost id -> the hand slot it came out of, so the hand can show it spent. */
  let ghostFromHand = new Map<number, number>();
  let nextGhostId = 1;
  let selected: number | null = null;
  let speed = 1;
  let playback: Playback | null = null;
  let instant = false;
  let view: BoardView = { player: [], enemy: [] };
  let frozen: { player: number; enemy: number } | null = null;
  let mount = false;
  /**
   * Rule every field with its heraldic hatching.
   *
   * Tribe is carried by field colour and by nothing else, and gules sits next to
   * vert on the player's own line - which roughly one man in twelve cannot
   * separate. Hatching is the seventeenth-century answer to exactly that, and it
   * is a switch rather than the default only because the reviewed heraldry
   * goldens are bound to the unhatched bytes; see `RenderOptions.hatch`.
   */
  let hatch = false;
  /** uid -> Power a Relay will hand it on commit, as of the last render. */
  let pendingPowerNow: ReadonlyMap<number, number> = new Map();

  // ---------------------------------------------------------------- setup

  function makeFight(seed: number): Fight {
    return setupFight({
      seed,
      pool: CARD_POOL,
      playerDeck: PLAYER_DECK,
      enemyDeck: ENEMY_DECK,
      enemyOpening: encounter.opening,
      playerHero: PLAYER_HERO,
      enemyHero: encounter.enemyHero,
      maxRounds: MAX_ROUNDS,
    });
  }

  let fight: Fight = makeFight(1);

  function resetPlan(): void {
    plan = fight.state.board.player
      .filter((e) => !e.isHero)
      .map((e) => ({ kind: 'real', uid: e.uid }) as PlanItem);
    ghostFromHand = new Map();
    selected = null;
  }

  function newFight(seed: number): void {
    playback?.cancel();
    playback = null;
    fx.clear();
    fight = makeFight(seed);
    mode = 'planning';
    frozen = null;
    dom.log.textContent = '';
    beginRound(fight);
    resetPlan();
    logLine(`Fight seed ${seed} — ${encounter.name}.`, 'is-head');
    logLine('Your line resolves left to right. Your hero swings last.');
    render();
  }

  // ------------------------------------------------------------ preview

  /**
   * The board as it would be if the turn were committed now. Everything the
   * planning screen shows - odds included - is read off this, never off the
   * uncommitted board, because a pending Guard changes every target chance on
   * the line and a player deciding from stale odds has been cheated.
   */
  function preview(): Fight {
    const clone = cloneFight(fight);
    applyPlacements(clone, placements());
    return clone;
  }

  function placements(): Placement[] {
    return placementsFrom(plan);
  }

  function spent(): number {
    return lineCost(plan, fight.pool);
  }

  // ------------------------------------------------------------- render

  function rowWidth(node: HTMLElement): number {
    return Math.max(300, node.clientWidth || node.parentElement?.clientWidth || 900);
  }

  function planItems(previewView: BoardView, armed: boolean): LineItem[] {
    const units = previewView.player.filter((e) => !e.isHero);
    const hero = previewView.player[previewView.player.length - 1]!;
    const items: LineItem[] = [];
    for (let i = 0; i <= plan.length; i++) {
      if (armed) items.push({ kind: 'slot', index: i });
      const entry = plan[i];
      const entity = units[i];
      if (entry === undefined || entity === undefined) continue;
      items.push(
        entry.kind === 'ghost'
          ? { kind: 'ghost', id: entry.id, entity }
          : { kind: 'unit', entity },
      );
    }
    items.push({ kind: 'hero', entity: hero });
    return items;
  }

  function liveItems(row: readonly EntityView[]): LineItem[] {
    return row.map((entity) =>
      entity.isHero ? ({ kind: 'hero', entity } as LineItem) : ({ kind: 'unit', entity } as LineItem),
    );
  }

  function render(): void {
    if (mode === 'resolving') {
      renderRows();
      renderHud();
      return;
    }

    const p = preview();
    /*
     * Two boards, on purpose.
     *
     * `previewView` is what the cards show: printed Power and Health on the
     * line as it stands. `projected` is that same line with its own Wards and
     * Relays already applied, and it answers the two questions a placement
     * decision actually asks - who can be hit, and where the +2 lands.
     *
     * The forecast is folded back in as *marks*, never as different numbers:
     * the ward glyph and a `+2` pip. A Power disc that read 3 before the commit
     * and 1 immediately after it would be worse than not forecasting at all.
     */
    const projected = projectOwnPhase(p.state, 'player');
    const previewView = snapshot(p.state, fight.pool);
    const pendingPower = new Map<number, number>();
    const liveBonus = new Map(p.state.board.player.map((e) => [e.uid, e.bonusPower] as const));
    for (const e of projected.board.player) {
      const delta = e.bonusPower - (liveBonus.get(e.uid) ?? 0);
      if (delta > 0) pendingPower.set(e.uid, delta);
      const shown = previewView.player.find((v) => v.uid === e.uid);
      if (shown !== undefined) shown.warded = e.warded;
    }
    view = previewView;
    // Kept for the hover panel, which is asked about one card at a time and
    // must give the same forecast the pip on that card is already showing.
    pendingPowerNow = pendingPower;

    const armed = mode === 'planning' && selected !== null;
    const enemyOdds = incomingOdds(p.state, 'player').chance;
    const playerOdds = incomingOdds(projected, 'enemy').chance;

    dom.playerRow.classList.toggle('is-armed', armed);
    renderRow(dom.enemyRow, liveItems(previewView.enemy), {
      available: rowWidth(dom.enemyRow),
      mount,
      hatch,
      odds: mode === 'planning' ? enemyOdds : null,
      resolving: false,
    });
    renderRow(dom.playerRow, planItems(previewView, armed), {
      available: rowWidth(dom.playerRow),
      mount,
      hatch,
      odds: mode === 'planning' ? playerOdds : null,
      ...(mode === 'planning' ? { pendingPower } : {}),
      resolving: false,
    });

    dom.enemyRow.classList.toggle('row--empty', previewView.enemy.length <= 1);
    renderIntent(p);
    renderHud();
    renderHand();
    renderEnergy();
    renderHint();
    renderBanner();
  }

  function renderRows(): void {
    const enemyW = frozen?.enemy;
    const playerW = frozen?.player;
    renderRow(dom.enemyRow, liveItems(view.enemy), {
      available: rowWidth(dom.enemyRow),
      ...(enemyW !== undefined ? { cardWidth: enemyW } : {}),
      mount,
      hatch,
      odds: null,
      resolving: true,
    });
    renderRow(dom.playerRow, liveItems(view.player), {
      available: rowWidth(dom.playerRow),
      ...(playerW !== undefined ? { cardWidth: playerW } : {}),
      mount,
      hatch,
      odds: null,
      resolving: true,
    });
    dom.playerRow.classList.remove('is-armed');
  }

  function renderHud(): void {
    /*
     * The header reads the *view*, not the fight.
     *
     * A committed round is already resolved in the engine by the time the first
     * beat is drawn, so `heroOf(fight.state)` is the score at the end of the
     * round while the board is still showing its middle. Reading the two off
     * different clocks put "you 11/30" in the header above a hero card showing
     * 23, which is not a cosmetic mismatch: the health bar is the fight, and a
     * player watching the enemy swing needs the number to move when the blow
     * lands, not before it is thrown.
     */
    const pool = fight.pool;
    const heroView = view.player[view.player.length - 1];
    const foeView = view.enemy[view.enemy.length - 1];
    const hero = heroView?.isHero === true ? heroView : snapshot(fight.state, pool).player.at(-1)!;
    const foe = foeView?.isHero === true ? foeView : snapshot(fight.state, pool).enemy.at(-1)!;
    const foeName = foe.name;
    dom.subtitle.textContent =
      `round ${fight.round} of ${fight.maxRounds} · ` +
      `you ${Math.max(0, hero.health)}/${hero.maxHealth} · ` +
      `${foeName} ${Math.max(0, foe.health)}/${foe.maxHealth}`;
    dom.enemyName.textContent = `${foeName}'s line`;
    dom.skip.disabled = mode !== 'resolving';
    dom.commit.disabled = mode !== 'planning';
    dom.commit.textContent = mode === 'over' ? 'Fight over' : 'Commit turn';
    dom.sidePlayer.classList.toggle('is-active', mode === 'planning');
  }

  function renderIntent(p: Fight): void {
    // A finished fight has no next attack, and a forecast of one reads as a
    // claim about a turn that is not coming.
    if (mode === 'over') {
      dom.enemyIntent.textContent = '';
      dom.playerIntent.textContent = '';
      return;
    }
    const projected = projectOwnPhase(p.state, 'player');
    const incoming = incomingOdds(projected, 'enemy');
    const outgoing = incomingOdds(projected, 'player');
    const share = incoming.poolSize === 0 ? 0 : 1 / incoming.poolSize;

    dom.enemyIntent.innerHTML =
      `<b>${incoming.attackers}</b> attack${incoming.attackers === 1 ? '' : 's'} on the line now ` +
      `(plus whatever it plays), <b>${incoming.totalPower}</b> Power. ` +
      (incoming.poolSize === 0
        ? '<span class="warn">Nothing of yours can be struck</span> once your Wards land — ' +
          'every attack fizzles.'
        : incoming.guarded
          ? `Your Guards absorb everything: each attack is <b>${pct(share)}</b> onto each of your ` +
            `<b>${incoming.poolSize}</b> Guard${incoming.poolSize === 1 ? '' : 's'}.`
          : `<span class="warn">No Guard.</span> Each attack is <b>${pct(share)}</b> onto each of ` +
            `your <b>${incoming.poolSize}</b> targets — your hero included.`);

    const outShare = outgoing.poolSize === 0 ? 0 : 1 / outgoing.poolSize;
    // `outgoing` is read off the projected board, so this total already
    // includes the Power your own Relays are about to hand along the line.
    dom.playerIntent.innerHTML =
      `<b>${outgoing.attackers}</b> of yours will swing for <b>${outgoing.totalPower}</b> Power. ` +
      (outgoing.poolSize === 0
        ? 'No legal enemy target — your attacks will fizzle.'
        : outgoing.guarded
          ? `Enemy Guards force every one of them: <b>${pct(outShare)}</b> onto each of ` +
            `<b>${outgoing.poolSize}</b>.`
          : `Each lands <b>${pct(outShare)}</b> onto each of <b>${outgoing.poolSize}</b> targets.`);
  }

  function handCardView(card: UnitCard): EntityView {
    return {
      uid: -1,
      cardId: card.id,
      name: card.name,
      tribe: card.tribe,
      side: 'player',
      isHero: false,
      basePower: card.power,
      bonusPower: 0,
      health: card.health,
      maxHealth: card.health,
      armour: card.armour,
      traits: card.traits,
      cost: card.cost,
      alive: true,
      warded: false,
      acting: false,
    };
  }

  function renderHand(): void {
    const affordable = ENERGY_PER_TURN - spent();
    dom.hand.textContent = '';
    fight.player.hand.forEach((cardId, index) => {
      const card = fight.pool.card(cardId);
      const node = document.createElement('button');
      node.type = 'button';
      node.className = 'handcard';
      node.dataset['index'] = String(index);
      node.dataset['cardId'] = cardId;
      const placedFrom = [...ghostFromHand.values()].includes(index);
      node.disabled = mode !== 'planning' || placedFrom || card.cost > affordable;
      node.classList.toggle('is-selected', selected === index);
      /*
       * The whole card, in one sentence, on the button itself.
       *
       * A hand card draws a cost bubble, a name and four heraldic channels and
       * explains none of them; the panel does that on hover, and this is what a
       * pointer and a screen reader get before the panel opens. The trait names
       * are here rather than only in the panel because "Guard" is the difference
       * between a card that protects your hero and one that does not.
       */
      const summary =
        `${card.name}. ${tribeTerm(card.tribe).name} unit. ` +
        `Costs ${card.cost} ${STAT_TERMS.cost.name}, ${card.power} ${STAT_TERMS.power.name}, ` +
        `${card.health} ${STAT_TERMS.health.name}` +
        (card.armour > 0 ? `, ${card.armour} ${STAT_TERMS.armour.name}` : '') +
        (card.traits.length > 0
          ? `. ${card.traits.map((t) => TRAIT_TERMS[t].name).join(', ')}`
          : '. No trait') +
        (placedFrom ? '. Already in your line this turn' : '');
      node.title = summary;
      node.setAttribute('aria-label', summary);

      const art = document.createElement('div');
      art.className = 'card__art';
      art.innerHTML = renderHandArt(card);
      const cost = document.createElement('span');
      cost.className = 'handcard__cost';
      cost.textContent = String(card.cost);
      cost.title = `${card.cost} ${STAT_TERMS.cost.name} — ${STAT_TERMS.cost.line}`;
      const name = document.createElement('span');
      name.className = 'handcard__name';
      name.textContent = card.name;

      node.append(art, cost, name);
      dom.hand.append(node);
    });
    if (fight.player.hand.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'hint';
      empty.textContent = 'Your deck is spent — no cards left to draw.';
      dom.hand.append(empty);
    }
  }

  const handArtCache = new Map<string, string>();
  /** Hand cards are drawn at 78px, well above the 44px floor the probe found. */
  function renderHandArt(card: UnitCard): string {
    const cached = handArtCache.get(card.id);
    if (cached !== undefined) return cached;
    const svg = compressedCard(handCardView(card), 78, mount, hatch);
    handArtCache.set(card.id, svg);
    return svg;
  }

  function renderEnergy(): void {
    const used = spent();
    dom.energy.textContent = '';
    // The pips are discs with no text. Named as a group, and each one told
    // whether it is still yours to spend, because "three blue circles" is not
    // an explanation of anything.
    dom.energy.setAttribute(
      'aria-label',
      `${ENERGY_PER_TURN - used} of ${ENERGY_PER_TURN} ${STAT_TERMS.cost.name} left. ${STAT_TERMS.cost.line}`,
    );
    for (let i = 0; i < ENERGY_PER_TURN; i++) {
      const pip = document.createElement('span');
      const left = i < ENERGY_PER_TURN - used;
      pip.className = left ? 'energy__pip' : 'energy__pip is-spent';
      pip.title = left ? `${STAT_TERMS.cost.name} — unspent` : `${STAT_TERMS.cost.name} — spent`;
      dom.energy.append(pip);
    }
    const label = document.createElement('span');
    label.style.marginLeft = '6px';
    label.style.color = 'var(--ink-2)';
    label.textContent =
      mode === 'planning'
        ? `${ENERGY_PER_TURN - used} of ${ENERGY_PER_TURN}`
        : `${ENERGY_PER_TURN} next turn`;
    dom.energy.append(label);
  }

  function renderHint(): void {
    if (mode === 'over') {
      dom.hint.innerHTML = 'Set a seed and start a new fight.';
      return;
    }
    if (mode === 'resolving') {
      dom.hint.innerHTML = 'Resolving — watch which card is lit.';
      return;
    }
    if (selected === null) {
      dom.hint.innerHTML =
        'Pick a card (or press <b>1</b>–<b>5</b>), then choose a gap in your line. ' +
        '<b>Enter</b> commits.';
      return;
    }
    const cardId = fight.player.hand[selected];
    if (cardId === undefined) {
      dom.hint.innerHTML = 'Pick a card, then a gap in your line.';
      return;
    }
    const card = fight.pool.card(cardId);
    const rules = card.traits.map(traitRule).filter((s): s is string => s !== null);
    dom.hint.innerHTML =
      `Placing <b>${card.name}</b>. ${rules.join(' ')}` +
      (rules.length === 0 ? ' No trait — where it stands changes only who gets hit.' : '');
  }

  function renderBanner(): void {
    dom.banner.textContent = '';
    if (fight.result === 'ongoing') return;
    const node = document.createElement('div');
    const hero = heroOf(fight.state, 'player');
    const foe = heroOf(fight.state, 'enemy');
    if (fight.result === 'playerWin') {
      node.className = 'banner banner--win';
      node.innerHTML = `You win on round ${fight.round}.<small>Your hero finished on ${Math.max(0, hero.health)} of ${hero.maxHealth} Health.</small>`;
    } else if (fight.result === 'enemyWin') {
      node.className = 'banner banner--loss';
      node.innerHTML = `Your hero falls on round ${fight.round}.<small>${foe.cardId.slice(5)} finished on ${Math.max(0, foe.health)} of ${foe.maxHealth} Health.</small>`;
    } else {
      node.className = 'banner banner--draw';
      node.innerHTML = `Out of rounds after ${fight.round}.<small>Neither hero fell. A draw counts as a loss for the run.</small>`;
    }
    dom.banner.append(node);
  }

  // ----------------------------------------------------------------- log

  function logLine(html: string, cls = ''): void {
    const node = document.createElement('p');
    if (cls.length > 0) node.className = cls;
    node.innerHTML = html;
    dom.log.append(node);
    dom.log.scrollTop = dom.log.scrollHeight;
  }

  function nameOf(uid: number): string {
    const e = findView(view, uid);
    return e === null ? `#${uid}` : e.name;
  }

  // ---------------------------------------------------------- resolution

  function elementFor(uid: number): HTMLElement | null {
    return dom.app.querySelector(`.row [data-uid="${uid}"]`);
  }

  function describe(beat: Beat): void {
    switch (beat.kind) {
      case 'act':
        logLine(`<b>${nameOf(beat.uid)}</b> acts.`, 'is-head');
        break;
      case 'attack': {
        const bits: string[] = [];
        if (beat.absorbed > 0) bits.push(`${beat.absorbed} stopped by armour`);
        if (beat.wasted > 0) bits.push(`${beat.wasted} wasted — damage does not carry`);
        if (beat.guardForced) bits.push('forced onto a Guard');
        logLine(
          `strikes <b>${nameOf(beat.targetUid)}</b> for <b>${beat.dealt}</b>` +
            (bits.length > 0 ? ` <i>(${bits.join('; ')})</i>` : '') +
            '.',
        );
        break;
      }
      case 'fizzle':
        logLine('has no legal target — the attack fizzles.');
        break;
      case 'buff': {
        const from =
          beat.source.via === 'relay'
            ? `<b>${nameOf(beat.source.sourceUid ?? -1)}</b>'s Relay sends`
            : beat.source.via === 'wake'
              ? `<b>${nameOf(beat.uid)}</b>'s Wake answers a death with`
              : 'a buff of';
        logLine(
          `${from} <b>+${beat.amount} Power</b> to <b>${nameOf(beat.uid)}</b> for this turn.`,
          'is-buff',
        );
        break;
      }
      case 'ward':
        logLine(
          `<b>${nameOf(beat.uid)}</b> is warded — it cannot be struck this turn.`,
          'is-buff',
        );
        break;
      case 'death':
        logLine(`<b>${nameOf(beat.uid)}</b> dies.`, 'is-kill');
        break;
    }
  }

  function paint(step: Step): void {
    const ms = Math.max(90, step.dur / speed);
    const beat = step.beat;
    switch (beat.kind) {
      case 'attack': {
        const from = elementFor(beat.uid);
        const to = elementFor(beat.targetUid);
        if (from !== null && to !== null) fx.beam(from, to, Math.min(360, ms * 0.7));
        if (to !== null) {
          // Four separate claims about one attack, laid out so none of them
          // crosses the Power and Health discs on the way up: the numerals are
          // the channel ARCHITECTURE.md says nothing may occlude, and a label
          // that rises through them makes both unreadable for the frames it
          // takes. GUARD clears the card entirely, the rest stack below centre.
          if (beat.guardForced) fx.float(to, '◆ GUARD', 'is-guard', ms, -78);
          fx.float(to, beat.dealt > 0 ? `−${beat.dealt}` : 'blocked', '', ms, 4);
          if (beat.absorbed > 0) fx.float(to, `armour −${beat.absorbed}`, 'is-small', ms, 38);
          if (beat.wasted > 0) fx.float(to, `${beat.wasted} wasted`, 'is-small', ms, 56);
        }
        break;
      }
      case 'fizzle': {
        const at = elementFor(beat.uid);
        if (at !== null) fx.float(at, 'no target', 'is-small', ms);
        break;
      }
      case 'buff': {
        const to = elementFor(beat.uid);
        const from = beat.source.sourceUid === null ? null : elementFor(beat.source.sourceUid);
        const label = `+${beat.amount}`;
        if (from !== null && to !== null && from !== to) {
          fx.travel(from, to, label, '', Math.min(700, Math.max(150, ms)));
        } else if (to !== null) {
          fx.float(to, label, '', ms);
        }
        break;
      }
      case 'ward': {
        const to = elementFor(beat.uid);
        const from = beat.sourceUid === null ? null : elementFor(beat.sourceUid);
        if (from !== null && to !== null && from !== to) {
          fx.travel(from, to, '◇ ward', 'is-ward', Math.min(700, Math.max(150, ms)));
        } else if (to !== null) {
          fx.float(to, '◇ ward', 'is-small', ms);
        }
        break;
      }
      case 'death': {
        const at = elementFor(beat.uid);
        if (at !== null) fx.float(at, 'dies', 'is-death', ms);
        break;
      }
      case 'act':
        break;
    }
  }

  function onBeat(step: Step): void {
    describe(step.beat);
    if (instant) {
      applyBeat(view, step.beat);
      return;
    }
    // Effects read the DOM positions of the board *before* the beat lands, so
    // an attack beam leaves a card that is still where the player saw it.
    paint(step);
    applyBeat(view, step.beat);
    renderRows();
    renderHud();
  }

  function commit(): void {
    if (mode !== 'planning') return;
    if (spent() > ENERGY_PER_TURN) return;

    const chosen = placements();
    const committed = commitRound(fight, chosen);
    // The pending line is spent the moment it is committed: leaving it in place
    // would make the next `preview()` try to play cards that are no longer in
    // hand, and `applyPlacements` throws on exactly that.
    resetPlan();
    mode = 'resolving';
    instant = false;

    // Card widths are frozen for the whole resolution: a row that re-fits
    // itself every time a unit dies makes every beam and every travelling buff
    // aim at a card that has already moved.
    const maxPlayer = committed.stateAtStart.board.player.length;
    let maxEnemy = committed.stateAtStart.board.enemy.length;
    for (const seg of committed.segments) {
      maxEnemy = Math.max(maxEnemy, seg.stateAfter.board.enemy.length);
    }
    frozen = {
      player: fitWidth(rowWidth(dom.playerRow), maxPlayer),
      enemy: fitWidth(rowWidth(dom.enemyRow), maxEnemy),
    };

    view = snapshot(committed.stateAtStart, fight.pool);
    logLine(
      `Round ${fight.round} committed — ${chosen.length} card${chosen.length === 1 ? '' : 's'} placed.`,
      'is-head',
    );
    renderRows();
    renderHud();
    renderHand();
    renderEnergy();
    renderHint();

    let index = 0;
    const runSegment = (): void => {
      const segment = committed.segments[index];
      if (segment === undefined) {
        finishRound(committed.result);
        return;
      }
      index++;

      if (segment.kind === 'spawns') {
        view = snapshot(segment.stateAfter, fight.pool);
        renderRows();
        if (segment.uids.length > 0) {
          logLine(
            `The enemy plays ${segment.uids.map((u) => `<b>${nameOf(u)}</b>`).join(', ')}.`,
            'is-head',
          );
          if (!instant) {
            for (const uid of segment.uids) {
              const node = elementFor(uid);
              if (node !== null) fx.float(node, 'arrives', 'is-small', 500);
            }
          }
        }
        globalThis.setTimeout(runSegment, instant ? 0 : 420 / speed);
        return;
      }

      dom.sideEnemy.classList.toggle('is-active', segment.side === 'enemy');
      dom.sidePlayer.classList.toggle('is-active', segment.side === 'player');
      logLine(
        segment.side === 'player' ? 'Your line resolves.' : 'The enemy line resolves.',
        'is-head',
      );

      const beats = buildBeats(snapshot(viewSourceState(committed, index - 1), fight.pool), segment.events);
      const sched = schedule(beats);
      playback = play(
        sched,
        {
          onBeat,
          onDone: () => {
            const drift = viewDrift(view, segment.stateAfter);
            if (drift.length > 0) {
              logLine(
                `view/engine mismatch after the ${segment.side} phase: ${drift.join('; ')}`,
                'is-kill',
              );
              console.error('render view drifted from engine state', drift);
            }
            view = snapshot(segment.stateAfter, fight.pool);
            renderRows();
            globalThis.setTimeout(runSegment, instant ? 0 : 260 / speed);
          },
        },
        speed,
      );
      // "Resolve now" has to skip the *round*, not the phase it happened to be
      // pressed during. A committed round is three segments - your line, the
      // enemy's placements, the enemy line - and skipping only the first left
      // the player watching the half they had just asked to skip.
      if (instant) playback.finish();
    };

    runSegment();
  }

  /** The engine state each phase starts from: the previous boundary's snapshot. */
  function viewSourceState(
    committed: ReturnType<typeof commitRound>,
    segmentIndex: number,
  ): GameState {
    if (segmentIndex === 0) return committed.stateAtStart;
    return committed.segments[segmentIndex - 1]!.stateAfter;
  }

  function finishRound(result: Fight['result']): void {
    playback = null;
    frozen = null;
    dom.sideEnemy.classList.remove('is-active');
    fx.clear();
    resetPlan();
    if (result !== 'ongoing') {
      mode = 'over';
      logLine(
        result === 'playerWin'
          ? 'The enemy hero falls. You win.'
          : result === 'enemyWin'
            ? 'Your hero falls.'
            : 'The round cap ran out — a draw.',
        'is-head',
      );
      render();
      return;
    }
    mode = 'planning';
    beginRound(fight);
    resetPlan();
    render();
  }

  // ------------------------------------------------------------- intents

  function place(index: number): void {
    if (mode !== 'planning' || selected === null) return;
    const cardId = fight.player.hand[selected];
    if (cardId === undefined) return;
    const card = fight.pool.card(cardId);
    if (spent() + card.cost > ENERGY_PER_TURN) return;
    const id = nextGhostId++;
    plan.splice(index, 0, { kind: 'ghost', id, cardId });
    ghostFromHand.set(id, selected);
    selected = null;
    render();
  }

  function removeGhost(id: number): void {
    if (mode !== 'planning') return;
    const at = plan.findIndex((i) => i.kind === 'ghost' && i.id === id);
    if (at < 0) return;
    plan.splice(at, 1);
    ghostFromHand.delete(id);
    render();
  }

  function setSpeed(value: number): void {
    speed = value;
    playback?.setSpeed(value);
    for (const node of Array.from(dom.app.querySelectorAll('[data-act="speed"]'))) {
      node.classList.toggle('is-on', Number.parseFloat((node as HTMLElement).dataset['speed'] ?? '1') === value);
    }
  }

  function setTheme(value: 'light' | 'dark'): void {
    document.documentElement.dataset['theme'] = value;
    mount = value === 'dark';
    for (const node of Array.from(dom.app.querySelectorAll('[data-act="theme"]'))) {
      node.classList.toggle('is-on', (node as HTMLElement).dataset['themeValue'] === value);
    }
    // The mount halo changes the SVG, so every cached raster is stale.
    repaintAllArt();
  }

  /**
   * Turn the heraldic hatching on or off.
   *
   * The board tells tribes apart by field colour alone: dwarf is gules, elf is
   * vert, and they stand next to each other on the player's own line. Roughly
   * one man in twelve cannot separate red from green, and for them those two
   * cards differ in nothing at all. Petra Sancta hatching is the answer print
   * heraldry has used since 1638 - vertical lines for gules, diagonals for vert
   * - and it puts the tribe channel into shape as well as hue.
   */
  function setHatch(value: boolean): void {
    hatch = value;
    for (const node of Array.from(dom.app.querySelectorAll('[data-act="hatch"]'))) {
      node.classList.toggle('is-on', ((node as HTMLElement).dataset['hatchValue'] === 'on') === value);
    }
    repaintAllArt();
  }

  /** Every cached and painted card SVG is stale; make them all repaint. */
  function repaintAllArt(): void {
    handArtCache.clear();
    for (const node of Array.from(dom.app.querySelectorAll('.card__art'))) {
      delete (node as HTMLElement).dataset['sig'];
    }
    showInspect(null);
    if (mode === 'resolving') renderRows();
    else render();
  }

  /** The chance the next enemy attack lands on `uid`, as the board shows it. */
  function chanceFor(uid: number, side: 'player' | 'enemy'): number | null {
    if (mode !== 'planning') return null;
    const p = preview();
    const odds =
      side === 'player'
        ? incomingOdds(projectOwnPhase(p.state, 'player'), 'enemy').chance
        : incomingOdds(p.state, 'player').chance;
    // Absent means "not in the target pool", which is a chance of zero and not
    // an absence of information - the board's own badge reads it the same way.
    // Returning null here is what made the panel silently drop the one number a
    // player is hovering a Guard to check.
    return odds.get(uid) ?? 0;
  }

  /**
   * Place the panel where it hides the least board.
   *
   * The old rule was "below the card if it fits, otherwise above", and above is
   * exactly where the other line is: hovering one of your own units put a
   * 190x323 panel over 24,355 square pixels of the enemy row, which is the whole
   * left half of the line whose numbers you are hovering your own card in order
   * to compare against. The panel answered "what is this card" by deleting the
   * question.
   *
   * So placement is *scored* rather than ordered. Candidates are the four sides
   * of the hovered card plus the three free bands the two rows cut the window
   * into, and the cost of each is the area it would cover, weighted: the row the
   * card is *not* in is the expensive one, its own row is cheaper because the
   * pointer is already there, and anything off-screen is worst of all. Distance
   * from the card breaks ties, so the panel stays next to what it describes
   * whenever it can do that for free.
   */
  function placeInspect(anchor: HTMLElement): void {
    const pad = 8;
    const gap = 10;
    const box = anchor.getBoundingClientRect();
    const panel = dom.inspect.getBoundingClientRect();
    const vw = globalThis.innerWidth;
    const vh = globalThis.innerHeight;
    const pw = panel.width;
    const ph = panel.height;

    const rows = {
      enemy: dom.enemyRow.getBoundingClientRect(),
      player: dom.playerRow.getBoundingClientRect(),
    };
    const ownRow = anchor.closest('#enemy-row') !== null ? 'enemy' : 'player';
    const otherRow = ownRow === 'enemy' ? 'player' : 'enemy';

    const overlap = (x: number, y: number, r: DOMRect): number => {
      const w = Math.max(0, Math.min(x + pw, r.right) - Math.max(x, r.left));
      const h = Math.max(0, Math.min(y + ph, r.bottom) - Math.max(y, r.top));
      return w * h;
    };
    const offscreen = (x: number, y: number): number => {
      const w = Math.max(0, Math.min(x + pw, vw) - Math.max(x, 0));
      const h = Math.max(0, Math.min(y + ph, vh) - Math.max(y, 0));
      return pw * ph - w * h;
    };

    const clampX = (x: number): number => Math.min(Math.max(pad, x), Math.max(pad, vw - pw - pad));
    const nearX = clampX(box.left + box.width / 2 - pw / 2);
    const midY = box.top + box.height / 2;
    const bandY = (top: number, bottom: number): number =>
      Math.min(Math.max(top + pad, midY - ph / 2), Math.max(top + pad, bottom - ph - pad));

    const candidates: { x: number; y: number }[] = [
      { x: nearX, y: box.bottom + gap },
      { x: nearX, y: box.top - ph - gap },
      { x: clampX(box.right + gap), y: Math.min(Math.max(pad, midY - ph / 2), vh - ph - pad) },
      { x: clampX(box.left - pw - gap), y: Math.min(Math.max(pad, midY - ph / 2), vh - ph - pad) },
      // The three bands the two rows leave: above the top line, between the
      // lines, and below the bottom one. These are the placements that can be
      // free of the board entirely, and one of them almost always is.
      { x: nearX, y: bandY(0, rows.enemy.top) },
      { x: nearX, y: bandY(rows.enemy.bottom, rows.player.top) },
      { x: nearX, y: bandY(rows.player.bottom, vh) },
    ];

    let best = candidates[0]!;
    let bestCost = Number.POSITIVE_INFINITY;
    for (const c of candidates) {
      const cost =
        overlap(c.x, c.y, rows[otherRow]) * 6 +
        overlap(c.x, c.y, rows[ownRow]) * 2 +
        // Covering the card being explained is its own failure - the ring that
        // says "this one" would be underneath the panel drawn to describe it -
        // and it is the case a hand card runs into, since the hand sits in the
        // one band that is free of both rows.
        overlap(c.x, c.y, box) * 8 +
        offscreen(c.x, c.y) * 12 +
        Math.abs(c.y + ph / 2 - midY) * 0.6 +
        Math.abs(c.x + pw / 2 - (box.left + box.width / 2)) * 0.3;
      if (cost < bestCost) {
        bestCost = cost;
        best = c;
      }
    }

    dom.inspect.style.left = `${Math.round(clampX(best.x))}px`;
    dom.inspect.style.top = `${Math.round(Math.min(Math.max(pad, best.y), Math.max(pad, vh - ph - pad)))}px`;
  }

  /** The card the panel is currently describing, so the board can point at it. */
  let inspected: HTMLElement | null = null;

  function showInspect(target: HTMLElement | null): void {
    if (inspected !== null) inspected.classList.remove('is-inspected');
    inspected = null;
    if (target === null) {
      dom.inspect.hidden = true;
      return;
    }
    let entity: EntityView | null = null;
    const cardId = target.dataset['cardId'];
    if (cardId !== undefined) entity = handCardView(fight.pool.card(cardId));
    else {
      const uid = Number.parseInt(target.dataset['uid'] ?? '', 10);
      if (Number.isFinite(uid)) entity = findView(view, uid);
    }
    if (entity === null) {
      dom.inspect.hidden = true;
      return;
    }

    // A hand card is not on the board, so it has no target chance and no
    // incoming Relay; a card in a line has both, and they are the two things a
    // player is reading the panel to compare.
    const onBoard = cardId === undefined;
    dom.inspect.innerHTML = explainCard(entity, cardViewOf(entity), {
      chance: onBoard ? chanceFor(entity.uid, entity.side) : null,
      pendingPower: onBoard ? (pendingPowerNow.get(entity.uid) ?? 0) : 0,
      hatch,
      pct,
    });
    dom.inspect.hidden = false;
    // The panel does not always land beside the card it describes - it lands
    // wherever it hides the least board - so the card says which one it is.
    target.classList.add('is-inspected');
    inspected = target;
    placeInspect(target);
  }

  function dispatch(intent: Intent): void {
    switch (intent.kind) {
      case 'selectHand': {
        if (mode !== 'planning') return;
        const cardId = fight.player.hand[intent.index];
        if (cardId === undefined) return;
        if ([...ghostFromHand.values()].includes(intent.index)) return;
        if (fight.pool.card(cardId).cost > ENERGY_PER_TURN - spent()) return;
        selected = selected === intent.index ? null : intent.index;
        render();
        break;
      }
      case 'placeAt':
        place(intent.index);
        break;
      case 'removeGhost':
        removeGhost(intent.id);
        break;
      case 'clearSelection':
        selected = null;
        render();
        break;
      case 'commit':
        commit();
        break;
      case 'skip':
        if (playback !== null) {
          instant = true;
          playback.finish();
        }
        break;
      case 'speed':
        setSpeed(intent.value);
        break;
      case 'theme':
        setTheme(intent.value);
        break;
      case 'hatch':
        setHatch(intent.value);
        break;
      case 'newFight': {
        const seed = Number.parseInt(dom.seed.value, 10);
        encounterId = dom.encounter.value;
        encounter = encounterById(encounterId);
        newFight(Number.isFinite(seed) && seed > 0 ? seed : 1);
        break;
      }
      case 'inspect':
        showInspect(intent.target);
        break;
    }
  }

  wireInput(document.body, dispatch);
  globalThis.addEventListener('resize', () => {
    // The panel is placed against the rows' measured rectangles, so a resize
    // invalidates the placement as surely as it invalidates the card widths.
    showInspect(null);
    if (mode === 'resolving') renderRows();
    else render();
  });

  const prefersDark =
    typeof globalThis.matchMedia === 'function' &&
    globalThis.matchMedia('(prefers-color-scheme: dark)').matches;
  const themeParam = params.get('theme');
  setTheme(themeParam === 'light' || themeParam === 'dark' ? themeParam : prefersDark ? 'dark' : 'light');
  // `?hatch=1` opens the fight with hatching on, the way `?theme=` and `?seed=`
  // already make a fight addressable.
  setHatch(params.get('hatch') === '1' || params.get('hatch') === 'on');
  setSpeed(1);
  newFight(startSeed);
}
