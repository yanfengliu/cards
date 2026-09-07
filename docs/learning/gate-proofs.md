# Gate proofs

A gate counts only once it has been made to go red by reintroducing the defect it claims to catch. This file records the mutation, the exact failure it produced, and the bound the gate carries in its own header. Newest first.

Auditing a gate means reaching what was measured at the time, never the sentence the gate carries about itself — a gate and its claim can be wrong together and look exactly like a gate that is right.

## 2026-09-06 — `npm run gate:boundaries`

Claim: nothing under `src/engine/` imports from `src/render/`, `src/ui/` or `tools/`, and nothing there references a global that only `lib.dom` declares. Bound stated in `tools/gates/boundaries.ts`.

Mutation 1, appended to `src/engine/state.ts`:

```ts
import '../render/heraldry/card.ts';
export const gateProof: string = document.title;
```

Red:

```
Import boundary gate FAILED: 2 violation(s) of the rule that src/engine/ imports nothing from src/render/, src/ui/, tools/ and touches no DOM global.

  src/engine/state.ts:190:8   imports "../render/heraldry/card.ts", which is src/render/heraldry/card.ts under src/render/
  src/engine/state.ts:191:34  references the DOM global `document`
```

Mutation 2, the other two forbidden prefixes, one of them through a dynamic import and one of them naming a directory that does not exist yet:

```ts
import '../../tools/heraldry-probe/pages.ts';
const lazy = () => import('../ui/input.ts');
export const proof = lazy;
```

Red:

```
  src/engine/state.ts:189:8   imports "../../tools/heraldry-probe/pages.ts", which is tools/heraldry-probe/pages.ts under tools/
  src/engine/state.ts:190:27  imports "../ui/input.ts", which is src/ui/input.ts under src/ui/
```

Both mutations reverted; the gate returned to green on the unmodified tree. Exit status was 1 in both red runs and 0 after the revert.

The gate also runs its own probe on every invocation — a virtual `src/engine/__gate_probe__.ts` that breaks both halves — and exits 2 if the detector does not fire on it, or if `lib.dom` was not loaded. Without that, the DOM half would pass vacuously the day the lib configuration changes, and a green run would mean nothing.

## 2026-09-06 — `npm run gate:banned-apis`

Claim: `Math.random`, `Date.now` and `performance.now` appear nowhere outside `src/engine/rng.ts`. Bound stated in `tools/gates/banned-apis.ts`.

Mutation, appended to `src/engine/resolver.ts` and `src/sim/bots.ts`:

```ts
export const coin = () => Math.random() < 0.5;
export const stamp = () => Date.now();
export const tick = () => performance.now();
```

Red:

```
Banned API gate FAILED: 3 use(s) of Math.random, Date.now or performance.now outside src/engine/rng.ts.

  src/engine/resolver.ts:314:27  Math.random
  src/engine/resolver.ts:315:28  Date.now
  src/sim/bots.ts:182:27         performance.now
```

Reverted; green again at exit 0.

The reason this gate parses rather than greps is recorded here because it is the kind of thing that gets simplified back later. On the clean tree, `grep -rn "Math\.random\|Date\.now\|performance\.now" src test tools --include=*.ts` returns **16 hits and zero real calls** — comments in `src/engine/rng.ts` and `src/sim/measure.ts` name all three in order to say they are never called, and the gate's own source names them again. A check built from the same symbol as the thing it checks proves only that the text agrees with itself. The AST sees no comments and no string literals, which is exactly the property wanted here.

The detector is also asked to find a known set of six violations in a self-test snippet before it is trusted to report an absence, and exits 2 if it finds a different number. The snippet includes one banned name in a comment and one in a string, both of which must not count.

### Known overlap

`test/determinism.test.ts` already carries a line-regex version of the banned-API check, scanning `src/engine`, `src/content` and `src/sim` non-recursively. It is weaker on three axes — it does not see `test/`, `tools/` or `src/render/`, it does not descend into subdirectories, and it decides "this line is a comment" by looking at the first two characters — but it passes, and it was left alone rather than churned while the prototype was under independent review.
