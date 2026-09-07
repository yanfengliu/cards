/**
 * Input. Every human action the fight accepts, turned into one `Intent`.
 *
 * Listeners are delegated from one root element and read `data-act`, so the
 * board can be re-rendered as often as an animation frame without leaking a
 * handler per card. Slots and hand cards are real `<button>` elements, which is
 * not a detail: it means Tab and Enter place a unit with no keyboard code of
 * their own, and the whole placement path is reachable without a mouse.
 */

export type Intent =
  | { readonly kind: 'selectHand'; readonly index: number }
  | { readonly kind: 'placeAt'; readonly index: number }
  | { readonly kind: 'removeGhost'; readonly id: number }
  | { readonly kind: 'commit' }
  | { readonly kind: 'skip' }
  | { readonly kind: 'speed'; readonly value: number }
  | { readonly kind: 'theme'; readonly value: 'light' | 'dark' }
  | { readonly kind: 'hatch'; readonly value: boolean }
  | { readonly kind: 'newFight' }
  | { readonly kind: 'clearSelection' }
  | { readonly kind: 'inspect'; readonly target: HTMLElement | null };

function intOf(node: HTMLElement, key: string): number | null {
  const raw = node.dataset[key];
  if (raw === undefined) return null;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) ? n : null;
}

export function wireInput(root: HTMLElement, dispatch: (intent: Intent) => void): void {
  root.addEventListener('click', (ev) => {
    const target = ev.target as HTMLElement | null;
    if (target === null) return;

    const pull = target.closest('.card__pull') as HTMLElement | null;
    if (pull !== null) {
      const ghost = pull.closest('[data-ghost]') as HTMLElement | null;
      const id = ghost === null ? null : intOf(ghost, 'ghost');
      if (id !== null) dispatch({ kind: 'removeGhost', id });
      return;
    }

    const slot = target.closest('.slot') as HTMLElement | null;
    if (slot !== null) {
      const index = intOf(slot, 'index');
      if (index !== null) dispatch({ kind: 'placeAt', index });
      return;
    }

    const hand = target.closest('.handcard') as HTMLElement | null;
    if (hand !== null) {
      const index = intOf(hand, 'index');
      if (index !== null) dispatch({ kind: 'selectHand', index });
      return;
    }

    const act = target.closest('[data-act]') as HTMLElement | null;
    if (act === null) return;
    switch (act.dataset['act']) {
      case 'commit':
        dispatch({ kind: 'commit' });
        break;
      case 'skip':
        dispatch({ kind: 'skip' });
        break;
      case 'newfight':
        dispatch({ kind: 'newFight' });
        break;
      case 'speed': {
        const value = Number.parseFloat(act.dataset['speed'] ?? '1');
        dispatch({ kind: 'speed', value: Number.isFinite(value) ? value : 1 });
        break;
      }
      case 'theme': {
        const value = act.dataset['themeValue'];
        if (value === 'light' || value === 'dark') dispatch({ kind: 'theme', value });
        break;
      }
      case 'hatch': {
        const value = act.dataset['hatchValue'];
        if (value === 'on' || value === 'off') dispatch({ kind: 'hatch', value: value === 'on' });
        break;
      }
    }
  });

  // Inspect: the expanded tier follows the pointer over anything that has a
  // card behind it. `ARCHITECTURE.md` puts the charge, the card text and the
  // trait rules in this tier, and nothing a turn decision needs.
  root.addEventListener('pointerover', (ev) => {
    const target = ev.target as HTMLElement | null;
    const card = target?.closest('[data-uid], .handcard, [data-ghost]') as HTMLElement | null;
    dispatch({ kind: 'inspect', target: card });
  });
  root.addEventListener('pointerleave', () => dispatch({ kind: 'inspect', target: null }));

  root.addEventListener('focusin', (ev) => {
    const target = ev.target as HTMLElement | null;
    const card = target?.closest('[data-uid], .handcard, [data-ghost]') as HTMLElement | null;
    dispatch({ kind: 'inspect', target: card });
  });

  globalThis.addEventListener('keydown', (ev) => {
    if (ev.defaultPrevented) return;
    const tag = (ev.target as HTMLElement | null)?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA') return;

    if (ev.key >= '1' && ev.key <= '9') {
      dispatch({ kind: 'selectHand', index: Number.parseInt(ev.key, 10) - 1 });
      ev.preventDefault();
      return;
    }
    if (ev.key === 'Escape') {
      dispatch({ kind: 'clearSelection' });
      return;
    }
    if (ev.key === 'Enter') {
      dispatch({ kind: 'commit' });
      ev.preventDefault();
    }
  });
}
