/**
 * Gate: every work plan under `docs/work/` is one the fleet allocator will
 * accept.
 *
 * A malformed `plan.md` does not hurt the plan it is in. It stops the *next*
 * allocation, in someone else's session, hours later: `work-docs.mjs create`
 * validates every existing unit before it reserves a new ID, so one bad Status
 * line blocks the whole sequence. That happened three times in one day, each
 * time found by someone who had not written the bad plan. The shapes were
 * `Status: complete, on branch worktree-agent-...`, `Status: implemented, on a
 * branch`, and `Status: implemented on <date>` with `## Scope` and
 * `## Implementation steps` missing outright. All three are in this gate's
 * probe, verbatim in shape.
 *
 * ## Why this reimplements the rules instead of shelling out to `../fleet`
 *
 * The rules below are transcribed from `fleet/scripts/lib/work-docs-format.mjs`
 * (`validatePlan`) and `fleet/docs/work-docs.md`'s "Plan format" section. Three
 * reasons not to call `node ../fleet/scripts/work-docs.mjs check` instead:
 *
 *   1. A gate whose only implementation lives outside the repo degrades to a
 *      no-op the moment that outside thing is missing, and a skipped gate is
 *      indistinguishable from a passing one. `../fleet` in particular does not
 *      exist from a worktree, which is where this repo's commits are made:
 *      `ROOT` is the worktree root, so `../fleet` resolves to
 *      `<repo>/.claude/worktrees/fleet` - absent. The cross-check below shows
 *      a path search can recover the real checkout from there, so that one
 *      spelling is fixable; what is not fixable is a fresh clone, a CI runner,
 *      or any machine with no `fleet/` at all, where a shell-out gate reports
 *      "fleet is not here" and skips. The rules living here mean the gate still
 *      runs on all of those, with only the cross-check skipped.
 *   2. `check` does far more than read plan files. It takes a lock in the Git
 *      common directory, compares a local reservation journal, and replays
 *      `registry.json` through every revision that ever touched it. A
 *      coordinator allocating a unit while a worker commits leaves that lock in
 *      place, and `checkWorkDocs` fails hard on it. That is a red gate for a
 *      reason that has nothing to do with the code - the same objection that
 *      keeps `npm run audit` out of `npm run gates`.
 *   3. Allocation identity is the allocator's business, checked in the primary
 *      checkout at allocation time. Plan *format* is what a commit here can
 *      break, so plan format is what this gate holds.
 *
 * The cost of reimplementing is drift, so drift is made to go red rather than
 * left as a footnote. When a `fleet/` checkout is reachable, this gate imports
 * its `validatePlan` and compares **verdicts** - not source text, so a cosmetic
 * refactor upstream is not a failure - over every probe case and every real
 * plan. Any disagreement in either direction exits 2. When no `fleet/` checkout
 * is reachable the cross-check is skipped and said to be skipped; it can never
 * turn green into red by being absent. `FLEET_DIR` overrides the search.
 *
 * ## Bound of this gate - what a green run does and does not prove
 *
 *   Scans   `docs/work/<id>_<theme>/plan.md`, every unit folder, every time.
 *           Nothing else under `docs/work/`.
 *   Checks  the folder name's shape, that `plan.md` exists, that `Status:`
 *           names one of the six allowed statuses, that `Owner:`, `Created:`
 *           and `Updated:` are present and nonempty, that the two dates are
 *           real ISO dates (round-tripped, so `2026-02-30` fails) or the
 *           `Unknown (historical record; reason)` form, and that all six
 *           required `## ` sections are present with something under them.
 *   Misses  everything about whether a plan is TRUE. `Status: complete` on
 *           unfinished work passes. An `## Outcome` reading "Pending" on a
 *           complete unit passes. Prose quality, acceptance that acceptance was
 *           met, and whether the Updated date moved when the plan did are all
 *           outside it.
 *   Misses  `registry.json` contiguity, the `docs/work/.gitattributes` bytes,
 *           Git attribute overrides, the allocation lock and journal, and the
 *           registry's Git history. Those are the allocator's checks, run in
 *           the primary checkout by `work-docs.mjs`, and are deliberately not
 *           duplicated here.
 *   Misses  `reviews/<round>_<stage>.md` format and round contiguity. No review
 *           round exists in this repo yet, and a rule that scans nothing
 *           reports "did not run" as "passed" - so it is named here as a hole
 *           rather than shipped as a rule with no inputs.
 *   Reads   text, normalising CRLF. A lone CR line ending would confuse it.
 *   Depends on nothing outside this repo. The fleet cross-check is an optional
 *           extra that can only add a failure, never remove one.
 *
 * Every rule is fired on a built-in probe before the gate is trusted to report
 * an absence, and the probe's well-formed case must trip nothing, so a detector
 * that has started matching everything is caught as well as one that has gone
 * quiet. Each probe case is built from the well-formed text by an edit that
 * must match its anchor exactly once, so a probe case cannot silently become a
 * no-op that reads as a pass.
 *
 * Exit 0 clean, 1 on a malformed plan, 2 if the gate could not run.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';
import { ROOT, nonEmpty, rel } from './scan.ts';

/** The six statuses `fleet/docs/work-docs.md` allows, in its order. */
const STATUSES: readonly string[] = [
  'planned',
  'active',
  'blocked',
  'complete',
  'cancelled',
  'legacy',
];

/** The six required headings, matched as whole lines: `## <name>`. */
const SECTIONS: readonly string[] = [
  'Problem and outcome',
  'Scope',
  'Approach',
  'Acceptance criteria',
  'Implementation steps',
  'Outcome',
];

/** Metadata labels that must be present with something after the colon. */
const METADATA: readonly string[] = ['Owner', 'Created', 'Updated'];

/** The two metadata labels that carry a date. */
const DATE_FIELDS: readonly string[] = ['Created', 'Updated'];

/** `<id>_<theme>`: a non-padded integer and a lowercase hyphenated slug. */
const UNIT_DIR = /^(?:0|[1-9]\d*)_[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** The one accepted stand-in for a date a historical import cannot supply. */
const UNKNOWN_DATE = /^Unknown \(historical record; .+\)$/;

/** Rules over a plan's text. These are the ones the fleet cross-check compares. */
type TextRule = 'status' | 'metadata' | 'date' | 'section';

/** Rules over the shape of `docs/work/` itself. Fleet checks these elsewhere. */
type TreeRule = 'folder' | 'plan-missing';

type Rule = TextRule | TreeRule;

interface Problem {
  readonly rule: Rule;
  /** Repo-relative file or folder, with forward slashes. */
  readonly where: string;
  /** 1-based line, or null when the problem is the absence of a line. */
  readonly line: number | null;
  readonly detail: string;
}

/** What would satisfy each rule, printed once per rule that fired. */
const REMEDY: Readonly<Record<Rule, string>> = {
  status: `The Status line carries one bare word from ${STATUSES.join(', ')} and nothing else. Where the work lives - a branch, a worktree, a revision - belongs in the "## Outcome" section, which is the place fleet/docs/work-docs.md reserves for the verified revision and its checks.`,
  metadata:
    'Each of Owner, Created and Updated is one line of its own, directly under the Status line, with a nonempty value after "<label>: ".',
  date: 'Created and Updated are ISO dates (YYYY-MM-DD) that name a real day. A historical import with no recorded date writes exactly "Unknown (historical record; <reason>)".',
  section:
    'Each required heading is a whole line reading "## <name>", spelt and cased exactly as listed, with at least one nonblank line under it before the next "## " heading. Record unavailable evidence in the section rather than leaving it empty or deleting it.',
  folder:
    'A work folder is named <id>_<theme>: the integer the allocator reserved, an underscore, and a lowercase hyphenated slug. Allocate it with work-docs.mjs create rather than renaming or hand-making one.',
  'plan-missing':
    'Every allocated folder holds a plan.md. It is the unit\'s entry point and its only status record; restore it rather than leaving the folder bare.',
};

/**
 * The first line matching `regexp`, with its 1-based number and first capture.
 * Fleet applies these patterns to the whole document with the `m` flag; applied
 * per line the result is the same, because none of them can span a newline, and
 * this way the line number comes for free.
 */
function firstLine(
  lines: readonly string[],
  regexp: RegExp,
): { readonly line: number; readonly value: string } | undefined {
  for (const [index, line] of lines.entries()) {
    const match = regexp.exec(line);
    if (match !== null) return { line: index + 1, value: match[1] ?? '' };
  }
  return undefined;
}

/**
 * Every rule over a plan's text, reported together rather than one at a time -
 * a plan that is wrong in three places should say so once.
 *
 * Transcribed from fleet's `validatePlan`. The regexps and the section scan are
 * deliberately identical to it, down to the exact-line heading match, so that
 * any disagreement the cross-check finds is real drift and not a near-miss.
 */
function planProblems(text: string, where: string): Problem[] {
  const lines = text.replaceAll('\r\n', '\n').split('\n');
  const found: Problem[] = [];

  const status = firstLine(lines, /^Status: (.+)$/);
  if (status === undefined) {
    found.push({
      rule: 'status',
      where,
      line: null,
      detail: 'has no "Status: <status>" line',
    });
  } else if (!STATUSES.includes(status.value.trim())) {
    found.push({
      rule: 'status',
      where,
      line: status.line,
      detail: `says Status: ${JSON.stringify(status.value.trim())}, which is not one of ${STATUSES.join(', ')}`,
    });
  }

  for (const field of METADATA) {
    if (firstLine(lines, new RegExp(`^${field}: (\\S.*)$`)) === undefined) {
      found.push({
        rule: 'metadata',
        where,
        line: null,
        detail: `has no "${field}: <value>" line with a value on it`,
      });
    }
  }

  for (const field of DATE_FIELDS) {
    // Fleet reads the date off the first `<field>: (.+)` line, which is not
    // necessarily the line that satisfied the presence check above. Matched
    // here for the same reason the regexps are copied: to leave no gap the
    // cross-check could report as drift.
    const carrier = firstLine(lines, new RegExp(`^${field}: (.+)$`));
    if (carrier === undefined) continue;
    const value = carrier.value.trim();
    const iso = /^\d{4}-\d{2}-\d{2}$/.test(value)
      ? new Date(`${value}T00:00:00Z`)
      : undefined;
    const real =
      iso !== undefined &&
      Number.isFinite(iso.valueOf()) &&
      iso.toISOString().slice(0, 10) === value;
    if (!real && !UNKNOWN_DATE.test(value)) {
      found.push({
        rule: 'date',
        where,
        line: carrier.line,
        detail: `says ${field}: ${JSON.stringify(value)}, which is neither an ISO date naming a real day nor "Unknown (historical record; <reason>)"`,
      });
    }
  }

  for (const name of SECTIONS) {
    const start = lines.indexOf(`## ${name}`);
    if (start < 0) {
      found.push({
        rule: 'section',
        where,
        line: null,
        detail: `has no line reading exactly "## ${name}"`,
      });
      continue;
    }
    let end = lines.findIndex((line, index) => index > start && /^## /.test(line));
    if (end < 0) end = lines.length;
    if (lines.slice(start + 1, end).join('\n').trim() === '') {
      found.push({
        rule: 'section',
        where,
        line: start + 1,
        detail: `has nothing under "## ${name}"`,
      });
    }
  }

  return found;
}

/** A well-formed plan: exactly what `work-docs.mjs create` writes. */
const WELL_FORMED: string = [
  '# A well-formed plan',
  '',
  'Status: planned',
  'Owner: coordinator',
  'Created: 2026-09-11',
  'Updated: 2026-09-11',
  '',
  '## Problem and outcome',
  '',
  'A well-formed plan. Define the observable outcome before implementation.',
  '',
  '## Scope',
  '',
  'Record the included work, exclusions and dependencies before implementation.',
  '',
  '## Approach',
  '',
  'Record the chosen approach and consequential tradeoffs.',
  '',
  '## Acceptance criteria',
  '',
  '- [ ] Define observable completion conditions and their checks.',
  '',
  '## Implementation steps',
  '',
  '- [ ] Agree scope and acceptance, then carry out the work.',
  '',
  '## Outcome',
  '',
  'Pending. Record the verified revision, checks and limitations at closure.',
  '',
].join('\n');

/**
 * One targeted edit to the well-formed text. The anchor must match exactly
 * once, and the result must differ: a probe case built by an edit that quietly
 * matched nothing is a no-op that passes, which is the failure this repo has
 * already been bitten by twice.
 */
function edit(text: string, from: string, to: string): string {
  const hits = text.split(from).length - 1;
  if (hits !== 1) {
    console.error(
      `GATE BROKEN: the probe anchor ${JSON.stringify(from)} matched ${hits} time(s) in the ` +
        `well-formed plan; it must match exactly once, or the probe case it builds is a no-op ` +
        `that reads as a pass.`,
    );
    process.exit(2);
  }
  const next = text.replace(from, to);
  if (next === text) {
    console.error(
      `GATE BROKEN: the probe edit ${JSON.stringify(from)} -> ${JSON.stringify(to)} changed ` +
        `nothing. The probe case it builds cannot fail.`,
    );
    process.exit(2);
  }
  return next;
}

interface ProbeCase {
  readonly name: string;
  readonly text: string;
  /** Exact count per rule. A rule absent from this map must not fire at all. */
  readonly expect: Readonly<Partial<Record<TextRule, number>>>;
}

/**
 * The probe. Cases 2-4 are the three shapes that actually blocked the
 * allocator; the rest cover the rules those three do not reach, and the first
 * case is the control - a detector that has started firing on everything fails
 * here rather than passing quietly.
 */
function probeCases(): readonly ProbeCase[] {
  return [
    { name: 'well-formed', text: WELL_FORMED, expect: {} },
    {
      name: 'status carries a branch name',
      text: edit(
        WELL_FORMED,
        'Status: planned',
        'Status: complete, on branch worktree-agent-ae829ffbddee3454e',
      ),
      expect: { status: 1 },
    },
    {
      name: 'status carries free text',
      text: edit(WELL_FORMED, 'Status: planned', 'Status: implemented, on a branch'),
      expect: { status: 1 },
    },
    {
      name: 'status is free text and two sections are gone',
      text: edit(
        edit(
          edit(WELL_FORMED, 'Status: planned', 'Status: implemented on 2026-09-09'),
          '## Scope\n\nRecord the included work, exclusions and dependencies before implementation.\n\n',
          '',
        ),
        '## Implementation steps\n\n- [ ] Agree scope and acceptance, then carry out the work.\n\n',
        '',
      ),
      expect: { status: 1, section: 2 },
    },
    {
      name: 'status line missing outright',
      text: edit(WELL_FORMED, 'Status: planned\n', ''),
      expect: { status: 1 },
    },
    {
      name: 'a section is present but empty',
      text: edit(
        WELL_FORMED,
        '## Approach\n\nRecord the chosen approach and consequential tradeoffs.\n',
        '## Approach\n',
      ),
      expect: { section: 1 },
    },
    {
      name: 'the owner line is gone',
      text: edit(WELL_FORMED, 'Owner: coordinator\n', ''),
      expect: { metadata: 1 },
    },
    {
      name: 'a date that names no real day',
      text: edit(WELL_FORMED, 'Updated: 2026-09-11', 'Updated: 2026-02-30'),
      expect: { date: 1 },
    },
    {
      name: 'a historical import with no recorded date',
      text: edit(
        WELL_FORMED,
        'Created: 2026-09-11',
        'Created: Unknown (historical record; value not recorded)',
      ),
      expect: {},
    },
  ];
}

/**
 * Instrument check: every rule is made to fire, with its exact count, and the
 * well-formed case is made to fire nothing, before the detector is trusted to
 * report an absence. Counting only the total would pass with one rule dead and
 * another over-firing.
 */
function selfTest(cases: readonly ProbeCase[]): void {
  const fired = new Set<TextRule>();
  for (const probe of cases) {
    const found = planProblems(probe.text, `probe:${probe.name}`);
    const counted = new Map<Rule, number>();
    for (const problem of found) counted.set(problem.rule, (counted.get(problem.rule) ?? 0) + 1);
    const rules: readonly TextRule[] = ['status', 'metadata', 'date', 'section'];
    for (const rule of rules) {
      const want = probe.expect[rule] ?? 0;
      const got = counted.get(rule) ?? 0;
      if (want !== got) {
        console.error(
          `GATE BROKEN: on the probe case "${probe.name}" the "${rule}" rule fired ${got} ` +
            `time(s), expected ${want}. The detector cannot be trusted to report an absence. ` +
            `Found: ${found.map((p) => `${p.rule}@${p.line ?? '-'} ${p.detail}`).join(' | ') || '(nothing)'}`,
        );
        process.exit(2);
      }
      if (want > 0) fired.add(rule);
    }
  }
  const silent = (['status', 'metadata', 'date', 'section'] as const).filter((r) => !fired.has(r));
  if (silent.length > 0) {
    console.error(
      `GATE BROKEN: the probe never exercised ${silent.join(', ')}. A rule with no probe case ` +
        `reports "did not run" as "passed".`,
    );
    process.exit(2);
  }
}

/** Fleet's `validatePlan`, when a `fleet/` checkout can be reached. */
type FleetValidate = (text: string, label: string) => void;

/** Where the fleet module was found, or why the cross-check cannot run. */
type FleetLookup =
  | { readonly kind: 'loaded'; readonly source: string; readonly validate: FleetValidate }
  | { readonly kind: 'absent'; readonly reason: string };

/**
 * Candidate `fleet/scripts/lib/work-docs-format.mjs` paths: `FLEET_DIR` when
 * set, otherwise a `fleet/` checkout beside this repo or beside any ancestor of
 * it - which is what finds the sibling from inside `.claude/worktrees/<agent>`.
 */
function fleetCandidates(): string[] {
  const tail = path.join('scripts', 'lib', 'work-docs-format.mjs');
  const explicit = process.env['FLEET_DIR'];
  if (explicit !== undefined && explicit !== '') return [path.join(explicit, tail)];
  const out: string[] = [];
  let dir = ROOT;
  for (;;) {
    out.push(path.join(dir, 'fleet', tail));
    const up = path.dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  return out;
}

async function findFleet(): Promise<FleetLookup> {
  const candidates = fleetCandidates();
  const found = candidates.find((candidate) => fs.existsSync(candidate));
  if (found === undefined) {
    return {
      kind: 'absent',
      reason: `no fleet checkout under ${candidates.length} candidate path(s) from ${rel(ROOT) || '.'}, the first being ${candidates[0] ?? '(none)'}`,
    };
  }
  let module: unknown;
  try {
    module = (await import(pathToFileURL(found).href)) as unknown;
  } catch (error) {
    return { kind: 'absent', reason: `${found} could not be imported: ${message(error)}` };
  }
  const validate = (module as { validatePlan?: unknown }).validatePlan;
  if (typeof validate !== 'function') {
    return { kind: 'absent', reason: `${found} exports no validatePlan function` };
  }
  return { kind: 'loaded', source: found, validate: validate as FleetValidate };
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Fleet's verdict on one text: null when it accepts, its complaint when not. */
function fleetVerdict(validate: FleetValidate, text: string, label: string): string | null {
  try {
    validate(text, label);
    return null;
  } catch (error) {
    return message(error);
  }
}

/**
 * Compare verdicts with fleet's own validator over the probe cases and the real
 * plans. Verdicts, not source text, so an upstream refactor is not a failure
 * and an upstream rule change is. Exits 2 on any disagreement; returns a line
 * for the clean report otherwise.
 */
async function crossCheck(
  cases: readonly ProbeCase[],
  plans: readonly { readonly where: string; readonly text: string }[],
): Promise<string> {
  const fleet = await findFleet();
  if (fleet.kind === 'absent') {
    return `skipped, and that is not a failure - ${fleet.reason}`;
  }

  // Instrument check on the borrowed validator before it is used as an
  // authority. Fleet's own `renderPlan` emits the well-formed text; a fleet
  // that rejects it is inconsistent with itself, which is fleet's problem to
  // fix and not a reason to block a commit here.
  const control = fleetVerdict(fleet.validate, WELL_FORMED, 'probe:well-formed');
  if (control !== null) {
    return (
      `skipped, and that is not a failure - ${fleet.source} rejected this gate's well-formed ` +
      `plan (${control}), so it cannot be used as an authority - report it upstream`
    );
  }

  const subjects: { readonly label: string; readonly text: string; readonly localOk: boolean }[] = [
    ...cases.map((probe) => ({
      label: `probe case "${probe.name}"`,
      text: probe.text,
      localOk: Object.keys(probe.expect).length === 0,
    })),
    ...plans.map((plan) => ({
      label: plan.where,
      text: plan.text,
      localOk: planProblems(plan.text, plan.where).length === 0,
    })),
  ];

  for (const subject of subjects) {
    const complaint = fleetVerdict(fleet.validate, subject.text, subject.label);
    const fleetOk = complaint === null;
    if (fleetOk === subject.localOk) continue;
    console.error(
      `GATE BROKEN: this gate and ${fleet.source} disagree about ${subject.label}. ` +
        (fleetOk
          ? `This gate rejects it and fleet accepts it, so this gate has drifted stricter than ` +
            `the allocator it exists to protect.`
          : `This gate accepts it and fleet rejects it (${complaint}), so a plan this gate calls ` +
            `clean will block the next allocation.`) +
        ` Re-read validatePlan in ${fleet.source} and bring the rules at the top of ` +
        `tools/gates/work-plans.ts back into line before trusting either colour.`,
    );
    process.exit(2);
  }

  return `agreed with ${fleet.source} on ${subjects.length} text(s)`;
}

/** Every unit folder directly under `docs/work/`, sorted by name. */
function unitFolders(work: string): string[] {
  if (!fs.existsSync(work)) {
    console.error(
      `GATE BROKEN: ${rel(work)} does not exist, so there is nothing to check and no way to ` +
        `tell that apart from a clean run.`,
    );
    process.exit(2);
  }
  return fs
    .readdirSync(work, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

async function main(): Promise<void> {
  const cases = probeCases();
  selfTest(cases);

  const work = path.join(ROOT, 'docs', 'work');
  const problems: Problem[] = [];
  const plans: { where: string; text: string }[] = [];

  for (const name of unitFolders(work)) {
    const folder = path.join(work, name);
    if (!UNIT_DIR.test(name)) {
      problems.push({
        rule: 'folder',
        where: rel(folder),
        line: null,
        detail: 'is not named <id>_<theme>',
      });
    }
    const plan = path.join(folder, 'plan.md');
    if (!fs.existsSync(plan)) {
      problems.push({
        rule: 'plan-missing',
        where: rel(folder),
        line: null,
        detail: 'holds no plan.md',
      });
      continue;
    }
    plans.push({ where: rel(plan), text: fs.readFileSync(plan, 'utf8') });
  }

  nonEmpty(
    plans.map((plan) => plan.where),
    'work plans under docs/work/',
  );

  for (const plan of plans) problems.push(...planProblems(plan.text, plan.where));

  const crossChecked = await crossCheck(cases, plans);

  if (problems.length > 0) {
    console.error(
      `Work plan gate FAILED: ${problems.length} problem(s) across ${plans.length} plan(s) under ` +
        `docs/work/. The next \`work-docs.mjs create\` in this repo will refuse to allocate until ` +
        `they are fixed, in whoever's session runs it.`,
    );
    const order: readonly Rule[] = [
      'folder',
      'plan-missing',
      'status',
      'metadata',
      'date',
      'section',
    ];
    for (const rule of order) {
      const group = problems.filter((problem) => problem.rule === rule);
      if (group.length === 0) continue;
      console.error('');
      for (const problem of group) {
        const at = problem.line === null ? '' : `:${problem.line}`;
        console.error(`  ${problem.where}${at}  ${problem.detail}`);
      }
      console.error(`    -> ${REMEDY[rule]}`);
    }
    console.error('');
    console.error(`Plan format: fleet/docs/work-docs.md, "Plan format".`);
    process.exit(1);
  }

  console.log(
    `Work plan gate OK: ${plans.length} plan(s) under docs/work/ name an allowed Status, carry ` +
      `${METADATA.join('/')} metadata with real dates, and fill all ${SECTIONS.length} required ` +
      `sections. Probe check: every rule fired on its own case and none fired on a well-formed ` +
      `plan. Fleet cross-check: ${crossChecked}.`,
  );
}

// Called unconditionally, for the same reason as banned-apis.ts: a
// `require.main`-style guard would turn "the gate did not run" into a silent
// exit 0. The catch is here because this gate's fleet cross-check is async -
// an unhandled rejection would be a crash, not a verdict.
main().catch((error: unknown) => {
  console.error(`GATE BROKEN: the work plan gate threw before reaching a verdict: ${message(error)}`);
  process.exit(2);
});
