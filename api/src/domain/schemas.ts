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

export const drillPayloadSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('term'),
    term: nonEmpty,
    translation: nonEmpty,
    example: z.string().optional(),
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
]);

export const drillItemSchema = z.object({
  lessonOrder: z.number().int().positive().optional(),
  payload: drillPayloadSchema,
});

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
 */
export const packSurfaceSchema = z.enum(['lessons', 'drills:terms', 'drills:word-order', 'progress']);

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
  errorCategories: z.array(z.object({ id: nonEmpty, label: localizedTextSchema.optional() })).min(1),
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
  lessons: z.array(lessonSchema).min(1),
  drillItems: z.array(drillItemSchema).default([]),
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

export const patchMeSchema = z.object({
  uiLanguage: localeSchema.optional(),
  displayName: z.string().max(120).optional(),
});

export type PackManifestInput = z.infer<typeof packManifestSchema>;
export type PublishBlockInput = z.infer<typeof publishBlockSchema>;
export type PostCorrectionInput = z.infer<typeof postCorrectionSchema>;
export type PostBlockReviewInput = z.infer<typeof postBlockReviewSchema>;
export type CreateSubmissionInput = z.infer<typeof createSubmissionSchema>;
export type PostAttemptInput = z.infer<typeof postAttemptSchema>;
export type PatchMeInput = z.infer<typeof patchMeSchema>;
