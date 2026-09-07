/**
 * The beat clock.
 *
 * `ARCHITECTURE.md` treats this as a functional requirement rather than
 * polish, and the reason is worth keeping at the top of the file: units act
 * without taking orders, so **this animation is the only channel through which
 * a player learns why anything happened**. If Relay's +2 does not visibly
 * travel from one card to its neighbour, nobody ever discovers that adjacency
 * matters.
 *
 * Two constraints pull against each other and both are met here:
 *
 *   - every step is *observed*, not inferred, so beats are strictly sequential
 *     and one card at a time is lit;
 *   - total resolution stays near three seconds at realistic width, which at
 *     fifteen units is thirty-odd beats.
 *
 * The resolution is that beats are *compressed*, not dropped: every beat still
 * fires, in order, with its own start time, and the whole schedule is scaled to
 * fit the budget with a floor under each beat so nothing becomes a flicker.
 * The visual for a beat is allowed to outlive its slot - a damage number floats
 * for longer than the beat that spawned it - which is what "batch the visual
 * while the logic stays strictly sequential" buys.
 *
 * Timing comes from `requestAnimationFrame`'s own timestamp. `performance.now`,
 * `Date.now` and `new Date()` are banned across `src/` by
 * `npm run gate:banned-apis`, and rightly: they are hidden inputs a replay does
 * not carry. A frame timestamp is not one of those - it never reaches the
 * engine, and nothing here decides anything about the fight.
 */

import type { Beat } from './view.ts';

/** Milliseconds one beat wants at 1x, before the schedule is compressed. */
const BASE_MS: Readonly<Record<Beat['kind'], number>> = {
  act: 170,
  attack: 400,
  retaliate: 300,
  fizzle: 260,
  buff: 440,
  death: 320,
};

/** The budget `ARCHITECTURE.md` names, and the floor that keeps a beat visible. */
export const TARGET_TOTAL_MS = 3000;
export const MIN_SCALE = 0.3;

export type Step = {
  readonly beat: Beat;
  /** Milliseconds from the start of the phase. */
  readonly at: number;
  /** Milliseconds this beat owns before the next one starts. */
  readonly dur: number;
};

export type Schedule = {
  readonly steps: readonly Step[];
  readonly total: number;
  /** How hard the schedule had to be squeezed, 1 = not at all. */
  readonly scale: number;
};

/**
 * Lay beats out in time. Sequential by construction: `at` is strictly
 * non-decreasing and each beat starts when the previous one's slot ends.
 */
export function schedule(beats: readonly Beat[], targetTotal = TARGET_TOTAL_MS): Schedule {
  if (beats.length === 0) return { steps: [], total: 0, scale: 1 };

  let uncompressed = 0;
  for (const b of beats) uncompressed += BASE_MS[b.kind];
  const scale = Math.min(1, Math.max(MIN_SCALE, targetTotal / uncompressed));

  const steps: Step[] = [];
  let at = 0;
  for (const beat of beats) {
    const dur = BASE_MS[beat.kind] * scale;
    steps.push({ beat, at, dur });
    at += dur;
  }
  return { steps, total: at, scale };
}

export type PlaybackHooks = {
  /** Fired once per beat, in order, at its scheduled time. */
  readonly onBeat: (step: Step) => void;
  /** Fired once, after the last beat's slot has elapsed. */
  readonly onDone: () => void;
};

export type Playback = {
  /** 0.5, 1, 2 ... multiplies the clock. */
  setSpeed: (speed: number) => void;
  /** Fire every remaining beat now and finish. The instant-resolve control. */
  finish: () => void;
  /** Abandon playback without firing anything else. */
  cancel: () => void;
  readonly running: () => boolean;
};

/**
 * A frame that arrives after the tab was hidden carries a delta of seconds,
 * which would fire an entire phase between two paint calls. Clamped, so a
 * backgrounded tab resumes the animation instead of skipping it.
 */
const MAX_FRAME_MS = 100;

export function play(
  sched: Schedule,
  hooks: PlaybackHooks,
  initialSpeed = 1,
  raf: (cb: (t: number) => void) => number = requestAnimationFrame,
): Playback {
  let speed = initialSpeed;
  let clock = 0;
  let last: number | null = null;
  let index = 0;
  let live = true;

  const fireUpTo = (t: number): void => {
    while (index < sched.steps.length && sched.steps[index]!.at <= t) {
      hooks.onBeat(sched.steps[index]!);
      index++;
    }
  };

  const frame = (t: number): void => {
    if (!live) return;
    if (last === null) last = t;
    const delta = Math.min(MAX_FRAME_MS, Math.max(0, t - last));
    last = t;
    clock += delta * speed;
    fireUpTo(clock);
    if (index >= sched.steps.length && clock >= sched.total) {
      live = false;
      hooks.onDone();
      return;
    }
    raf(frame);
  };

  // Beats at time zero fire on the first frame rather than before it, so the
  // caller has painted the starting board before anything moves.
  raf(frame);

  return {
    setSpeed(s: number): void {
      speed = s;
    },
    finish(): void {
      if (!live) return;
      live = false;
      fireUpTo(Number.POSITIVE_INFINITY);
      hooks.onDone();
    },
    cancel(): void {
      live = false;
    },
    running(): boolean {
      return live;
    },
  };
}
