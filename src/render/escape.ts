/**
 * Text into markup, once.
 *
 * Every module that builds HTML or SVG by string concatenation needs this, and
 * until now every one of them had its own copy of the same five lines - eight
 * copies, in `src/render/` and `src/ui/`. Seven were right. The eighth, in
 * `src/ui/runapp.ts`, mapped `>` to `&quot;`, so every tooltip and every card
 * name holding a `>` was written into the HUD and the node panel with a stray
 * quotation mark in it. An independent review found it by reading; nothing
 * could have found it by running, because a copy of a function is a copy of
 * whatever a gate does not cover.
 *
 * So there is one implementation and it is exported. `test/render-view.test.ts`
 * holds it to the four characters, and holds `src/` to having no second copy -
 * a ninth escaper appearing anywhere goes red rather than quietly drifting.
 *
 * The four are what a `"`-quoted attribute value and an element's text both
 * need: `&` first, or the other three would be double-escaped. `'` is not in
 * the set because nothing here quotes an attribute with a single quote.
 */
export function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, (c) =>
    c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;' : '&quot;',
  );
}
