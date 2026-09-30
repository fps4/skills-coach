/**
 * Zod schemas — the validation boundary for everything that enters the system.
 *
 * With no schema enforcement in the storage layer (ADR-0003), these are where shape is guaranteed.
 * Nothing writes to MongoDB without passing through one of them.
 *
 * The nine section kinds are a closed set (ADR-0004): a pack cannot invent one, because the viewer
 * would have no way to render it. Adding a kind is a deliberate platform change — a schema entry
 * here plus a renderer in the web app.
 */

import { z } from 'zod';
import { ARCHIVE_KIND } from './portable.js';
import { LOCALES } from './types.js';

const nonEmpty = z.string().trim().min(1);

export const localeSchema = z.enum(LOCALES);
export const localizedTextSchema = z
  .object({ nl: z.string().optional(), en: z.string().optional() })
  .refine((value) => Boolean(value.nl || value.en), { message: 'at least one locale must be present' });
/** Pack titles may be a plain string when the pack does not care to localize chrome metadata. */
export const textOrLocalizedSchema = z.union([nonEmpty, localizedTextSchema]);

// ---------------------------------------------------------------------------
// Sections
// ---------------------------------------------------------------------------

const sectionCommon = {
  id: nonEmpty.regex(/^[a-z0-9][a-z0-9-]*$/i, 'section id must be slug-like'),
  title: z.string().optional(),
  instruction: z.string().optional(),
};

const promptItemSchema = z.object({ ref: nonEmpty, prompt: nonEmpty });

export const sectionSchema = z.discriminatedUnion('kind', [
  z.object({ ...sectionCommon, kind: z.literal('text'), body: nonEmpty }),
  z.object({ ...sectionCommon, kind: z.literal('rules'), body: nonEmpty }),
  z.object({
    ...sectionCommon,
    kind: z.literal('vocabulary'),
    items: z.array(z.object({ term: nonEmpty, translation: nonEmpty, example: z.string().optional() })).min(1),
  }),
  z.object({ ...sectionCommon, kind: z.literal('questions'), items: z.array(promptItemSchema).min(1) }),
  z.object({
    ...sectionCommon,
    kind: z.literal('speak'),
    prompt: nonEmpty,
    minSentences: z.number().int().positive().optional(),
    requirements: z.array(z.string()).optional(),
  }),
  z.object({
    ...sectionCommon,
    kind: z.literal('write'),
    prompt: nonEmpty,
    minSentences: z.number().int().positive().optional(),
    requirements: z.array(z.string()).optional(),
  }),
  z.object({
    ...sectionCommon,
    kind: z.literal('listening'),
    prompt: nonEmpty,
    sources: z.array(z.object({ title: nonEmpty, note: z.string().optional() })).optional(),
  }),
  // `sentences` and `answers` below are answer keys. They are delivered to the learner and kept
  // behind a reveal in the surface — faithful to the source, where answers were printed at the
  // bottom of the lesson file.
  z.object({
    ...sectionCommon,
    kind: z.literal('dictation'),
    prompt: z.string().optional(),
    sentences: z.array(nonEmpty).min(1),
  }),
  z.object({
    ...sectionCommon,
    kind: z.literal('exercise'),
    prompt: z.string().optional(),
    items: z.array(promptItemSchema).min(1),
    answers: z.array(z.object({ ref: nonEmpty, answer: nonEmpty })).optional(),
  }),
]);

export const lessonSchema = z.object({
  order: z.number().int().positive(),
  title: textOrLocalizedSchema,
  level: z.string().optional(),
  estimatedMinutes: z.number().int().positive().optional(),
  focus: z.string().optional(),
  sections: z.array(sectionSchema).min(1),
});

// ---------------------------------------------------------------------------
// Drill deck
// ---------------------------------------------------------------------------

/**
 * What a word's card can carry beyond the pair that is practised (ADR-0023). Shown, never graded.
 * Language-neutral: a past tense and a plural are both just labelled forms.
 */
export const termDetailsSchema = z.object({
  partOfSpeech: z.string().trim().max(120).optional(),
  forms: z
    .array(z.object({ label: z.string().trim().max(60), value: z.string().trim().min(1).max(200) }))
    .max(12)
    .optional(),
  exampleTranslation: z.string().trim().max(500).optional(),
  synonyms: z.array(z.string().trim().min(1).max(120)).max(12).optional(),
  antonyms: z.array(z.string().trim().min(1).max(120)).max(12).optional(),
  note: z.string().trim().max(500).optional(),
});

export const drillPayloadSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('term'),
    term: nonEmpty,
    translation: nonEmpty,
    example: z.string().optional(),
    details: termDetailsSchema.optional(),
  }),
  z.object({
    kind: z.literal('word-order'),
    sentence: nonEmpty,
    parts: z.array(nonEmpty).min(2),
    translation: nonEmpty,
    tip: z.string().optional(),
    // Not validated as a permutation here: a malformed alternative degrades the item to
    // single-order rather than failing the publish (domain/word-order.ts::usableAlternative).
    partsAlt: z.array(nonEmpty).min(2).optional(),
  }),
  /** A question carrying its own answer key (ADR-0014). Coherence of the key is checked below. */
  z.object({
    kind: z.literal('mcq'),
    stem: nonEmpty,
    options: z.array(z.object({ ref: nonEmpty, text: nonEmpty })).min(2),
    correct: z.array(nonEmpty).min(1),
    explanation: nonEmpty,
    distractors: z.array(z.object({ ref: nonEmpty, why: nonEmpty })).optional(),
    // Checked against the pack's declared vocabulary at publish, where the manifest is in hand.
    categories: z.array(nonEmpty).min(1),
    difficulty: z.string().optional(),
    sourceRefs: z.array(nonEmpty).optional(),
  }),
]);

/**
 * The ways an mcq can be schema-valid and still broken at runtime.
 *
 * Unlike a word-order alternative — where a malformed `partsAlt` degrades the item to single-order
 * rather than failing the publish — a malformed answer key is not tolerable: an item whose `correct`
 * names an option it does not define would mark every learner wrong forever, silently.
 *
 * These sit above the union rather than in it because `discriminatedUnion` takes objects, and a
 * `.refine()` is no longer one.
 */
function checkMcqPayload(payload: unknown, ctx: z.RefinementCtx, path: (string | number)[] = []): void {
  if (typeof payload !== 'object' || payload === null) return;
  const value = payload as { kind?: unknown; options?: { ref: string }[]; correct?: string[] };
  if (value.kind !== 'mcq' || !Array.isArray(value.options) || !Array.isArray(value.correct)) return;

  const refs = value.options.map((option) => option.ref);
  if (new Set(refs).size !== refs.length) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: [...path, 'options'],
      message: 'option refs must be unique within a question',
    });
  }

  const known = new Set(refs);
  const unknown = value.correct.filter((ref) => !known.has(ref));
  if (unknown.length > 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: [...path, 'correct'],
      message: `correct names options this question does not define: ${unknown.join(', ')}`,
    });
  }

  if (new Set(value.correct).size >= refs.length) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: [...path, 'correct'],
      message: 'a question whose every option is correct asks nothing',
    });
  }
}

export const drillItemSchema = z
  .object({
    lessonOrder: z.number().int().positive().optional(),
    payload: drillPayloadSchema,
  })
  .superRefine((value, ctx) => checkMcqPayload(value.payload, ctx, ['payload']));

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

/**
 * A BCP-47 language tag, loosely checked.
 *
 * Loose on purpose: the runtime matches tags against each other and never interprets one
 * (`domain/reading.ts`), so the only thing worth refusing here is something that plainly is not a
 * tag — a title, a whole sentence, an empty string — because that is what silently costs an article
 * its second language.
 */
const languageTagSchema = nonEmpty
  .max(35)
  .regex(/^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/, 'language must be a BCP-47 tag, e.g. nl or en-GB');

/**
 * One language's rendering of an article.
 *
 * `body` is markdown and is **never parsed here**. The viewer renders it, which is the same
 * division the rest of the contract keeps: the runtime carries content, the surface presents it.
 * The size cap is a sanity bound on a single document, not an editorial one — a long-form technical
 * article runs to tens of thousands of characters and is exactly what this is for.
 */
export const articleBodySchema = z.object({
  language: languageTagSchema,
  title: nonEmpty.max(300),
  body: nonEmpty.max(400_000),
  summary: z.string().trim().max(1_000).optional(),
});

/**
 * An article as it is loaded (ADR-0017).
 *
 * `slug` is the identity: re-loading the same slug for the same learner updates the article in
 * place, so a corrected translation replaces the old one and does not arrive as a second copy. It
 * carries no dot, because the article id is `${packId}.r${owner}.${slug}` and the pack is read back
 * off the first one.
 *
 * `source` is not decoration. This surface exists to carry material the learner did not write and
 * we do not own, so where a piece came from travels with it and is shown next to it.
 */
export const articleSchema = z
  .object({
    slug: nonEmpty.max(120).regex(/^[a-z0-9][a-z0-9-]*$/, 'slug must be lower-case slug-like, with no dots'),
    labels: z.array(nonEmpty.max(60)).max(24).default([]),
    bodies: z.array(articleBodySchema).min(1).max(8),
    source: z
      .object({
        url: z.string().url().max(2_000).optional(),
        site: z.string().trim().max(200).optional(),
        author: z.string().trim().max(200).optional(),
        publishedAt: z.coerce.date().optional(),
      })
      .optional(),
    estimatedMinutes: z.number().int().positive().max(600).optional(),
  })
  .superRefine((value, ctx) => {
    // Two variants in one language means one of them is unreachable: resolution is by language, so
    // the second could never be picked and the learner would silently lose it.
    const tags = value.bodies.map((entry) => entry.language.toLocaleLowerCase());
    if (new Set(tags).size !== tags.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['bodies'],
        message: 'an article cannot carry two variants in the same language',
      });
    }
  });

/**
 * Loading reading material for one learner.
 *
 * The learner is named once, for the whole batch, rather than per article: reading is personalized
 * (ADR-0017), and an endpoint where the owner is a per-item field is one typo away from filing
 * someone else's article in a learner's library.
 */
export const upsertReadingSchema = z.object({
  learnerId: nonEmpty,
  articles: z.array(articleSchema).min(1).max(50),
});

/** Marking an article read, or putting it back. */
export const setReadSchema = z.object({ read: z.boolean().default(true) });

// ---------------------------------------------------------------------------
// Pack manifest
// ---------------------------------------------------------------------------

export const sectionKindSchema = z.enum([
  'text',
  'rules',
  'vocabulary',
  'questions',
  'speak',
  'write',
  'listening',
  'dictation',
  'exercise',
]);

/**
 * The surfaces a pack offers past the landing page.
 *
 * **Closed, like the section kinds, and for the same reason** (ADR-0004): a surface the runtime
 * cannot render is the failure this contract exists to prevent, so a typo must fail the publish
 * rather than silently hide a rail item. Adding one is a platform change with a renderer behind it.
 *
 * `progress` is kept for packs published before ADR-0018, which named it. A pack now lands on its
 * own progress, so the viewer ignores the key rather than refusing it — retiring a surface must not
 * fail the next publish of a manifest that was correct when it was written.
 */
export const packSurfaceSchema = z.enum([
  'lessons',
  'reading',
  'drills:terms',
  'drills:word-order',
  'quiz',
  'progress',
]);

/**
 * How a pack presents itself.
 *
 * `palette` and `icon` are **open strings on purpose**: they are keys into registries the *viewer*
 * owns, and the api has no business enumerating a hue list it does not render. An unrecognised value
 * falls back, exactly as `framework.ramp.dials` is carried without ever being interpreted. Cosmetics
 * are not worth failing a publish over; structure is.
 */
export const packPresentationSchema = z.object({
  palette: nonEmpty.optional(),
  icon: nonEmpty.optional(),
  tagline: localizedTextSchema.optional(),
  surfaces: z.array(packSurfaceSchema).min(1).optional(),
});

/**
 * How a pack's material should be taught.
 *
 * **Open, like a ramp's dials, and for the same reason** (ADR-0001): the author acts on it, the
 * runtime only carries it. There is no key set worth enumerating here — a language pack, a
 * certification syllabus and a craft do not share a lesson shape, and a schema that insisted they
 * did would be the runtime holding an opinion about didactics it cannot act on.
 *
 * Wholly optional. A pack that declares nothing gets an author working from the dials alone, which
 * is what every pack did before this existed.
 */
export const packMethodSchema = z.object({
  principles: z.array(nonEmpty).min(1).optional(),
  lessonArc: z.array(nonEmpty).min(1).optional(),
  rules: z.record(z.string()).optional(),
  sequencing: z.record(z.string()).optional(),
});

export const packManifestSchema = z.object({
  packId: nonEmpty.regex(/^[a-z0-9][a-z0-9-]*$/, 'packId must be lower-case slug-like'),
  title: localizedTextSchema,
  description: localizedTextSchema.optional(),
  contentLanguage: nonEmpty,
  translationLanguage: nonEmpty,
  skill: nonEmpty,
  goal: localizedTextSchema.optional(),
  framework: z.object({
    id: nonEmpty,
    levels: z.array(nonEmpty).min(1),
    ramp: z
      .array(
        z.object({
          fromBlock: z.number().int().positive(),
          toBlock: z.number().int().positive(),
          level: nonEmpty,
          phase: z.string().optional(),
          dials: z.record(z.string()).optional(),
        }),
      )
      .optional(),
  }),
  method: packMethodSchema.optional(),
  // May be empty (ADR-0022). A skill that is only a word deck or only a reading list has nothing a
  // coach corrects, so it has no vocabulary of mistakes — and a correction naming any category
  // against it is refused, exactly as an unknown one is against a pack that declares some.
  errorCategories: z
    .array(
      z.object({
        id: nonEmpty,
        label: localizedTextSchema.optional(),
        // A free grouping label, e.g. an exam domain. Carried, never interpreted.
        group: localizedTextSchema.optional(),
      }),
    )
    .default([]),
  sectionMap: z.array(z.object({ match: nonEmpty, kind: sectionKindSchema })).optional(),
  matchArticles: z.record(z.array(z.string())).optional(),
  presentation: packPresentationSchema.optional(),
});

// ---------------------------------------------------------------------------
// Coach API payloads
// ---------------------------------------------------------------------------

export const publishBlockSchema = z.object({
  order: z.number().int().positive(),
  slug: nonEmpty.regex(/^[a-z0-9][a-z0-9-]*$/, 'slug must be lower-case slug-like'),
  title: textOrLocalizedSchema,
  level: z.string().optional(),
  theme: z.string().optional(),
  focus: z.array(z.string()).optional(),
  milestone: z.string().optional(),
  status: z.enum(['draft', 'published']).default('published'),
  // May be empty (ADR-0022): a block can be only a deck — the place a skill's words live, with no
  // lessons around them.
  lessons: z.array(lessonSchema).default([]),
  drillItems: z.array(drillItemSchema).default([]),
  /**
   * Who this block is for (ADR-0015). Omit and the pack owns it, which is what a demo or template
   * pack publishes; name a learner and only they ever see it.
   */
  learnerId: nonEmpty.optional(),
});

export const correctionItemSchema = z.object({
  original: nonEmpty,
  corrected: nonEmpty,
  categories: z.array(nonEmpty).min(1),
  explanation: z.string().optional(),
});

export const postCorrectionSchema = z.object({
  items: z.array(correctionItemSchema).default([]),
  ratings: z
    .object({
      fluency: z.number().min(0).max(5).optional(),
      accuracy: z.number().min(0).max(5).optional(),
      courage: z.number().min(0).max(5).optional(),
    })
    .optional(),
  note: z.string().optional(),
  model: z.string().optional(),
});

export const postBlockReviewSchema = z.object({
  whatWentWell: z.string().optional(),
  topErrors: z.array(z.string()).optional(),
  wordsToRevise: z.array(z.string()).optional(),
  skillRatings: z.record(z.number().min(0).max(5)).optional(),
  nextBlockBrief: z.object({
    redrill: z.array(z.string()).default([]),
    retire: z.array(z.string()).default([]),
    themeAndDifficulty: z.string().optional(),
  }),
});

// ---------------------------------------------------------------------------
// Learner API payloads
// ---------------------------------------------------------------------------

export const createSubmissionSchema = z.object({
  answers: z.array(z.object({ ref: nonEmpty, text: z.string() })).min(1),
  speakingNote: z.string().optional(),
});

export const postAttemptSchema = z.object({
  stage: z.union([z.literal(1), z.literal(2)]),
  /** Free text for a term item; the built chunk order for a word-order item. */
  given: z.union([z.string(), z.array(z.string())]),
  override: z.boolean().default(false),
});

/**
 * A word the learner adds to their own deck (ADR-0012).
 *
 * The same three fields a pack's vocabulary entry carries, and no more: this is the learner filling
 * the same shape from another source, not a second kind of content. `term` is in the pack's content
 * language and `translation` in its translation language, exactly as a published entry would be.
 */
export const createLearnerTermSchema = z.object({
  term: nonEmpty.max(200),
  translation: nonEmpty.max(200),
  example: z.string().trim().max(500).optional(),
  details: termDetailsSchema.optional(),
});

// ---------------------------------------------------------------------------
// Word requests (ADR-0023)
// ---------------------------------------------------------------------------

/** A learner asking for words to be filled in: one, or a pasted list. Cleaned by `requestedTerms`. */
export const requestTermsSchema = z.object({
  terms: z.array(z.string().max(500)).min(1).max(500),
});

/** What a coach proposes for one requested word. */
export const termSuggestionSchema = z.object({
  translation: nonEmpty.max(200),
  example: z.string().trim().max(500).optional(),
  details: termDetailsSchema.optional(),
});

/** The learner's decision: their edits over the suggestion, and the fields to leave off the card. */
export const acceptTermRequestSchema = z.object({
  translation: z.string().trim().max(200).optional(),
  example: z.string().trim().max(500).optional(),
  details: termDetailsSchema.optional(),
  omit: z
    .array(z.enum(['example', 'exampleTranslation', 'partOfSpeech', 'forms', 'synonyms', 'antonyms', 'note']))
    .default([]),
});

/**
 * Starting a sitting.
 *
 * `mode` is the learner's, not the pack's: rehearsing under exam conditions and learning from
 * immediate feedback are two different uses of the same bank, and which one someone needs today is
 * not something a manifest can know.
 */
export const startQuizSchema = z.object({
  blockId: nonEmpty,
  mode: z.enum(['practice', 'exam']).default('practice'),
  size: z.number().int().positive().max(75).optional(),
  /** A clock the learner asked to be held to. Advisory — nothing is voided when it runs out. */
  limitSeconds: z
    .number()
    .int()
    .positive()
    .max(4 * 60 * 60)
    .optional(),
});

export const answerQuizSchema = z.object({
  drillItemId: nonEmpty,
  /** Option refs. An empty array is a deliberate skip, and is graded as wrong — as the exam does. */
  chosen: z.array(nonEmpty).default([]),
});

/**
 * The working world a learner's blocks are written about (ADR-0015).
 *
 * Free text throughout, and bounded only so a profile cannot become an essay: an author reads this
 * alongside the pack's method, and neither is parsed by anything. Every field optional, because a
 * half-filled profile is more useful to an author than an empty one.
 */
export const learnerProfileSchema = z.object({
  domain: z.string().trim().max(200).optional(),
  background: z.string().trim().max(4000).optional(),
  targetRole: z.string().trim().max(200).optional(),
  register: z.string().trim().max(200).optional(),
  avoid: z.string().trim().max(1000).optional(),
  notes: z.string().trim().max(2000).optional(),
});

/**
 * The learner's menu as a client proposes it (ADR-0021).
 *
 * Only the shape is checked here. Reconciling it with what the learner has actually started — which
 * skills exist, which folders a placement may name — is `domain/menu.ts::normalizeMenu`, because the
 * same rule has to repair a stale stored menu on the way out.
 */
export const menuSchema = z.object({
  folders: z
    .array(
      z.object({
        folderId: z.string().regex(/^[A-Za-z0-9_-]{1,40}$/, 'a folder id is 1–40 letters, digits, - or _'),
        name: z.string().max(200),
      }),
    )
    .max(200),
  placements: z
    .array(
      z.object({
        packId: z.string().min(1).max(120),
        folderId: z.string().max(40).nullable(),
        hidden: z.boolean(),
      }),
    )
    .max(1000),
});

export const patchMeSchema = z.object({
  uiLanguage: localeSchema.optional(),
  displayName: z.string().max(120).optional(),
  profile: learnerProfileSchema.optional(),
});

// ---------------------------------------------------------------------------
// The portable archive
// ---------------------------------------------------------------------------

/**
 * A learner's archive, as it arrives from a file.
 *
 * This is the least trusted input the system takes. A pack manifest comes from a coach holding
 * `pack:publish`; an archive comes off somebody's disk, possibly hand-edited, possibly written by a
 * build of this product that no longer exists. So it is validated exactly as strictly as anything
 * else here, and the import refuses the whole file rather than applying the half of it that parsed —
 * a partly-applied archive is worse than a rejected one, because nobody can tell which half landed.
 *
 * References carry no identifier that embeds an owner; see `domain/portable.ts` for why.
 */
const blockRefSchema = z.object({
  pack: nonEmpty.max(120),
  block: z.number().int().positive().max(10_000),
  /** The block was written for one learner (ADR-0015), so its id carries an owner tag. */
  owned: z.boolean().default(false),
});

const itemRefSchema = blockRefSchema.extend({
  kind: z.enum(['term', 'word-order', 'mcq']),
  digest: z.string().regex(/^[0-9a-f]{12}$/, 'a content digest is twelve hex characters'),
  /** The learner added this word themselves (ADR-0012), so its id carries an owner tag too. */
  own: z.boolean().default(false),
});

const progressSchema = z.object({
  stage: z.union([z.literal(1), z.literal(2)]),
  streak: z.number().int().min(0).max(1_000),
  stage1Cleared: z.boolean(),
  stage2Cleared: z.boolean(),
  mastered: z.boolean(),
  attempts: z.number().int().min(0),
  correct: z.number().int().min(0),
});

/**
 * Whether a learner has read an article rides on the article rather than in a section of its own.
 *
 * Live they are two documents, deliberately — re-loading a corrected translation must not mark an
 * article unread. In a file there is nothing to re-load: the article and the fact arrive together
 * and leave together, and splitting them would only invite one to appear without the other.
 */
const archiveArticleSchema = articleSchema.and(
  z.object({
    pack: nonEmpty.max(120),
    addedAt: z.coerce.date(),
    readAt: z.coerce.date().nullable().default(null),
  }),
);

export const archiveSchema = z.object({
  kind: z.literal(ARCHIVE_KIND),
  /** Checked against `READABLE_VERSIONS` by the importer, which can say more than a schema can. */
  version: z.number().int().positive(),
  exportedAt: z.coerce.date(),
  /** What wrote the file. Advisory — for a human reading a support thread, not for a branch here. */
  generator: z.string().max(200).optional(),
  /** Pack versions at export time, so an import can report that the material has moved on. */
  packs: z.array(z.object({ packId: nonEmpty.max(120), version: z.number().int().min(0) })).default([]),
  learner: z
    .object({
      displayName: z.string().max(120).optional(),
      uiLanguage: localeSchema.optional(),
      profile: learnerProfileSchema.optional(),
      menu: menuSchema.optional(),
    })
    .default({}),
  enrollments: z
    .array(
      z.object({
        pack: nonEmpty.max(120),
        currentBlock: blockRefSchema.nullable().default(null),
        currentLessonOrder: z.number().int().min(0),
        startedAt: z.coerce.date(),
      }),
    )
    .default([]),
  drillState: z
    .array(z.object({ item: itemRefSchema, progress: progressSchema, updatedAt: z.coerce.date() }))
    .default([]),
  ownTerms: z.array(blockRefSchema.and(createLearnerTermSchema)).default([]),
  attempts: z
    .array(
      z.object({
        item: itemRefSchema,
        stage: z.union([z.literal(1), z.literal(2)]),
        given: z.string(),
        correct: z.boolean(),
        acceptedOverride: z.boolean().default(false),
        at: z.coerce.date(),
      }),
    )
    .default([]),
  submissions: z
    .array(
      z.object({
        /** Kept from the file so a correction can still name its submission after the move. */
        id: nonEmpty.max(120),
        lesson: blockRefSchema.extend({ lesson: z.number().int().positive().max(10_000) }),
        answers: z.array(z.object({ ref: nonEmpty, text: z.string() })).default([]),
        speakingNote: z.string().optional(),
        status: z.enum(['pending', 'corrected']),
        createdAt: z.coerce.date(),
        correctedAt: z.coerce.date().optional(),
      }),
    )
    .default([]),
  corrections: z
    .array(
      z.object({
        id: nonEmpty.max(120),
        submissionId: nonEmpty.max(120),
        items: z.array(correctionItemSchema).default([]),
        categoryTally: z.record(z.number().int().min(0)).default({}),
        ratings: z
          .object({
            fluency: z.number().min(0).max(5).optional(),
            accuracy: z.number().min(0).max(5).optional(),
            courage: z.number().min(0).max(5).optional(),
          })
          .optional(),
        note: z.string().optional(),
        model: z.string().optional(),
        at: z.coerce.date(),
      }),
    )
    .default([]),
  errorLog: z
    .array(
      z.object({
        pack: nonEmpty.max(120),
        category: nonEmpty.max(200),
        examples: z
          .array(
            z.object({
              wrong: z.string(),
              right: z.string(),
              lessonRef: z.string().optional(),
              at: z.coerce.date(),
            }),
          )
          .default([]),
        count: z.number().int().min(0),
        firstSeen: z.coerce.date(),
        lastSeen: z.coerce.date(),
        lastBlockOrder: z.number().int().min(0),
        closedThrough: z.number().int().min(0),
        cleanBlocks: z.number().int().min(0),
        status: z.enum(['new', 'recurring', 'improving', 'mastered']),
      }),
    )
    .default([]),
  blockReviews: z.array(blockRefSchema.and(postBlockReviewSchema).and(z.object({ at: z.coerce.date() }))).default([]),
  quizSessions: z
    .array(
      z.object({
        id: nonEmpty.max(120),
        block: blockRefSchema,
        mode: z.enum(['practice', 'exam']),
        items: z.array(itemRefSchema).default([]),
        answers: z
          .array(
            z.object({
              item: itemRefSchema,
              chosen: z.array(z.string()).default([]),
              correct: z.boolean(),
              categories: z.array(z.string()).default([]),
              at: z.coerce.date(),
            }),
          )
          .default([]),
        limitSeconds: z.number().int().positive().optional(),
        startedAt: z.coerce.date(),
        finishedAt: z.coerce.date().optional(),
      }),
    )
    .default([]),
  articles: z.array(archiveArticleSchema).default([]),
});

export type Archive = z.infer<typeof archiveSchema>;

export type PackManifestInput = z.infer<typeof packManifestSchema>;
export type PublishBlockInput = z.infer<typeof publishBlockSchema>;
export type ArticleInput = z.infer<typeof articleSchema>;
export type UpsertReadingInput = z.infer<typeof upsertReadingSchema>;
export type SetReadInput = z.infer<typeof setReadSchema>;
export type PostCorrectionInput = z.infer<typeof postCorrectionSchema>;
export type PostBlockReviewInput = z.infer<typeof postBlockReviewSchema>;
export type CreateSubmissionInput = z.infer<typeof createSubmissionSchema>;
export type CreateLearnerTermInput = z.infer<typeof createLearnerTermSchema>;
export type PostAttemptInput = z.infer<typeof postAttemptSchema>;
export type PatchMeInput = z.infer<typeof patchMeSchema>;
export type MenuInput = z.infer<typeof menuSchema>;
export type TermSuggestionInput = z.infer<typeof termSuggestionSchema>;
export type AcceptTermRequestInput = z.infer<typeof acceptTermRequestSchema>;
export type StartQuizInput = z.infer<typeof startQuizSchema>;
export type AnswerQuizInput = z.infer<typeof answerQuizSchema>;
export type LearnerProfileInput = z.infer<typeof learnerProfileSchema>;
