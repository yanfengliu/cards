/**
 * A very small subset of blazon.
 *
 * Grammar, one clause per comma:
 *
 *     blazon  := field ("," clause)*
 *     field   := tincture
 *     clause  := "a bordure" tincture
 *              | "a" charge tincture
 *
 * Real blazon fixes the clause order (field, charge, bordure) and carries far
 * more -- ordinaries, partitions, attitudes, cadency. None of that is needed to
 * answer the question this probe asks, and a parser that accepts more than the
 * renderer draws would be lying about what the data means. So the subset is
 * deliberately small and the errors are specific: an unknown word names itself,
 * names where it appeared, and names what would have been accepted.
 */

import { type Tincture, isTincture, violatesRuleOfTincture } from './tinctures.ts';
import { type ChargeId, CHARGE_IDS, isChargeId } from './charges.ts';

export interface Blazon {
  readonly field: Tincture;
  readonly bordure?: Tincture;
  readonly charge?: { readonly id: ChargeId; readonly tincture: Tincture };
  /** The source text, kept so a card can show its own blazon in the expanded tier. */
  readonly source: string;
}

function fail(source: string, clause: string, detail: string): never {
  throw new Error(
    `Bad blazon ${JSON.stringify(source)}: clause ${JSON.stringify(clause)} ${detail}`,
  );
}

/** Charge ids are single words here; the blazon writes them as-is. */
function normalise(word: string): string {
  return word.trim().toLowerCase().replace(/[^a-z]/g, '');
}

export function parseBlazon(source: string): Blazon {
  const clauses = source
    .split(',')
    .map((c) => c.trim())
    .filter((c) => c.length > 0);

  if (clauses.length === 0) {
    throw new Error(
      `Bad blazon ${JSON.stringify(source)}: empty. A blazon starts with a field tincture, one of: ${Object.keys(
        { or: 0, argent: 0, gules: 0, azure: 0, vert: 0, sable: 0, purpure: 0, tenne: 0 },
      ).join(', ')}.`,
    );
  }

  const fieldWord = normalise(clauses[0]!);
  if (!isTincture(fieldWord)) {
    fail(
      source,
      clauses[0]!,
      `is not a tincture. The first clause is the field, and must be one of: or, argent, gules, azure, vert, sable, purpure, tenne.`,
    );
  }

  let bordure: Tincture | undefined;
  let charge: { id: ChargeId; tincture: Tincture } | undefined;

  for (const clause of clauses.slice(1)) {
    const words = clause.split(/\s+/).map(normalise).filter((w) => w.length > 0);
    // "a" / "an" / "the" carry no meaning in this subset.
    const meaningful = words.filter((w) => w !== 'a' && w !== 'an' && w !== 'the');

    if (meaningful.length !== 2) {
      fail(
        source,
        clause,
        `has ${meaningful.length} meaningful word(s); a clause is "a bordure <tincture>" or "a <charge> <tincture>".`,
      );
    }

    const [head, tail] = meaningful as [string, string];
    if (!isTincture(tail)) {
      fail(
        source,
        clause,
        `ends in ${JSON.stringify(tail)}, which is not a tincture. Expected one of: or, argent, gules, azure, vert, sable, purpure, tenne.`,
      );
    }

    if (head === 'bordure') {
      if (bordure !== undefined) {
        fail(source, clause, 'is a second bordure; a card has at most one.');
      }
      bordure = tail;
      continue;
    }

    if (!isChargeId(head)) {
      fail(
        source,
        clause,
        `names ${JSON.stringify(head)}, which is neither "bordure" nor a charge in the library. Known charges: ${CHARGE_IDS.join(', ')}.`,
      );
    }

    if (charge !== undefined) {
      fail(
        source,
        clause,
        'is a second charge; this subset draws at most one charge per card.',
      );
    }
    charge = { id: head, tincture: tail };
  }

  // Spread conditionally rather than assigning `undefined`: under
  // `exactOptionalPropertyTypes` an absent optional and one present-but-undefined
  // are different types, and "this card has no bordure" means absent.
  return {
    field: fieldWord,
    ...(bordure !== undefined ? { bordure } : {}),
    ...(charge !== undefined ? { charge } : {}),
    source,
  };
}

/**
 * Advisory contrast warnings. Not thrown: the probe must be able to render a
 * rule-of-tincture violation in order to show what it costs at 70px.
 */
export function blazonWarnings(b: Blazon): string[] {
  const out: string[] = [];
  if (b.charge !== undefined && violatesRuleOfTincture(b.field, b.charge.tincture)) {
    out.push(
      `charge ${b.charge.id} is ${b.charge.tincture} on a ${b.field} field: colour on colour or metal on metal breaks the rule of tincture.`,
    );
  }
  if (b.bordure !== undefined && violatesRuleOfTincture(b.field, b.bordure)) {
    out.push(
      `bordure is ${b.bordure} on a ${b.field} field: same class, so the bordure will read as part of the field at small size.`,
    );
  }
  return out;
}
