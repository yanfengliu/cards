/**
 * Transient effects: the arrows, beams and numbers that make a state change
 * attributable to the thing that caused it.
 *
 * `ARCHITECTURE.md` asks for three specific things and each one is a function
 * here rather than a decoration:
 *
 *   - `beam`   an attack visibly leaves its attacker and lands on its target,
 *              so "who hit whom" is seen and not deduced from two numbers
 *              changing at once.
 *   - `travel` a buff physically crosses the gap from the unit that granted it
 *              to its right-hand neighbour. This one is the reason the section
 *              exists: if Relay's +2 simply appears, the player never learns
 *              that adjacency is the game.
 *   - `float`  damage, overkill, armour absorption and Guard redirection each
 *              say what they were, over the card they happened to.
 *
 * Everything is absolutely positioned inside one overlay element that covers
 * both lines, so nothing here disturbs the flex row that must never wrap.
 */

export type FxLayer = {
  /** Attack: a beam from attacker to target. */
  beam: (from: Element, to: Element, ms: number) => void;
  /** Buff or ward: a labelled token that crosses from source to target. */
  travel: (from: Element, to: Element, label: string, cls: string, ms: number) => void;
  /**
   * A label that rises off a card and fades. `dy` lifts it clear of the other
   * labels the same beat spawns: one attack can say three things at once
   * (damage, what armour ate, that a Guard was forced into it) and stacking
   * them on one point makes all three unreadable.
   */
  float: (over: Element, label: string, cls: string, ms: number, dy?: number) => void;
  clear: () => void;
};

function centre(layer: DOMRect, node: Element): { x: number; y: number } {
  const r = node.getBoundingClientRect();
  return { x: r.left - layer.left + r.width / 2, y: r.top - layer.top + r.height / 2 };
}

export function makeFx(root: HTMLElement): FxLayer {
  const alive = new Set<HTMLElement>();

  const spawn = (cls: string): HTMLElement => {
    const node = document.createElement('div');
    node.className = cls;
    root.append(node);
    alive.add(node);
    return node;
  };

  const retire = (node: HTMLElement, after: number): void => {
    globalThis.setTimeout(() => {
      node.remove();
      alive.delete(node);
    }, after);
  };

  return {
    beam(from, to, ms) {
      const box = root.getBoundingClientRect();
      const a = centre(box, from);
      const b = centre(box, to);
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const len = Math.hypot(dx, dy);
      const node = spawn('fx fx--beam');
      node.style.left = `${a.x}px`;
      node.style.top = `${a.y}px`;
      node.style.width = `${len}px`;
      node.style.transform = `rotate(${Math.atan2(dy, dx)}rad)`;
      node.style.setProperty('--ms', `${ms}ms`);
      retire(node, ms + 120);
    },

    travel(from, to, label, cls, ms) {
      const box = root.getBoundingClientRect();
      const a = centre(box, from);
      const b = centre(box, to);
      const node = spawn(`fx fx--token ${cls}`);
      node.textContent = label;
      node.style.left = `${a.x}px`;
      node.style.top = `${a.y}px`;
      node.style.setProperty('--ms', `${ms}ms`);
      // Force a layout read so the browser has the start position before the
      // end position is set; without it the token appears already arrived.
      void node.offsetWidth;
      node.style.transform = `translate(calc(-50% + ${b.x - a.x}px), calc(-50% + ${b.y - a.y}px))`;
      node.classList.add('is-moving');
      retire(node, ms + 420);
    },

    float(over, label, cls, ms, dy = 0) {
      const box = root.getBoundingClientRect();
      const p = centre(box, over);
      const node = spawn(`fx fx--float ${cls}`);
      node.textContent = label;
      node.style.left = `${p.x}px`;
      node.style.top = `${p.y + dy}px`;
      node.style.setProperty('--ms', `${Math.max(420, ms)}ms`);
      retire(node, Math.max(420, ms) + 200);
    },

    clear() {
      for (const node of alive) node.remove();
      alive.clear();
    },
  };
}
