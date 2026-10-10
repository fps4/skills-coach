/**
 * A skill is written in one language (ADR-0026).
 *
 * A pack's title, description, goal, tagline and error-category labels, and a block's or lesson's
 * title, are single strings in the skill's own language. Before that decision they could be authored
 * per language — `{ nl, en }` — and packs, blocks and lessons published then are still stored that
 * way. Nothing rewrites them in place; a republish writes the new shape. Until then, this is how such
 * a value is *read*: once, at the boundary where a document becomes a domain object, so every caller
 * past it sees a string.
 *
 * Pure: no database, just the rule.
 */

/** The richest shape a stored text can have: the new string, or a legacy per-language object. */
type StoredText = unknown;

/**
 * One string from a stored text.
 *
 * A legacy object resolves to English first — the interface is English (ADR-0025), and every
 * per-language value these objects held was interface-facing metadata — then the skill's content
 * language, then whatever non-empty value comes first. Anything that is neither gives `undefined`.
 */
export function singleLanguageText(value: StoredText, contentLanguage?: string): string | undefined {
  if (typeof value === 'string') return value;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;

  const entries = Object.entries(value as Record<string, unknown>).filter(
    (entry): entry is [string, string] => typeof entry[1] === 'string' && entry[1].trim() !== '',
  );
  const byLanguage = new Map(entries);
  return byLanguage.get('en') ?? (contentLanguage ? byLanguage.get(contentLanguage) : undefined) ?? entries[0]?.[1];
}

/** Set `key` to the resolved text, or leave it out when there is none — never `undefined` in place. */
function optional<K extends string>(key: K, value: StoredText, contentLanguage: string): Partial<Record<K, string>> {
  const text = singleLanguageText(value, contentLanguage);
  return text === undefined ? {} : ({ [key]: text } as Record<K, string>);
}

interface StoredPack {
  packId: string;
  title: StoredText;
  contentLanguage: string;
  description?: StoredText;
  goal?: StoredText;
  presentation?: { tagline?: StoredText };
  errorCategories: { id: string; label?: StoredText; group?: StoredText }[];
}

type Normalized<T extends StoredPack> = Omit<
  T,
  'title' | 'description' | 'goal' | 'presentation' | 'errorCategories'
> & {
  title: string;
  description?: string;
  goal?: string;
  presentation?: Omit<NonNullable<T['presentation']>, 'tagline'> & { tagline?: string };
  errorCategories: (Omit<T['errorCategories'][number], 'label' | 'group'> & { label?: string; group?: string })[];
};

/** A stored pack with every per-language field read as one string. A pack already current is unchanged. */
export function normalizePackText<T extends StoredPack>(pack: T): Normalized<T> {
  const { title, description, goal, presentation, errorCategories, ...rest } = pack;
  const language = pack.contentLanguage;

  const normalized = {
    ...rest,
    title: singleLanguageText(title, language) ?? pack.packId,
    ...('description' in pack ? optional('description', description, language) : {}),
    ...('goal' in pack ? optional('goal', goal, language) : {}),
    errorCategories: errorCategories.map(({ label, group, ...category }) => ({
      ...category,
      ...(label !== undefined ? optional('label', label, language) : {}),
      ...(group !== undefined ? optional('group', group, language) : {}),
    })),
  } as Normalized<T>;

  if (presentation !== undefined) {
    const { tagline, ...cosmetics } = presentation;
    normalized.presentation = {
      ...cosmetics,
      ...(tagline !== undefined ? optional('tagline', tagline, language) : {}),
    } as Normalized<T>['presentation'];
  }
  return normalized;
}

/** A stored block with its title read as one string; a title with nothing in it falls back to the slug. */
export function normalizeBlockText<T extends { slug: string; title: StoredText }>(
  block: T,
): Omit<T, 'title'> & { title: string } {
  return { ...block, title: singleLanguageText(block.title) ?? block.slug };
}

/** A stored lesson with its title read as one string. */
export function normalizeLessonText<T extends { title: StoredText }>(lesson: T): Omit<T, 'title'> & { title: string } {
  return { ...lesson, title: singleLanguageText(lesson.title) ?? '' };
}
