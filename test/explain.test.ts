// A card explains all of itself, and cannot explain a rule the game does not have.
//
// The defect this gate exists for is not a crash. It is a card that shows a
// symbol whose meaning lives somewhere the player will never look - which is how
// the owner came to ask what "Ward", "Wake" and "hue" meant about mechanics in
// their own game. The failure mode after the fix is worse and quieter: an
// explanation that is still on screen after the rule behind it has been deleted
// or re-tuned. A tooltip nobody can tell is wrong is worse than no tooltip.
//
// Ward has since been deleted from the game, and it is left in the sentence
// above on purpose: it is the whole argument for the `Record<Trait, Term>` key.
// The trait went, the compiler named its tooltip, and the tooltip went with it.
//
// So this file gates three separate claims:
//
//   1. Completeness  - every trait and every race that appears on a card in the
//                      shipped pool has an explanation, and every explanation is
//                      of something that still exists.
//   2. Truthfulness  - the numbers in the trait sentences are the resolver's own
//                      constants, and the "race carries no rule" sentence is
//                      still true of the resolver.
//   3. Legibility    - the icons are one-shape-per-meaning, they still fit the
//                      44px compression floor, and the tribe channel survives
//                      red-green colour blindness.
//
// Bound of this gate - what a green run does and does not prove:
//
//   Reads the shipped `CARD_POOL` through `PLAYER_CARDS` and `ENEMY_CARDS`, and
//   `engine/state.ts`'s `Trait` and `Tribe` unions through the glossary's own
//   typed tables. It says nothing about a card that is not in those two arrays,
//   nothing about a trait that exists in the union but on no card, and nothing
//   about pixels: it asserts on the HTML and SVG strings, never on what a
//   browser draws from them. The colour-blindness assertions are a *simulation*
//   and can only fail a design, never pass one - the pictures under
//   `.probe-ui/hover-*/13-deuteranopia-*.png` are the evidence that was looked
//   at. `npm run probe:ui hover` regenerates them and strands that review.
//
// Made to go red: deleting the `wake` entry from `TRAIT_TERMS` fails to compile
// (the table is keyed by the engine's `Trait` union); adding a trait to that
// union without documenting it fails the same way. Changing `RELAY_POWER` to 3
// without touching the glossary fails "trait rules carry the resolver's own
// numbers". Setting every tincture's hatch to 'none' fails "no two tribe fields
// on one line are indistinguishable". See `docs/learning/gate-proofs.md`.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { ENEMY_CARDS, PLAYER_CARDS, PLAYER_HERO } from '../src/content/cards.ts';
import { CLASSES } from '../src/content/classes.ts';
import { RELAY_POWER, WAKE_POWER, drain } from '../src/engine/resolver.ts';
import { makeRng } from '../src/engine/rng.ts';
import {
  type Entity,
  type GameState,
  type Tribe,
  heroOf,
  insertUnit,
  makeHero,
  makeUnit,
  unitCount,
} from '../src/engine/state.ts';
import {
  RACE_HAS_NO_RULE,
  RETALIATION_HERO,
  RETALIATION_UNIT,
  STAT_TERMS,
  TINCTURE_TERMS,
  TRAIT_TERMS,
  TRIBE_TERMS,
  tribeTerm,
} from '../src/render/glossary.ts';
import { ICON_NAMES, iconShape, iconSvg, type IconName } from '../src/render/icons.ts';
import { explainCard } from '../src/render/inspect.ts';
import { MIN_CARD_W, cardViewOf, pipIconSize, traitPips } from '../src/render/board.ts';
import { TRIBE_FIELD, blazonFor } from '../src/render/blazons.ts';
import {
  TINCTURES,
  type Tincture,
  colourDistance,
  hatchOf,
  simulate,
} from '../src/render/heraldry/tinctures.ts';
import { renderCard } from '../src/render/heraldry/card.ts';
import type { EntityView } from '../src/render/view.ts';
import { pct } from '../src/render/odds.ts';

const ROOT = path.resolve(import.meta.dirname, '..');
const ALL_CARDS = [...PLAYER_CARDS, ...ENEMY_CARDS];

/** `inspect.ts`'s escaping, so a sentence can be looked for in the HTML it made. */
function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) =>
    c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;' : '&quot;',
  );
}

/**
 * A source file with its comments taken out.
 *
 * The repo has already been bitten by this once: `gate:banned-apis` reads the
 * TypeScript AST rather than grepping, because `src/engine/rng.ts` names all
 * three banned APIs in a comment in order to say it never calls them, and a
 * grep gate reported sixteen violations on a clean tree. The same trap is here -
 * `glossary.ts`'s own header explains the rule by quoting `"+2 Power"` - so a
 * scan for a hardcoded number has to look at code and not at prose.
 */
function codeOf(rel: string): string {
  return readFileSync(path.join(ROOT, rel), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

/** A card as it appears on the board, so the panel is asked the real question. */
function viewOf(card: (typeof ALL_CARDS)[number], side: 'player' | 'enemy' = 'player'): EntityView {
  return {
    uid: 1,
    cardId: card.id,
    name: card.name,
    tribe: card.tribe,
    side,
    isHero: false,
    basePower: card.power,
    bonusPower: 0,
    health: card.health,
    maxHealth: card.health,
    armour: card.armour,
    traits: card.traits,
    cost: card.cost,
    alive: true,
    acting: false,
  };
}

function heroView(): EntityView {
  return {
    uid: 99,
    cardId: `hero:${PLAYER_HERO.name}`,
    name: PLAYER_HERO.name,
    tribe: 'hero',
    side: 'player',
    isHero: true,
    basePower: PLAYER_HERO.power,
    bonusPower: 0,
    health: PLAYER_HERO.health,
    maxHealth: PLAYER_HERO.health,
    armour: PLAYER_HERO.armour,
    traits: [],
    cost: 0,
    alive: true,
    acting: false,
  };
}

const CTX = { chance: 0.5, pendingPower: 0, hatch: false, pct } as const;

// --------------------------------------------------------------- completeness

test('every trait on every shipped card has an explanation', () => {
  const documented = new Set(Object.keys(TRAIT_TERMS));
  for (const card of ALL_CARDS) {
    for (const trait of card.traits) {
      assert.ok(
        documented.has(trait),
        `${card.name} carries the trait "${trait}", which has no entry in TRAIT_TERMS. ` +
          `A trait with no entry is a pip on the card whose meaning lives nowhere the ` +
          `player can reach. Add it to src/render/glossary.ts.`,
      );
    }
  }
});

test('no explanation survives the trait it explains', () => {
  // The compile-time half of this is the `Record<Trait, Term>` key: deleting a
  // trait from the engine's union makes `glossary.ts` stop compiling. This is
  // the runtime half - a trait still in the union but on no card in the pool is
  // a rule no player can meet, and a tooltip for it is a rule that does not
  // exist as far as the game is concerned. A class hero's trait counts: a Mage
  // player meets Scorch every turn, and no card carries it.
  const used = new Set<string>([
    ...ALL_CARDS.flatMap((c) => [...c.traits]),
    ...CLASSES.flatMap((c) => [...(c.hero.traits ?? [])]),
  ]);
  for (const trait of Object.keys(TRAIT_TERMS)) {
    assert.ok(
      used.has(trait),
      `TRAIT_TERMS explains "${trait}", but no card in PLAYER_CARDS or ENEMY_CARDS and no class ` +
        `hero has it. Either the trait was removed and its explanation was left behind, or a ` +
        `card that carries it is missing. Delete the entry or add the card.`,
    );
  }
});

test('every race on every shipped card has an explanation and a field tincture', () => {
  for (const card of ALL_CARDS) {
    const term = TRIBE_TERMS[card.tribe as Tribe] as { name: string } | undefined;
    assert.ok(term !== undefined, `${card.name} is a ${card.tribe}, which has no TRIBE_TERMS entry.`);
    assert.ok(
      TRIBE_FIELD[card.tribe] !== undefined,
      `${card.name} is a ${card.tribe}, which has no field tincture in TRIBE_FIELD, so its ` +
        `card would be drawn in the fallback colour and the panel would name the wrong race.`,
    );
  }
});

test('an unknown race gets a truthful placeholder rather than a blank', () => {
  const term = tribeTerm('gnome');
  assert.equal(term.name, 'gnome');
  assert.match(term.line, /no entry/);
});

// -------------------------------------------------------------- truthfulness

test('trait rules carry the resolver’s own numbers, not retyped ones', () => {
  // Two halves, and only together do they mean anything.
  //
  // The runtime half says the sentence currently agrees with the constant. On
  // its own it is the weak kind of check canon warns about: retyping "+2 Power"
  // as a literal passes it, and goes on passing until somebody re-tunes
  // RELAY_POWER - at which point the tooltip is wrong and nothing says so.
  assert.match(TRAIT_TERMS.relay.line, new RegExp(`\\+${RELAY_POWER} Power`));
  assert.match(TRAIT_TERMS.wake.line, new RegExp(`\\+${WAKE_POWER} Power`));

  // The source half is the one that catches the retype: the sentence has to be
  // built from the imported constant, so re-tuning the resolver re-words the
  // tooltip whether or not anybody remembers to.
  const glossary = codeOf('src/render/glossary.ts');
  assert.ok(
    glossary.includes('${RELAY_POWER}'),
    'src/render/glossary.ts no longer interpolates RELAY_POWER. Relay’s sentence must be built ' +
      'from the resolver’s constant, not from a number typed here that will not follow it.',
  );
  assert.ok(
    glossary.includes('${WAKE_POWER}'),
    'src/render/glossary.ts no longer interpolates WAKE_POWER.',
  );
  const literal = /\+\d+ Power/.exec(glossary);
  assert.equal(
    literal,
    null,
    `src/render/glossary.ts contains the literal "${literal?.[0]}". A Power number written out ` +
      'here stops following the resolver the moment that constant is re-tuned.',
  );
});

test('the "race carries no rule" claim is still true of the resolver', () => {
  // `RACE_HAS_NO_RULE` tells the player that nothing reads a unit's race. That
  // is a claim about `engine/resolver.ts`, and the day a Kindle-style trait
  // lands there the sentence becomes a lie that nothing else would catch.
  const code = codeOf('src/engine/resolver.ts');
  assert.ok(
    !/\btribe\b/i.test(code),
    `src/engine/resolver.ts now mentions "tribe", so something in the fight reads a unit's ` +
      `race. RACE_HAS_NO_RULE in src/render/glossary.ts still tells the player nothing does. ` +
      `Rewrite it before this ships.`,
  );
  assert.match(RACE_HAS_NO_RULE, /not yet a rule/);
});

// --------------------------------------------------------------- the panel

test('the panel names every element of every shipped card', () => {
  for (const card of ALL_CARDS) {
    const e = viewOf(card);
    const html = explainCard(e, cardViewOf(e), CTX);
    const must: string[] = [
      card.name,
      STAT_TERMS.power.name,
      STAT_TERMS.health.name,
      STAT_TERMS.cost.name,
      STAT_TERMS.target.name,
      TRIBE_TERMS[card.tribe as Tribe].name,
      // The heraldry: the field's own name, and the charge's blazon name.
      TINCTURE_TERMS[TRIBE_FIELD[card.tribe] as Tincture].name,
      String(card.power),
      String(card.cost),
    ];
    if (card.armour > 0) must.push(STAT_TERMS.armour.name);
    for (const trait of card.traits) must.push(TRAIT_TERMS[trait].name);
    if (card.traits.length === 0) must.push('No trait');
    for (const needle of must) {
      assert.ok(
        html.includes(needle),
        `The hover panel for ${card.name} never says ${JSON.stringify(needle)}.\n${html}`,
      );
    }
    // Every trait's rule, not merely its name: a name is another symbol.
    for (const trait of card.traits) {
      const rule = TRAIT_TERMS[trait].line;
      assert.ok(
        html.includes(rule.replace(/'/g, '&#39;')) || html.includes(rule),
        `The panel for ${card.name} names ${TRAIT_TERMS[trait].name} but never gives its rule.`,
      );
    }
  }
});

test('the hero is explained too, and is not treated as a unit', () => {
  const e = heroView();
  const html = explainCard(e, cardViewOf(e), CTX);
  assert.ok(html.includes(PLAYER_HERO.name), 'the hero panel does not name the hero');
  assert.ok(html.includes('Your hero'), 'the hero panel does not say whose hero it is');
  assert.ok(html.includes(STAT_TERMS.health.name), 'the hero panel does not name Health');
  assert.ok(
    !html.includes(STAT_TERMS.cost.name),
    'the hero panel offers an Energy cost; a hero is not played from hand',
  );
  assert.ok(html.includes('swings last'), 'the hero panel does not say the hero acts last');
});

test('every card says that attacking costs, and a hero says it is the exception', () => {
  // The trade is the one rule on the board with no symbol on the card. Power is
  // drawn; "and that number is also what comes back at you" is not, and the only
  // other place a player meets it is a corpse in the log. So the panel has to
  // carry it, on every card, and it has to carry the *right* half: a hero pays
  // nothing on its own swing and a unit pays everything.
  // Both target-chance branches, because they compose the summary line
  // differently and only one of them is the one a fixture reaches by default.
  for (const card of ALL_CARDS) {
    for (const chance of [0.5, 0]) {
      const e = viewOf(card);
      const html = explainCard(e, cardViewOf(e), { ...CTX, chance });
      assert.ok(
        html.includes(esc(RETALIATION_UNIT)),
        `The panel for ${card.name} at target chance ${chance} never says that attacking costs ` +
          `it. Combat is mutual and nothing drawn on the card says so.`,
      );
      assert.ok(
        !html.includes(esc(RETALIATION_HERO)),
        `The panel for ${card.name} gives it the hero's exemption from retaliation. It is a ` +
          `unit; it pays.`,
      );
    }
  }
  const hero = heroView();
  const heroHtml = explainCard(hero, cardViewOf(hero), CTX);
  assert.ok(
    heroHtml.includes(esc(RETALIATION_HERO)),
    'The hero panel does not say the hero is exempt from retaliation on its own swing.',
  );
  assert.ok(
    !heroHtml.includes(esc(RETALIATION_UNIT)),
    'The hero panel tells the player their hero pays a price the resolver does not charge it.',
  );
});

test('the summary line stays inside the two lines the panel’s placement can afford', () => {
  // The arithmetic half of "the panel must not cover the board", and the reason
  // it is a gate rather than a comment: the failure is silent. The panel places
  // itself in whichever free band it fits, and at 1440x900 the tallest is 270px
  // against a panel already 266px tall. One more wrapped line in this paragraph
  // is 14.5px, and the panel stops fitting and starts covering the line the
  // player is reading - with no test red and nothing on screen saying so. The
  // devlog for this panel says it in one line: "Adding a paragraph to
  // render/inspect.ts can push it past 270px."
  //
  // Bound: 235 characters is where this paragraph wraps to a third line in the
  // 532px text column at `--fs-micro`, measured in Chrome at 1440x900 through
  // `npm run probe:ui hover 7 even light`. It is a proxy for a pixel and it is
  // stated as one - a font change or a width change moves it, and the probe,
  // not this number, is what says whether the panel still fits.
  const LIMIT = 235;
  const glossOf = (html: string): string => {
    const m = /<p class="xp__gloss">([\s\S]*?)<\/p>/.exec(html);
    assert.ok(m !== null, 'the panel has no summary line at all');
    return m[1] ?? '';
  };
  const cases: { what: string; html: string }[] = [];
  for (const card of ALL_CARDS) {
    for (const chance of [0.5, 0]) {
      const e = viewOf(card);
      cases.push({
        what: `${card.name} at target chance ${chance}`,
        html: explainCard(e, cardViewOf(e), { ...CTX, chance }),
      });
    }
  }
  for (const chance of [0.5, 0]) {
    const h = heroView();
    cases.push({
      what: `the hero at target chance ${chance}`,
      html: explainCard(h, cardViewOf(h), { ...CTX, chance }),
    });
  }
  for (const c of cases) {
    const line = glossOf(c.html);
    assert.ok(
      line.length <= LIMIT,
      `The summary line for ${c.what} is ${line.length} characters, over the ${LIMIT} that fit ` +
        `in two lines. A third line makes the panel too tall for the band it places itself in, ` +
        `and it starts covering the row the player is reading. Shorten it, or move the sentence ` +
        `onto a chip's own rule, where length is free.\n\n${line}`,
    );
  }
});

test('the trade the panel describes is the trade the resolver runs', () => {
  // The runtime half of the sentence above, and the reason it is here rather
  // than only in `test/trade.test.ts`: that file gates the *rule*, this one
  // gates the *claim about the rule*. If mutual damage is ever backed out, or
  // the hero's exemption goes the other way, the failure the player sees is a
  // panel that lies - so the message names the sentence, not the resolver.
  const state: GameState = { board: { player: [], enemy: [] }, nextUid: 1 };
  const mk = (side: 'player' | 'enemy', power: number, health: number): Entity => {
    const u = makeUnit(state, side, {
      id: 'fixture',
      name: 'fixture',
      cost: 1,
      power,
      health,
      armour: 0,
      tribe: 'human',
      traits: side === 'enemy' ? ['guard'] : [],
    });
    insertUnit(state, side, u, unitCount(state, side));
    return u;
  };
  state.board.player.push(makeHero(state, 'player', { name: 'H', health: 30, power: 4, armour: 0 }));
  state.board.enemy.push(makeHero(state, 'enemy', { name: 'E', health: 30, power: 4, armour: 0 }));
  const attacker = mk('player', 1, 20);
  const defender = mk('enemy', 3, 20);

  const unitSwing = drain(state, [{ kind: 'attack', uid: attacker.uid }], makeRng(7, 'combat'));
  assert.ok(
    unitSwing.events.some((ev) => ev.kind === 'retaliated') && attacker.health < 20,
    `${RETALIATION_UNIT}\n\nThat is what the panel tells the player, and the resolver no longer ` +
      'does it: a unit attacked and took nothing back. Rewrite RETALIATION_UNIT or restore the trade.',
  );
  assert.equal(defender.health, 19, 'the fixture is not measuring what it thinks it is');

  const hero = heroOf(state, 'player');
  const heroHealth = hero.health;
  const heroSwing = drain(state, [{ kind: 'attack', uid: hero.uid }], makeRng(8, 'combat'));
  assert.ok(
    !heroSwing.events.some((ev) => ev.kind === 'retaliated') && hero.health === heroHealth,
    `${RETALIATION_HERO}\n\nThat is what the hero panel tells the player, and the resolver now ` +
      'charges the hero for its own swing. Rewrite RETALIATION_HERO or restore the exemption.',
  );
});

test('a pending Relay is explained rather than left as a bare +2 pip', () => {
  const e = viewOf(PLAYER_CARDS[0]!);
  const html = explainCard(e, cardViewOf(e), { ...CTX, pendingPower: RELAY_POWER });
  assert.ok(html.includes(`Incoming +${RELAY_POWER} Power`), 'no incoming-Power row');
  assert.ok(html.includes('does not change'), 'the panel does not say the printed number stays put');
});

test('a card name with markup in it cannot break out of the panel', () => {
  const e = { ...viewOf(PLAYER_CARDS[0]!), name: '<img src=x onerror=alert(1)>' };
  const html = explainCard(e, cardViewOf(e), CTX);
  assert.ok(!html.includes('<img'), 'the panel interpolated a name without escaping it');
  assert.ok(html.includes('&lt;img'), 'the escaped name is missing entirely');
});

// ----------------------------------------------------------------- the icons

test('one idea, one shape: no two meanings share a drawing', () => {
  const byPath = new Map<string, IconName>();
  for (const name of ICON_NAMES) {
    const svg = iconSvg(name, { size: 16, decorative: true });
    const d = /d="([^"]+)"/.exec(svg)?.[1] ?? '';
    assert.ok(d.length > 0, `the "${name}" icon has no path data`);
    const clash = byPath.get(d);
    assert.equal(
      clash,
      undefined,
      `the "${name}" and "${clash}" icons are the same drawing. An icon set where one shape ` +
        `means two things teaches the player nothing.`,
    );
    byPath.set(d, name);
    assert.ok(iconShape(name).length > 0, `the "${name}" icon does not say what it depicts`);
  }
});

test('an icon must never be the sole carrier of its meaning', () => {
  assert.throws(
    () => iconSvg('guard', { size: 12 }),
    /never be the only carrier|accessible name/,
    'an unlabelled, non-decorative icon was allowed',
  );
  assert.match(iconSvg('guard', { size: 12, label: 'Guard' }), /role="img" aria-label="Guard"/);
  assert.match(iconSvg('guard', { size: 12, decorative: true }), /aria-hidden="true"/);
});

test('every trait pip carries its rule in text as well as in shape', () => {
  for (const card of ALL_CARDS) {
    for (const pip of traitPips(card.traits)) {
      assert.ok(pip.title.includes(pip.name), `the ${pip.name} pip's tooltip does not name it`);
      assert.ok(
        pip.title.length > pip.name.length + 4,
        `the ${pip.name} pip's tooltip is only its name; it must carry the rule too`,
      );
    }
  }
});

// ------------------------------------------------------- the compression floor

test('the trait strip still fits inside a card at the 44px floor', () => {
  // `ARCHITECTURE.md`: the unlimited board must compress, never wrap, and the
  // reviewed floor is 44px. A pip is the icon plus 4px of padding and 2px of
  // border; two of them plus the 3px gap must fit inside the card, or the strip
  // pushes the row into a horizontal scroll it does not need.
  for (const width of [MIN_CARD_W, 50, 60, 70, 78, 92]) {
    const icon = pipIconSize(width);
    const strip = 2 * (icon + 6) + 3;
    assert.ok(
      strip <= width,
      `at a ${width}px card the pips need ${strip}px: icon ${icon}px. Two pips is the most any ` +
        `shipped card shows (Guard is the silhouette, not a pip, plus one incoming-Power chip).`,
    );
    assert.ok(icon >= 9, `a ${icon}px icon at a ${width}px card is below the legibility floor`);
  }
});

test('the most pips any shipped card can show is two', () => {
  for (const card of ALL_CARDS) {
    assert.ok(
      traitPips(card.traits).length <= 1,
      `${card.name} would draw ${traitPips(card.traits).length} trait pips; the floor test above ` +
        `budgets for one trait pip plus one incoming-Power chip.`,
    );
  }
});

// -------------------------------------------------------- colour is not alone

test('two tribe fields on one line are never told apart by hue alone', () => {
  // Measured, not assumed: gules (dwarf) and vert (elf) are 139 apart in sRGB
  // and 34 apart once deuteranopia is simulated - and they stand next to each
  // other on the player's own line. The rule is that every pair must be
  // separable by *something*: either the simulated colours stay apart, or the
  // two hatchings differ.
  const APART = 60;
  const tribes = Object.keys(TRIBE_FIELD).filter((t) => t !== 'hero');
  for (let i = 0; i < tribes.length; i++) {
    for (let j = i + 1; j < tribes.length; j++) {
      const a = TRIBE_FIELD[tribes[i]!] as Tincture;
      const b = TRIBE_FIELD[tribes[j]!] as Tincture;
      if (a === b) continue;
      for (const kind of ['deuteranopia', 'protanopia'] as const) {
        const d = colourDistance(simulate(TINCTURES[a].hex, kind), simulate(TINCTURES[b].hex, kind));
        if (d >= APART) continue;
        assert.notEqual(
          hatchOf(a),
          hatchOf(b),
          `${tribes[i]} (${a}) and ${tribes[j]} (${b}) are ${d.toFixed(1)} apart under ` +
            `${kind} — indistinguishable — and carry the same hatching, so a colour-blind ` +
            `player has no channel at all for telling them apart.`,
        );
      }
    }
  }
});

test('the pair the hatching exists for is still the pair that collapses', () => {
  // If this stops failing the colour test, the palette moved and the argument
  // for the hatching switch has to be re-made rather than inherited.
  const d = colourDistance(
    simulate(TINCTURES[TRIBE_FIELD['dwarf'] as Tincture].hex, 'deuteranopia'),
    simulate(TINCTURES[TRIBE_FIELD['elf'] as Tincture].hex, 'deuteranopia'),
  );
  assert.ok(
    d < 60,
    `dwarf and elf now differ by ${d.toFixed(1)} under deuteranopia. They used to differ by 34, ` +
      `which is what the hatching switch was built for. Re-check that argument.`,
  );
});

test('hatching is off by default, so the reviewed goldens still describe the render', () => {
  // `test/golden/heraldry/` holds seven renders whose sha256 digests are what
  // work unit 2's review is bound to. A hatched field by default would strand
  // that review rather than inherit it.
  const card = cardViewOf(viewOf(PLAYER_CARDS[1]!));
  const base = { tier: 'compressed', width: 70, showCharge: true, label: true } as const;
  // Clip-path ids are a per-document counter - several cards share one page and
  // a duplicate id makes every later card clip to the first one's silhouette -
  // so two renders of the same card differ in that id and in nothing else.
  // Comparing raw strings would measure the counter rather than the drawing.
  const shape = (svg: string): string => svg.replace(/clip-\d+/g, 'clip');
  assert.equal(
    shape(renderCard(card, base)),
    shape(renderCard(card, { ...base, hatch: false })),
    'the default render is not the unhatched render',
  );
  assert.notEqual(
    shape(renderCard(card, base)),
    shape(renderCard(card, { ...base, hatch: true })),
    'asking for hatching changed nothing, so the switch does not work',
  );
  assert.ok(
    !renderCard(card, base).includes('stroke-opacity'),
    'the default render carries hatch strokes',
  );
});

test('every tincture a card can be drawn in has a hatching and a plain name', () => {
  for (const t of Object.keys(TINCTURES) as Tincture[]) {
    const term = TINCTURE_TERMS[t];
    assert.ok(term.name.length > 0, `${t} has no heraldic name`);
    assert.ok(term.plain.length > 0, `${t} has no plain-English colour name`);
    assert.ok(hatchOf(t).length > 0, `${t} has no hatching`);
  }
});

test('every shipped card renders a blazon the parser accepts', () => {
  for (const card of ALL_CARDS) {
    const blazon = blazonFor(card.id, card.tribe, card.traits.includes('guard'));
    const svg = renderCard(cardViewOf(viewOf(card)), {
      tier: 'compressed',
      width: MIN_CARD_W,
      showCharge: true,
      label: true,
      hatch: true,
    });
    assert.ok(blazon.length > 0);
    assert.match(
      svg,
      new RegExp(`aria-label="[^"]*${card.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`),
      `the card SVG for ${card.name} does not name it`,
    );
    assert.match(svg, /costs \d+ energy/, `the card SVG for ${card.name} does not say its cost`);
  }
});
