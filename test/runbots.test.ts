// The two style dials on `makeRunAgent`, and the words the report calls them.
//
// Why this file exists: a `.mjs` probe passed `placement: 'search'` to
// `makeRunAgent`, because that is what every table `npm run measure:run` prints
// called the arm. `PlacementStyle` has never had a `'search'`; the value is
// `'lookahead'`. `placementFor`'s switch had no `default:`, so it returned
// `undefined`, and the run died four layers down inside `src/engine/fight.ts`
// as `TypeError: policy is not a function` - an error naming neither the bad
// input nor what would have satisfied it. `docs/learning/defect-register.md`
// holds the incident; these are its gates.
//
// The defect has two halves and both are covered here, because the class is "a
// style string arriving from a caller with no typecheck" rather than "the word
// search":
//
//   1. A style the API does not accept is refused by name, for BOTH dials.
//      The route dial was the worse of the two - an unknown route silently
//      became the random router and reported a win rate, which is a wrong
//      answer returned quietly rather than a stopped one.
//   2. No table can print a style word the API would refuse, because every arm
//      label is built from the style values the arm was constructed with.
//
// The subject of these gates is a list, so `docs/policies/local-rules.md`'s "a
// gate whose subject is a list reads that list; it never restates it" applies.
// It is read here at the strongest binding the language offers: the accepted
// sets are not retyped below, they are `ROUTE_STYLES` and `PLACEMENT_STYLES`
// themselves, and each union is `(typeof ARRAY)[number]`, so a member added to
// an array IS a member of the union and the `never` guard on its missing
// `case` fails `npm run typecheck`. That rule's Bound asks for two more
// assertions and both are below: every loop asserts its array is non-empty,
// and the label test asserts it checked all six pairs, so a sweep over nothing
// cannot report as a pass.
//
// Bound -- what a green run here does and does not prove:
//
//   Proves   that each member of `ROUTE_STYLES` and `PLACEMENT_STYLES` is a
//            style the code can actually build and use, so a member added to
//            either array with no `case` cannot pass; that an unrecognised
//            value on either dial throws with the value and the whole accepted
//            set in the message, for strings and for the non-strings an
//            untypechecked caller can also pass; and that `armLabel` - the one
//            place an arm gets a name - emits nothing but accepted style values
//            and boilerplate.
//   Does not prove anything about the numbers in the report. Whether an arm's
//            win rate is right is `npm run verify:run`'s question, not this
//            file's.
//   Does not prove that some other file does not hand-write an arm label of its
//            own. What it proves is that `runArm` gives a caller no place to
//            put one: the parameter is gone.
//   Bound    to one fight per placement style and one run per route style, on
//            the seeds named below. A style that works on these seeds and
//            fails on others is not covered here.

import assert from 'node:assert/strict';
import test from 'node:test';

import { runFight } from '../src/engine/fight.ts';
import { RUN_CONTENT } from '../src/run/content.ts';
import { runChoices, runRun } from '../src/run/run.ts';
import { setupFor } from '../src/sim/measure.ts';
import {
  PLACEMENT_STYLES,
  type PlacementStyle,
  ROUTE_STYLES,
  type RouteStyle,
  makeRunAgent,
} from '../src/sim/runbots.ts';
import { armLabel, runArm } from '../src/sim/runmeasure.ts';

/**
 * `makeRunAgent` as an untypechecked caller reaches it. The casts are the
 * point of these tests rather than a wrinkle in them: the defect arrived from a
 * `.mjs` file, where the compiler is not in the room.
 */
const withPlacement = (placement: unknown): unknown =>
  makeRunAgent({ route: 'greedy', placement: placement as PlacementStyle, seed: 1 });

const withRoute = (route: unknown): unknown =>
  makeRunAgent({ route: route as RouteStyle, placement: 'right', seed: 1 });

/** The message of whatever `build` threw, or a failure if it threw nothing. */
function refusalMessage(build: () => unknown, what: string): string {
  let thrown: unknown;
  let threw = false;
  try {
    build();
  } catch (err) {
    threw = true;
    thrown = err;
  }
  assert.ok(threw, `${what} was accepted rather than refused; nothing was thrown`);
  assert.ok(thrown instanceof Error, `${what} threw ${String(thrown)}, which is not an Error`);
  return (thrown as Error).message;
}

test('an unknown placement style is refused by name, and the message names every style that is not', () => {
  const message = refusalMessage(() => withPlacement('search'), 'placement "search"');

  // The three things AGENTS.md requires of an error message: what happened,
  // which input caused it, and what would satisfy it.
  assert.ok(
    message.includes('placement'),
    `the refusal does not say which dial was wrong: ${message}`,
  );
  assert.ok(
    message.includes('"search"'),
    `the refusal does not quote the value it was given: ${message}`,
  );
  for (const style of PLACEMENT_STYLES) {
    assert.ok(
      message.includes(`"${style}"`),
      `the refusal does not offer "${style}", which is a style makeRunAgent accepts: ${message}`,
    );
  }
});

test('a placement style that is not a string still prints legibly in the refusal', () => {
  // A `.mjs` caller can pass anything, and an error that swallows its own
  // input is the failure this whole file is about. `typeof` is carried because
  // 3 and "3" are two different mistakes that print the same.
  const cases: readonly (readonly [unknown, string, string])[] = [
    [undefined, 'undefined', 'undefined'],
    [7, '7', 'number'],
    [null, 'null', 'object'],
    [{ mode: 'lookahead' }, '[object Object]', 'object'],
    [Symbol('lookahead'), 'Symbol(lookahead)', 'symbol'],
  ];
  for (const [value, shown, kind] of cases) {
    const message = refusalMessage(() => withPlacement(value), `placement ${shown}`);
    assert.ok(message.includes(shown), `the refusal lost the value ${shown}: ${message}`);
    assert.ok(
      message.includes(`typeof ${kind}`),
      `the refusal does not say the value was of type ${kind}: ${message}`,
    );
  }
});

test('an unknown route style is refused rather than quietly routing at random', () => {
  // The route dial is the half that did not crash. `makeRunAgent` used to read
  // `opts.route === 'greedy' ? GREEDY_CHOICES : randomAgentChoices(...)`, so a
  // misspelt route produced a complete, plausible, wrong measurement.
  const message = refusalMessage(() => withRoute('greedy-ish'), 'route "greedy-ish"');
  assert.ok(message.includes('route'), `the refusal does not say which dial was wrong: ${message}`);
  assert.ok(
    message.includes('"greedy-ish"'),
    `the refusal does not quote the value it was given: ${message}`,
  );
  for (const style of ROUTE_STYLES) {
    assert.ok(
      message.includes(`"${style}"`),
      `the refusal does not offer "${style}", which is a route makeRunAgent accepts: ${message}`,
    );
  }
  // And the non-string case on this dial too, since the two switches refuse
  // through one helper and a gate on one arm is not a gate on the other.
  assert.ok(refusalMessage(() => withRoute(undefined), 'route undefined').includes('undefined'));
});

test('every PLACEMENT_STYLES member builds a policy that can play a fight through', () => {
  // Bound: one fight at the primary encounter, seed 1, per style. The claim is
  // that the style is wired at all - a member added to the array with no
  // `case` falls into the refusal and turns this red, which is the run-time
  // half of the `never` guard the typecheck holds.
  assert.ok(PLACEMENT_STYLES.length > 0, 'PLACEMENT_STYLES is empty, so this test checked nothing');
  for (const placement of PLACEMENT_STYLES) {
    const agent = makeRunAgent({ route: 'greedy', placement, seed: 1 });
    assert.equal(
      typeof agent.placement,
      'function',
      `placement "${placement}" produced ${String(agent.placement)} instead of a policy`,
    );
    const played = runFight(setupFor(1), agent.placement);
    assert.notEqual(
      played.fight.result,
      'ongoing',
      `placement "${placement}" did not carry a fight to a result`,
    );
  }
});

test('every ROUTE_STYLES member builds an agent that answers a whole run', () => {
  // Bound: one shipped run per style, seed 3, placement held at `right` so the
  // run is cheap and the thing under test is the router.
  assert.ok(ROUTE_STYLES.length > 0, 'ROUTE_STYLES is empty, so this test checked nothing');
  for (const route of ROUTE_STYLES) {
    const { run, log } = runRun(RUN_CONTENT, 3, makeRunAgent({ route, placement: 'right', seed: 3 }));
    assert.notEqual(run.result, 'ongoing', `route "${route}" left the run unfinished`);
    assert.ok(runChoices(log).length > 0, `route "${route}" recorded no choices at all`);
  }
});

test('an arm label is built from style values, so no table can print a word the API refuses', () => {
  // Written as "every word in the label that is not boilerplate is a value
  // `makeRunAgent` accepts" rather than by restating the format string. A check
  // built from the same expression as the thing it checks proves only that the
  // code agrees with itself, and "greedy route / search placement" would have
  // satisfied a check that rebuilt the format.
  const accepted = new Set<string>([...ROUTE_STYLES, ...PLACEMENT_STYLES]);
  const boilerplate = new Set(['route', 'placement', '/']);

  let checked = 0;
  for (const route of ROUTE_STYLES) {
    for (const placement of PLACEMENT_STYLES) {
      const label = armLabel(route, placement);
      const styleWords = label.split(' ').filter((w) => !boilerplate.has(w));
      assert.ok(
        styleWords.length >= 2,
        `"${label}" names fewer than two styles, so it does not say what the arm is`,
      );
      for (const word of styleWords) {
        assert.ok(
          accepted.has(word),
          `the arm label "${label}" contains "${word}", which is not a style makeRunAgent ` +
            `accepts. A label a reader could copy into an API call must be a value that call ` +
            `takes; makeRunAgent takes ${[...accepted].map((s) => `"${s}"`).join(', ')}.`,
        );
      }
      assert.ok(label.includes(placement), `"${label}" does not name its placement style`);
      assert.ok(label.includes(route), `"${label}" does not name its route style`);
      checked++;
    }
  }
  assert.equal(checked, ROUTE_STYLES.length * PLACEMENT_STYLES.length, 'not every pair was checked');
});

test('runArm names itself from its own styles, and takes no name from a caller', () => {
  // The seam the report itself goes through. Every table in `runmeasure.ts`
  // prints `arm.name`, so this is the assertion that binds the label gate above
  // to what a reader of the report actually sees.
  //
  // The pairs are built over an empty seed set, which costs nothing and is
  // sound because the name is not a function of the seeds; the one real arm
  // below is what says the empty-seed path is not a special case.
  for (const route of ROUTE_STYLES) {
    for (const placement of PLACEMENT_STYLES) {
      const arm = runArm(route, placement, []);
      assert.equal(arm.route, route);
      assert.equal(arm.placement, placement);
      assert.equal(
        arm.name,
        armLabel(route, placement),
        `an arm built from ("${route}", "${placement}") named itself "${arm.name}"`,
      );
    }
  }

  const real = runArm('greedy', 'right', [3]);
  assert.equal(real.outcomes.length, 1, 'the real arm ran no seed, so it checked nothing');
  assert.equal(real.name, armLabel('greedy', 'right'));
  assert.ok(real.name.includes(real.placement), `"${real.name}" does not name "${real.placement}"`);
});
