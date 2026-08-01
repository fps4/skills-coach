/**
 * Tolerant answer matching for `term` drills.
 *
 * The rule this implements, from the program this replaces: "Answers are matched tolerantly (case,
 * articles, `to …`, `a / b` synonyms, `(parenthetical)` optional). For anything it wrongly rejects,
 * hit 'I was right — accept ✓'."
 *
 * The override exists because tolerance can never be complete, so this deliberately errs toward
 * *strict*: it forgives shape, not spelling. Diacritics are significant — "potentiele" for
 * "potentiële" is exactly the mistake this pack is trying to train out, so accepting it would defeat
 * the stage-2 drill. Pure: no I/O, no configuration lookup.
 */

export interface MatchOptions {
  /** Leading words dropped before comparing, e.g. Dutch/English articles. */
  articles?: string[];
  /** Leading particles dropped before comparing, e.g. the English infinitive marker. */
  particles?: string[];
}

/** Covers the two languages the first pack uses; a pack may override via `matchArticles`. */
export const DEFAULT_ARTICLES = ['de', 'het', 'een', "'t", 'the', 'a', 'an'];
export const DEFAULT_PARTICLES = ['to'];

/**
 * Quotes and sentence punctuation are noise at the edges. Brackets are NOT stripped: a trailing ")"
 * belongs to a "(parenthetical)", and removing it would leave an unbalanced form that never matches
 * what the learner typed.
 */
const EDGE_PUNCTUATION = /^[\s"'“”‘’]+|[\s"'“”‘’.,;:!?]+$/g;

/**
 * Case, whitespace and edge punctuation are noise; letters and accents are not.
 * Interior punctuation is kept — "'s ochtends" and "erop neerkomen dat" must stay distinct.
 */
export function normalize(input: string): string {
  return input.normalize('NFC').replace(EDGE_PUNCTUATION, '').toLocaleLowerCase().replace(/\s+/g, ' ').trim();
}

/** Drop a single leading article or particle, e.g. "the lead time" → "lead time", "to send" → "send". */
export function stripLeadingWords(input: string, words: string[]): string {
  const [first, ...rest] = input.split(' ');
  if (first !== undefined && rest.length > 0 && words.includes(first)) {
    return rest.join(' ');
  }
  return input;
}

/**
 * Split synonym alternatives. Only ` / ` (space-slash-space) separates — the notation the source
 * CSVs use — so "and/or" and "he/she" stay one answer.
 */
export function splitAlternatives(expected: string): string[] {
  return expected
    .split(/\s+\/\s+/)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

/** "to move (house) to" yields both "to move (house) to" and "to move to". */
function withAndWithoutParentheticals(text: string): string[] {
  const stripped = text
    .replace(/\([^)]*\)/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return stripped && stripped !== text ? [text, stripped] : [text];
}

/**
 * Every form of `expected` a learner may legitimately type. Exported so the drill can show what it
 * would have accepted, and so the tests can assert the accepted set directly.
 */
export function acceptedForms(expected: string, options: MatchOptions = {}): Set<string> {
  const articles = options.articles ?? DEFAULT_ARTICLES;
  const particles = options.particles ?? DEFAULT_PARTICLES;
  const forms = new Set<string>();

  for (const alternative of splitAlternatives(expected)) {
    for (const variant of withAndWithoutParentheticals(alternative)) {
      const base = normalize(variant);
      if (!base) continue;
      forms.add(base);

      const withoutParticle = stripLeadingWords(base, particles);
      forms.add(withoutParticle);
      forms.add(stripLeadingWords(withoutParticle, articles));
      forms.add(stripLeadingWords(base, articles));
    }
  }

  forms.delete('');
  return forms;
}

/** Reduce what the learner typed the same way, so the comparison is symmetric. */
function candidateForms(given: string, options: MatchOptions = {}): string[] {
  const articles = options.articles ?? DEFAULT_ARTICLES;
  const particles = options.particles ?? DEFAULT_PARTICLES;
  const base = normalize(given);
  const withoutParticle = stripLeadingWords(base, particles);
  return [base, withoutParticle, stripLeadingWords(withoutParticle, articles), stripLeadingWords(base, articles)];
}

/** True when `given` is an acceptable rendering of `expected`. */
export function matches(given: string, expected: string, options: MatchOptions = {}): boolean {
  const accepted = acceptedForms(expected, options);
  return candidateForms(given, options).some((form) => form.length > 0 && accepted.has(form));
}
