/**
 * Search rules (ADR-0030) — what becomes a document, who sees it, and what a snippet marks.
 *
 * The anchor tests are the load-bearing ones: a guide result that links to an anchor the page did
 * not render lands the learner at the top of a long guide, which is the failure search exists to
 * prevent. Invented content only (ADR-0006).
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  cardDocument,
  foldGuides,
  foldTerm,
  guideDocuments,
  normalizeTerm,
  parseGuideSource,
  plainText,
  snippet,
  snippetFor,
  tokenize,
  visibleTo,
  type GuideSource,
  type SnippetPart,
} from '../../src/domain/search.js';
import type { DrillItem } from '../../src/domain/types.js';

const guide = (body: string, overrides: Partial<GuideSource> = {}): GuideSource => ({
  skillId: 'test-skill',
  slug: 'test-guide',
  title: 'Test guide',
  summary: 'A guide written for the test.',
  body,
  ...overrides,
});

const card = (overrides: Partial<DrillItem> = {}, payload: Record<string, unknown> = {}): DrillItem =>
  ({
    drillItemId: 'test-skill.b1.d.abc',
    packId: 'test-skill',
    blockId: 'test-skill.b1',
    payload: { kind: 'term', term: 'Watermark', translation: 'How late an event may arrive', ...payload },
    ...overrides,
  }) as DrillItem;

const marked = (parts: SnippetPart[]) => parts.filter((part) => part.match).map((part) => part.text);
const joined = (parts: SnippetPart[]) => parts.map((part) => part.text).join('');

describe('terms', () => {
  it('splits on punctuation and keeps letters and digits together', () => {
    expect(tokenize('join_asof, ref() and S3-buckets!')).toEqual(['join', 'asof', 'ref', 'and', 'S3', 'buckets']);
  });

  it('folds case and accents, so a word typed without its accent still matches', () => {
    expect(foldTerm('Café')).toBe('cafe');
    expect(foldTerm('één')).toBe('een');
  });

  it('drops words too common to search on, in English and Dutch', () => {
    expect(normalizeTerm('The')).toBeNull();
    expect(normalizeTerm('het')).toBeNull();
    expect(normalizeTerm('Watermark')).toBe('watermark');
  });
});

describe('plainText', () => {
  it('reduces links to their label and drops emphasis and code ticks', () => {
    expect(plainText('See **the** [docs](https://example.invalid) for `ref()`.')).toBe('See the docs for ref().');
  });

  it('keeps code inside fences and drops the fences', () => {
    expect(plainText('Before\n```sql\nSELECT 1\n```\nAfter')).toBe('Before SELECT 1 After');
  });

  it('drops list and quote markers and table rules', () => {
    expect(plainText('- one\n1. two\n> three\n| a | b |\n|---|---|\n| c | d |')).toBe('one two three a b c d');
  });
});

describe('parseGuideSource', () => {
  it('reads title and summary out of the frontmatter', () => {
    const parsed = parseGuideSource('s', 'g', '---\ntitle: "A title"\nsummary: A summary\n---\n\n# Body');
    expect(parsed).toEqual({ skillId: 's', slug: 'g', title: 'A title', summary: 'A summary', body: '# Body' });
  });

  it('is not a guide without both keys', () => {
    expect(parseGuideSource('s', 'g', '---\ntitle: A title\n---\nbody')).toBeNull();
    expect(parseGuideSource('s', 'g', 'no frontmatter')).toBeNull();
  });

  it('reads every committed guide, as the web does', () => {
    const root = join(process.cwd(), '..', 'skills');
    if (!existsSync(root)) return;
    for (const skill of readdirSync(root)) {
      const directory = join(root, skill, 'guides');
      if (!existsSync(directory)) continue;
      for (const file of readdirSync(directory).filter((name) => name.endsWith('.md'))) {
        const source = readFileSync(join(directory, file), 'utf8');
        expect(
          parseGuideSource(skill, file.replace(/\.md$/, ''), source),
          `skills/${skill}/guides/${file}`,
        ).not.toBeNull();
      }
    }
  });
});

describe('guideDocuments', () => {
  it('makes one document for the guide and one per section', () => {
    const documents = guideDocuments(
      guide('Intro text.\n\n## First part\n\nFirst body.\n\n### A detail\n\nDetail body.'),
    );
    expect(documents.map((document) => [document.id, document.title, document.context])).toEqual([
      ['g:test-skill/test-guide', 'Test guide', ''],
      ['g:test-skill/test-guide#first-part', 'First part', 'Test guide'],
      ['g:test-skill/test-guide#a-detail', 'A detail', 'Test guide'],
    ]);
  });

  it('puts the summary and the text before the first heading into the guide document', () => {
    const [top] = guideDocuments(guide('Intro text.\n\n## First part\n\nFirst body.'));
    expect(top?.body).toBe('A guide written for the test. Intro text.');
    expect(top?.anchor).toBeUndefined();
  });

  it('gives a section the anchor rehype-slug renders — visible text, lower-cased, hyphenated', () => {
    const documents = guideDocuments(guide('## 2. The `oc` CLI vs `kubectl`\n\ntext'));
    expect(documents[1]?.anchor).toBe('2-the-oc-cli-vs-kubectl');
  });

  it('numbers a repeated heading the way the page does', () => {
    const documents = guideDocuments(guide('## Example\n\na\n\n## Example\n\nb'));
    expect(documents.slice(1).map((document) => document.anchor)).toEqual(['example', 'example-1']);
  });

  it('counts deeper headings for anchors without starting a section at them', () => {
    const documents = guideDocuments(guide('## Setup\n\n#### Notes\n\nx\n\n## Notes\n\ny'));
    expect(documents.slice(1).map((document) => document.anchor)).toEqual(['setup', 'notes-1']);
    expect(documents[1]?.body).toContain('Notes');
  });

  it('does not take a comment inside a code fence for a heading', () => {
    const documents = guideDocuments(guide('## Install\n\n```bash\n# not a heading\npip install x\n```'));
    expect(documents).toHaveLength(2);
    expect(documents[1]?.body).toContain('not a heading');
  });
});

describe('cardDocument', () => {
  it('indexes a card front as its title and back as its body, with the rest as extra', () => {
    const document = cardDocument(
      card({}, { group: 'Streaming', hint: 'about lateness', details: { analogy: 'a closing time' } }),
    );
    expect(document).toMatchObject({
      id: 'c:test-skill.b1.d.abc',
      kind: 'card',
      skillId: 'test-skill',
      title: 'Watermark',
      context: 'Streaming',
      body: 'How late an event may arrive',
      blockId: 'test-skill.b1',
    });
    expect(document?.extra).toBe('about lateness — a closing time');
  });

  it('shows a declared topic by its title, not the id the card carries (ADR-0032)', () => {
    const declared = [{ id: 'streaming', title: 'Streaming & time' }];
    expect(cardDocument(card({}, { group: 'streaming' }), undefined, declared)?.context).toBe('Streaming & time');
    expect(cardDocument(card({}, { group: 'Mine' }), undefined, declared)?.context).toBe('Mine');
  });

  it('is nothing for an exercise — finding one by its answer would be finding the answer', () => {
    const puzzle = card({}, { kind: 'word-order', sentence: 'x', parts: ['x'] });
    expect(cardDocument(puzzle)).toBeNull();
  });

  it("carries the learner's id when the card is theirs alone, or the block's when the item predates it", () => {
    expect(cardDocument(card({ learnerId: 'learner-a' }))?.learnerId).toBe('learner-a');
    expect(cardDocument(card(), 'learner-b')?.learnerId).toBe('learner-b');
    expect(cardDocument(card())).not.toHaveProperty('learnerId');
  });
});

describe('visibleTo', () => {
  it("shows everyone's documents to everyone, and a learner's own only to them", () => {
    expect(visibleTo({}, 'learner-a')).toBe(true);
    expect(visibleTo({ learnerId: 'learner-a' }, 'learner-a')).toBe(true);
    expect(visibleTo({ learnerId: 'learner-a' }, 'learner-b')).toBe(false);
  });
});

describe('foldGuides', () => {
  it('keeps the best sections of each guide and every card, in rank order', () => {
    const hits = [
      { id: 1, kind: 'guide' as const, skillId: 's', slug: 'a' },
      { id: 2, kind: 'card' as const, skillId: 's' },
      { id: 3, kind: 'guide' as const, skillId: 's', slug: 'a' },
      { id: 4, kind: 'guide' as const, skillId: 's', slug: 'b' },
      { id: 5, kind: 'guide' as const, skillId: 's', slug: 'a' },
      { id: 6, kind: 'card' as const, skillId: 's' },
    ];
    expect(foldGuides(hits, 2).map((hit) => hit.id)).toEqual([1, 2, 3, 4, 6]);
  });
});

describe('snippet', () => {
  it('marks every matched word, whatever its case or accent', () => {
    const parts = snippet('A Café near the cafe.', new Set(['cafe']));
    expect(marked(parts)).toEqual(['Café', 'cafe']);
    expect(joined(parts)).toBe('A Café near the cafe.');
  });

  it('opens the window shortly before the first match, on a space, with an ellipsis', () => {
    const text = `${'filler '.repeat(40)}the watermark decides lateness. ${'tail '.repeat(40)}`;
    const parts = snippet(text, new Set(['watermark']), 80);
    const rendered = joined(parts);
    expect(rendered.startsWith('… ')).toBe(true);
    expect(rendered.endsWith(' …')).toBe(true);
    expect(rendered).toContain('watermark');
    expect(rendered.length).toBeLessThanOrEqual(80 + 4);
  });

  it('shows the start of the text, unmarked, when nothing matched', () => {
    expect(snippet('Nothing here matches.', new Set(['absent']))).toEqual([{ text: 'Nothing here matches.' }]);
  });

  it('draws from the extra field when only that matched — a card found by its analogy shows it', () => {
    const parts = snippetFor(
      { body: 'How late an event may arrive', extra: 'like a closing time' },
      new Set(['closing']),
    );
    expect(marked(parts)).toEqual(['closing']);
  });

  it('prefers the body when it matched', () => {
    const parts = snippetFor({ body: 'How late an event may arrive', extra: 'event time' }, new Set(['event']));
    expect(joined(parts)).toBe('How late an event may arrive');
  });
});
