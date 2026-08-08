/**
 * Core domain entities (ADR-0004: everything skill-specific arrives through a pack).
 *
 * Nothing in this file knows about Dutch, about MongoDB, or about HTTP. A pack declares its own
 * content language, competency framework and error-category vocabulary; the runtime treats all
 * three as opaque data.
 */

/** Interface languages the product ships. Distinct from a pack's content language — ADR-0005. */
export const LOCALES = ['nl', 'en'] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = 'nl';

export function isLocale(value: unknown): value is Locale {
  return typeof value === 'string' && (LOCALES as readonly string[]).includes(value);
}

/** A string authored per interface language. Used for chrome-adjacent pack metadata only. */
export type LocalizedText = Partial<Record<Locale, string>>;

/** Resolve localized text, falling back to the other locale rather than rendering nothing. */
export function pickText(text: LocalizedText | string | undefined, locale: Locale): string {
  if (typeof text === 'string') return text;
  if (!text) return '';
  return text[locale] ?? text[locale === 'nl' ? 'en' : 'nl'] ?? '';
}

// ---------------------------------------------------------------------------
// Pack
// ---------------------------------------------------------------------------

/**
 * How a pack ladders difficulty. `levels` is ordered from easiest; `ramp` optionally says which
 * levels which blocks sit at, and what the authoring dials should be there. Both feed the brief the
 * runtime assembles for whoever writes the next block.
 */
export interface Framework {
  id: string;
  levels: string[];
  ramp?: RampStep[];
}

export interface RampStep {
  /** Inclusive block range this step covers. */
  fromBlock: number;
  toBlock: number;
  level: string;
  phase?: string;
  /** Free-form authoring guidance, e.g. { textLength: '~170 words', grammarLoad: '...' }. */
  dials?: Record<string, string>;
}

/**
 * A pack's stable vocabulary for kinds of mistake. These are the join key between correction,
 * drilling and next-block generation, so once published they must not be renamed.
 */
export interface ErrorCategoryDef {
  id: string;
  label?: LocalizedText;
  /**
   * A free label the pack groups its categories under, e.g. an exam domain. Carried to the viewer
   * and into the brief; never interpreted here. Grouping by parsing an id would make the id's shape
   * load-bearing, and ids are frozen once a pack has been corrected against.
   */
  group?: LocalizedText;
}

/** Maps a source document's headings onto section kinds, so the importer is not language-specific. */
export interface SectionMapEntry {
  /** Case-insensitive substring matched against a heading, after the leading "N." is stripped. */
  match: string;
  kind: SectionKind;
}

/** A surface the learner surface can render past the landing page. Closed set — see the schema. */
export type PackSurface = 'lessons' | 'reading' | 'drills:terms' | 'drills:word-order' | 'quiz' | 'progress';

/**
 * How a pack presents itself, declared and never interpreted here.
 *
 * The runtime carries this to the viewer the way it carries a ramp's dials to an author. `palette`
 * and `icon` are keys into registries the web app owns; an unknown one falls back there.
 */
export interface PackPresentation {
  palette?: string;
  icon?: string;
  tagline?: LocalizedText;
  /** Omitted means "everything the platform offers" — a pack opts out, not in. */
  surfaces?: PackSurface[];
}

/**
 * How a pack's material should be taught, declared and never interpreted here.
 *
 * The ramp says *how hard* block N+1 should be; this says *how it should be built*. Both are carried
 * into the brief verbatim, because the author is the one who acts on them (ADR-0001). The runtime
 * has no opinion about didactics and gains nothing by parsing one.
 *
 * Every field is free-form on purpose. A pack teaching a language, a certification syllabus and a
 * craft do not share a lesson shape, and enumerating one here would be the runtime branching on
 * which pack it is serving (ADR-0004).
 */
export interface PackMethod {
  /** The didactic commitments this program is built on. Prose, ordered by importance. */
  principles?: string[];
  /** The shape of a single lesson, in order — e.g. ['input', 'form', 'practice', 'output']. */
  lessonArc?: string[];
  /** Open authoring rules, e.g. { newTermsPerLesson: '8–12, as chunks' }. Like a ramp's dials. */
  rules?: Record<string, string>;
  /** Per-topic teaching notes, keyed by whatever the pack calls the topic. */
  sequencing?: Record<string, string>;
}

export interface PackManifest {
  packId: string;
  title: LocalizedText;
  description?: LocalizedText;
  /** BCP-47 language the pack's material is written in. Never translated — ADR-0005. */
  contentLanguage: string;
  /** Language the `translation` side of a term drill is written in. */
  translationLanguage: string;
  /** Free label, e.g. 'conversation'. Descriptive only; the runtime never branches on it. */
  skill: string;
  goal?: LocalizedText;
  framework: Framework;
  /** How to teach this pack's material. Carried into every brief; never interpreted. */
  method?: PackMethod;
  errorCategories: ErrorCategoryDef[];
  sectionMap?: SectionMapEntry[];
  /** Words stripped from the front of an answer when matching, per language. */
  matchArticles?: Record<string, string[]>;
  presentation?: PackPresentation;
  version: number;
}

// ---------------------------------------------------------------------------
// Blocks and lessons
// ---------------------------------------------------------------------------

export type BlockStatus = 'draft' | 'published' | 'archived';

export interface Block {
  blockId: string;
  packId: string;
  order: number;
  slug: string;
  title: LocalizedText | string;
  level?: string;
  theme?: string;
  /** What this block drills, e.g. re-drilled error categories or grammar topics. */
  focus?: string[];
  milestone?: string;
  status: BlockStatus;
  version: number;
  lessonCount: number;
  publishedAt?: Date;
  /**
   * Who this block was written for. Absent means the pack owns it — it is part of the programme
   * itself and every learner working the pack gets it, which is what a demo or template pack is.
   * Present means it was authored around one person's working world and only they ever see it
   * (ADR-0015).
   *
   * This is what lets a pack hold the *methodology* — the ramp, the method, the error vocabulary —
   * while the domain a lesson is written about comes from the learner's own profile.
   */
  learnerId?: string;
}

export type SectionKind =
  'text' | 'rules' | 'vocabulary' | 'questions' | 'speak' | 'write' | 'listening' | 'dictation' | 'exercise';

export interface SectionCommon {
  /** Stable within a lesson — submissions reference answers by `${sectionId}.${itemRef}`. */
  id: string;
  title?: string;
  instruction?: string;
}

export interface TextSection extends SectionCommon {
  kind: 'text';
  body: string;
}
export interface RulesSection extends SectionCommon {
  kind: 'rules';
  body: string;
}
export interface VocabularyEntry {
  term: string;
  translation: string;
  example?: string;
}
export interface VocabularySection extends SectionCommon {
  kind: 'vocabulary';
  items: VocabularyEntry[];
}
export interface PromptItem {
  ref: string;
  prompt: string;
}
export interface QuestionsSection extends SectionCommon {
  kind: 'questions';
  items: PromptItem[];
}
export interface SpeakSection extends SectionCommon {
  kind: 'speak';
  prompt: string;
  minSentences?: number;
  requirements?: string[];
}
export interface WriteSection extends SectionCommon {
  kind: 'write';
  prompt: string;
  minSentences?: number;
  requirements?: string[];
}
export interface ListeningSource {
  title: string;
  note?: string;
}
export interface ListeningSection extends SectionCommon {
  kind: 'listening';
  prompt: string;
  sources?: ListeningSource[];
}
/** `sentences` is an answer key — the surface keeps it behind a reveal. */
export interface DictationSection extends SectionCommon {
  kind: 'dictation';
  prompt?: string;
  sentences: string[];
}
/** `answers` is an answer key — the surface keeps it behind a reveal. */
export interface ExerciseSection extends SectionCommon {
  kind: 'exercise';
  prompt?: string;
  items: PromptItem[];
  answers?: { ref: string; answer: string }[];
}

export type Section =
  | TextSection
  | RulesSection
  | VocabularySection
  | QuestionsSection
  | SpeakSection
  | WriteSection
  | ListeningSection
  | DictationSection
  | ExerciseSection;

export interface Lesson {
  lessonId: string;
  blockId: string;
  packId: string;
  order: number;
  title: LocalizedText | string;
  level?: string;
  estimatedMinutes?: number;
  focus?: string;
  sections: Section[];
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

/**
 * One language's rendering of an article (ADR-0017).
 *
 * An article is a **parallel text**: the same piece, authored in more than one language, and the
 * learner flips between them. That is why the language lives on the variant rather than on the
 * article — the article is the thing, a variant is one way of reading it.
 *
 * `language` is a BCP-47 tag, matched against the interface locale and the pack's content language.
 * Nothing here assumes those are `nl` and `en`; a pack teaching Portuguese from Spanish resolves by
 * exactly the same rule.
 */
export interface ArticleBody {
  language: string;
  title: string;
  /** Markdown. Rendered by the viewer — the runtime never parses it. */
  body: string;
  /** One or two lines shown in the library list, before the learner opens it. */
  summary?: string;
}

/** Where an article came from. Kept on every article: material this is not ours carries its origin. */
export interface ArticleSource {
  url?: string;
  /** The publication, e.g. 'AWS Architecture Blog'. */
  site?: string;
  author?: string;
  publishedAt?: Date;
}

/**
 * A reading article: long-form material loaded *for one learner* (ADR-0017).
 *
 * Unlike a block, this is not the pack's curriculum — it is the learner's own domain, brought in
 * because reading about work you actually do is what makes the language stick. So it carries a
 * `learnerId` the way a learner's own drill item does (ADR-0012), and nobody else ever sees it.
 *
 * `labels` are free strings the loader chooses. The runtime groups and filters by them and never
 * interprets one, exactly as it carries a ramp's dials without reading them.
 */
export interface Article {
  articleId: string;
  packId: string;
  learnerId: string;
  /** Stable within a pack and learner. Re-loading the same slug updates the article in place. */
  slug: string;
  labels: string[];
  /** At least one. Ordered as supplied; resolution is by language, never by position. */
  bodies: ArticleBody[];
  source?: ArticleSource;
  estimatedMinutes?: number;
  addedAt: Date;
}

/**
 * That a learner has read an article.
 *
 * Kept apart from the article itself, exactly as drill state is kept apart from the drill item: an
 * article is content and may be re-loaded, and re-loading a corrected translation must not silently
 * mark it unread again.
 */
export interface ReadingState {
  learnerId: string;
  articleId: string;
  packId: string;
  readAt: Date;
}

// ---------------------------------------------------------------------------
// Drill deck
// ---------------------------------------------------------------------------

export type DrillKind = 'term' | 'word-order' | 'mcq';

export interface TermPayload {
  kind: 'term';
  term: string;
  translation: string;
  example?: string;
}

export interface McqOption {
  /** Stable within the item. What a learner submits, and what `correct` names. */
  ref: string;
  text: string;
}

/**
 * A multiple-choice question, carrying its own answer key (ADR-0014).
 *
 * `correct` holding more than one ref makes this a multiple-*response* question: every correct
 * option must be selected and no incorrect one. That is the format of the exams this kind exists
 * for, and partial credit would teach a learner that a half-right architecture passes.
 *
 * `categories` is what makes the item join the adaptation loop. Getting it wrong records an
 * occurrence against each named category, exactly as a coach's correction would.
 */
export interface McqPayload {
  kind: 'mcq';
  /** The scenario. Often long — the surface is built for a paragraph, not a line. */
  stem: string;
  options: McqOption[];
  /** Answer key. Never sent to the browser before the learner commits. */
  correct: string[];
  /** Why the right answer is right. Shown after the verdict. */
  explanation: string;
  /** Why each wrong option is wrong. This is where most of the teaching actually happens. */
  distractors?: { ref: string; why: string }[];
  /** Pack-declared error-category ids. Validated at publish — an unknown one fails it. */
  categories: string[];
  /** Free label, like a ramp's dials. Descriptive only; nothing branches on it. */
  difficulty?: string;
  /** Where the answer comes from. Keeps authoring honest and makes a disputed key checkable. */
  sourceRefs?: string[];
}

export interface WordOrderPayload {
  kind: 'word-order';
  /** The full, punctuated sentence — shown as the answer after checking. */
  sentence: string;
  /** The primary correct order, as unbreakable chunks. */
  parts: string[];
  translation: string;
  tip?: string;
  /** A second valid order of the *same* chunks. Ignored unless it is a permutation. */
  partsAlt?: string[];
}

export type DrillPayload = TermPayload | WordOrderPayload | McqPayload;

export interface DrillItem {
  drillItemId: string;
  packId: string;
  blockId: string;
  /** Which lesson introduced it, when the source says. Powers the per-lesson filter. */
  lessonOrder?: number;
  payload: DrillPayload;
  /**
   * Who sees this item. Absent means everyone working the block does. Present means only that
   * learner — either because they added the word themselves (ADR-0012) or because the block it
   * belongs to was written for them (ADR-0015).
   */
  learnerId?: string;
  /**
   * Where it came from, which is a different question from who sees it — and the two came apart
   * once a whole block could belong to one learner (ADR-0015). `pack` means a publish produced it,
   * so a republish may sweep it away; `learner` means a person added it, so nothing published may
   * ever touch it.
   *
   * Absent on documents written before the distinction existed, where `learnerId` still carried
   * both meanings; read it through `drillOrigin` rather than directly.
   */
  origin?: DrillOrigin;
}

export type DrillOrigin = 'pack' | 'learner';

/**
 * A drill item's provenance, tolerating documents written before `origin` existed.
 *
 * Back then only a learner's own words carried a `learnerId`, so the old field answers the old
 * question exactly. New writes always set `origin`, so this fallback only ever sees history.
 */
export const drillOrigin = (item: Pick<DrillItem, 'origin' | 'learnerId'>): DrillOrigin =>
  item.origin ?? (item.learnerId ? 'learner' : 'pack');

// ---------------------------------------------------------------------------
// Learner state
// ---------------------------------------------------------------------------

export interface Learner {
  learnerId: string;
  /** The `sub` claim of the identity-service token. The only identity we keep. */
  subject: string;
  email?: string;
  displayName?: string;
  uiLanguage: Locale;
  createdAt: Date;
  profile?: LearnerProfile;
}

/**
 * The working world a learner's lessons are written about (ADR-0015).
 *
 * Every field is free text and every field is optional, for the same reason a ramp's `dials` are:
 * the runtime carries this to whoever authors the next block and interprets none of it (ADR-0001).
 * A pack says how hard the next block should be and how it should be built; this says what it should
 * be *about*.
 *
 * Not identity. Identity-service owns who someone is (ADR-0002); this is what they do all day, which
 * identity-service has no reason to know and an author cannot write a lesson without.
 */
export interface LearnerProfile {
  /** The field they work in — "retail leadership and L&D", "integration architecture". */
  domain?: string;
  /** Career, employers, projects, concrete numbers worth writing a text around. */
  background?: string;
  /** What they are working towards, when it is narrower than the pack's goal. */
  targetRole?: string;
  /** Which register their world actually uses, where a pack teaches more than one. */
  register?: string;
  /** Subjects to keep out of their material. */
  avoid?: string;
  /** Anything else an author should know. */
  notes?: string;
}

export interface Enrollment {
  learnerId: string;
  packId: string;
  currentBlockId?: string;
  currentLessonOrder: number;
  startedAt: Date;
}

export interface Attempt {
  learnerId: string;
  drillItemId: string;
  stage: Stage;
  given: string;
  correct: boolean;
  /** The learner rejected the grading and asserted they were right. Recorded, never hidden. */
  acceptedOverride: boolean;
  at: Date;
}

export type Stage = 1 | 2;

// ---------------------------------------------------------------------------
// The coaching loop
// ---------------------------------------------------------------------------

export type SubmissionStatus = 'pending' | 'corrected';

export interface SubmissionAnswer {
  /** `${sectionId}.${itemRef}` for question/exercise items, or just `${sectionId}` for a write task. */
  ref: string;
  text: string;
}

export interface Submission {
  submissionId: string;
  learnerId: string;
  packId: string;
  blockId: string;
  lessonId: string;
  answers: SubmissionAnswer[];
  /** The learner's own note about how the spoken part went. Self-reported; nothing listens. */
  speakingNote?: string;
  status: SubmissionStatus;
  createdAt: Date;
  correctedAt?: Date;
}

export interface CorrectionItem {
  /** The learner's original wording. */
  original: string;
  corrected: string;
  /** Pack-declared category ids. Unknown ids are rejected at the API edge. */
  categories: string[];
  explanation?: string;
}

export interface Ratings {
  fluency?: number;
  accuracy?: number;
  courage?: number;
}

export interface Correction {
  correctionId: string;
  submissionId: string;
  learnerId: string;
  items: CorrectionItem[];
  categoryTally: Record<string, number>;
  /** Advisory only — never a persisted consequential score. See AGENTS.md. */
  ratings?: Ratings;
  note?: string;
  correctedBy: 'external-coach';
  model?: string;
  at: Date;
}

export type ErrorStatus = 'new' | 'recurring' | 'improving' | 'mastered';

export interface ErrorExample {
  wrong: string;
  right: string;
  lessonRef?: string;
  at: Date;
}

export interface ErrorLogEntry {
  learnerId: string;
  packId: string;
  category: string;
  examples: ErrorExample[];
  count: number;
  firstSeen: Date;
  lastSeen: Date;
  /** Order of the block this category last occurred in — drives the clean-block count. */
  lastBlockOrder: number;
  /** Highest block order closed so far. With `lastBlockOrder`, makes `cleanBlocks` derivable. */
  closedThrough: number;
  /** Completed blocks since the last occurrence. Two means mastered. Derived, never accumulated. */
  cleanBlocks: number;
  status: ErrorStatus;
}

export interface NextBlockBrief {
  redrill: string[];
  retire: string[];
  themeAndDifficulty?: string;
}

// ---------------------------------------------------------------------------
// Quiz sessions
// ---------------------------------------------------------------------------

/**
 * How a sitting behaves. `practice` grades each answer as it is given; `exam` withholds every
 * verdict until the session is finished, which is the only way to rehearse committing to an answer
 * you cannot check.
 */
export type QuizMode = 'practice' | 'exam';

export interface QuizAnswer {
  drillItemId: string;
  /** Option refs the learner selected. */
  chosen: string[];
  correct: boolean;
  /** Carried so the results screen can group without re-reading every item. */
  categories: string[];
  at: Date;
}

/**
 * One sitting: which items were asked, and what was answered.
 *
 * The score, the per-category breakdown and anything resembling readiness are **derived on read**,
 * never stored — the same rule the error-log status follows (ADR-0014). A stored score would be a
 * persisted judgement about a person, which is exactly what AGENTS.md forbids.
 */
export interface QuizSession {
  sessionId: string;
  learnerId: string;
  packId: string;
  blockId: string;
  mode: QuizMode;
  /** The items to ask, in order. Fixed at start so a reload does not reshuffle the sitting. */
  itemIds: string[];
  answers: QuizAnswer[];
  /** Seconds the learner asked to be held to, when they chose a timed sitting. */
  limitSeconds?: number;
  startedAt: Date;
  finishedAt?: Date;
}

export interface BlockReview {
  blockId: string;
  learnerId: string;
  whatWentWell?: string;
  topErrors?: string[];
  wordsToRevise?: string[];
  skillRatings?: Record<string, number>;
  nextBlockBrief: NextBlockBrief;
  at: Date;
}
