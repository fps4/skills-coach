/**
 * The API's shapes, as the web app consumes them.
 *
 * Hand-written rather than shared with the api package: the two are deployed independently and
 * versioned by the HTTP contract, and a compile-time coupling between them would be a lie about
 * how they actually relate. `docs/api/endpoints.md` is the contract these follow.
 */

import type { DeclaredTopic, TopicSummary } from './topics';

export interface Learner {
  learnerId: string;
  subject: string;
  email?: string;
  displayName?: string;
}

/** The learner's folders, and which skills show in the menu (ADR-0021). Always complete when read. */
export interface MenuFolder {
  folderId: string;
  name: string;
}

export interface MenuPlacement {
  packId: string;
  folderId: string | null;
  hidden: boolean;
}

export interface LearnerMenu {
  folders: MenuFolder[];
  /** One per started skill, in the learner's order. */
  placements: MenuPlacement[];
}

export interface Enrollment {
  packId: string;
  currentBlockId?: string;
  currentLessonOrder: number;
}

export interface Framework {
  id: string;
  levels: string[];
}

/** A surface this app can render for a pack. The api validates against the same closed set. */
export type PackSurface = 'lessons' | 'reading' | 'drills:terms' | 'drills:word-order' | 'quiz' | 'progress';

/**
 * How a pack asks to be presented. Declared by the pack, resolved here.
 *
 * `palette` and `icon` are keys into this app's registries, deliberately not enums in the api — an
 * unrecognised one falls back rather than failing a publish. See `lib/pack-scope.ts`.
 */
export interface PackPresentation {
  palette?: string;
  icon?: string;
  tagline?: string;
  surfaces?: PackSurface[];
}

/**
 * A skill is written in one language (ADR-0026): every text field here is one string. The api reads
 * packs stored in the older per-language shape into this one, so the viewer never sees it.
 */
export interface Pack {
  packId: string;
  title: string;
  description?: string;
  contentLanguage: string;
  translationLanguage: string;
  goal?: string;
  framework: Framework;
  errorCategories: { id: string; label?: string; group?: string }[];
  presentation?: PackPresentation;
  /** How the skill's cards are answered (ADR-0027). Absent means typed. */
  flashcards?: { grading?: CardGrading; topics?: DeclaredTopic[] };
}

export interface Block {
  blockId: string;
  packId: string;
  order: number;
  slug: string;
  title: string;
  level?: string;
  theme?: string;
  focus?: string[];
  milestone?: string;
  lessonCount: number;
}

export interface BlockProgress {
  lessonCount: number;
  completed: number;
  correctedOrders: number[];
  pendingOrders: number[];
  nextLessonOrder: number | null;
  complete: boolean;
}

export interface DeckSummary {
  total: number;
  stage1Cleared: number;
  stage2Unlocked: number;
  mastered: number;
  inProgress: number;
}

// --- lesson sections -------------------------------------------------------

export interface SectionBase {
  id: string;
  title?: string;
  instruction?: string;
}
export type Section =
  | (SectionBase & { kind: 'text'; body: string })
  | (SectionBase & { kind: 'rules'; body: string })
  | (SectionBase & { kind: 'vocabulary'; items: { term: string; translation: string; example?: string }[] })
  | (SectionBase & { kind: 'questions'; items: { ref: string; prompt: string }[] })
  | (SectionBase & { kind: 'speak'; prompt: string; minSentences?: number; requirements?: string[] })
  | (SectionBase & { kind: 'write'; prompt: string; minSentences?: number; requirements?: string[] })
  | (SectionBase & { kind: 'listening'; prompt: string; sources?: { title: string; note?: string }[] })
  | (SectionBase & { kind: 'dictation'; prompt?: string; sentences: string[] })
  | (SectionBase & {
      kind: 'exercise';
      prompt?: string;
      items: { ref: string; prompt: string }[];
      answers?: { ref: string; answer: string }[];
    });

export interface LessonSummary {
  lessonId: string;
  blockId: string;
  packId: string;
  order: number;
  title: string;
  level?: string;
  estimatedMinutes?: number;
  focus?: string;
}

export interface Lesson extends LessonSummary {
  sections: Section[];
}

// --- reading ---------------------------------------------------------------

/**
 * An article in the learner's own library (ADR-0017).
 *
 * `language` is the variant they are being *shown* — the api resolves it, so the list and the
 * article itself cannot disagree — and `inRequestedLanguage` is false when a `?language=` was asked
 * for that the article has no variant in, and the api fell back to the one the pack teaches.
 */
export interface ArticleSummary {
  articleId: string;
  packId: string;
  slug: string;
  labels: string[];
  source?: { url?: string; site?: string; author?: string; publishedAt?: string };
  estimatedMinutes?: number;
  addedAt: string;
  /** Null means unread. */
  readAt: string | null;
  language: string;
  title: string;
  summary?: string;
  inRequestedLanguage: boolean;
  languages: string[];
}

/** The article with the markdown of the resolved variant. */
export interface Article extends ArticleSummary {
  body: string;
}

export interface LabelFacet {
  label: string;
  total: number;
  unread: number;
}

export interface SourceFacet {
  site: string;
  total: number;
  unread: number;
}

export interface ReadingCounts {
  total: number;
  unread: number;
}

export interface Library {
  articles: ArticleSummary[];
  /** Every label in the library, not merely the filtered subset — a filter must show its way out. */
  labels: LabelFacet[];
  /** Every publication in the library, on the same terms as the labels. */
  sources: SourceFacet[];
  counts: ReadingCounts;
}

// --- the coaching loop -----------------------------------------------------

export interface Submission {
  submissionId: string;
  learnerId: string;
  packId: string;
  blockId: string;
  lessonId: string;
  answers: { ref: string; text: string }[];
  speakingNote?: string;
  status: 'pending' | 'corrected';
  createdAt: string;
  correctedAt?: string;
}

export interface Correction {
  correctionId: string;
  submissionId: string;
  items: { original: string; corrected: string; categories: string[]; explanation?: string }[];
  categoryTally: Record<string, number>;
  ratings?: { fluency?: number; accuracy?: number; courage?: number };
  note?: string;
  at: string;
}

export type ErrorStatus = 'new' | 'recurring' | 'improving' | 'mastered';

export interface ErrorLogEntry {
  category: string;
  examples: { wrong: string; right: string; at: string }[];
  count: number;
  firstSeen: string;
  lastSeen: string;
  cleanBlocks: number;
  status: ErrorStatus;
}

// --- drills ----------------------------------------------------------------

export type Stage = 1 | 2;

export interface DrillProgress {
  stage: Stage;
  streak: number;
  stage1Cleared: boolean;
  stage2Cleared: boolean;
  mastered: boolean;
  attempts: number;
  correct: number;
}

export interface McqOption {
  ref: string;
  text: string;
}

export type DrillPrompt =
  // `hint` is the card's cue, masked wherever it would give the answer away; `group` its section.
  | { kind: 'term'; stage: Stage; prompt: string; hint?: string; group?: string }
  | { kind: 'word-order'; stage: Stage; prompt: string; bank: string[]; leadCue?: string; tip?: string }
  // No answer key here on purpose: the browser learns which option is right only after the learner
  // has committed to one. See ADR-0014.
  | { kind: 'mcq'; stage: Stage; prompt: string; options: McqOption[]; choose: number; multiple: boolean };

export interface DueItem {
  drillItemId: string;
  stage: Stage;
  prompt: DrillPrompt;
  progress: DrillProgress;
  /** The back of the card — only in learn mode, which the learner asked for (ADR-0027). */
  card?: CardFace;
}

/** How a skill's cards are answered (ADR-0027). Absent on the manifest means typed. */
export type CardGrading = 'typed' | 'self';

/** Practise asks; learn shows. Learn records nothing (ADR-0027). */
export type DeckMode = 'practice' | 'learn';

/** The back of a card: a reveal's answer, or learn mode's. */
export interface CardFace {
  /** The answer for the stage asked — the meaning in direction 1, the term in direction 2. */
  expected: string;
  hint?: string;
  group?: string;
  example?: string;
  details?: TermDetails;
}

/** `POST /drills/:id/reveal` — the back of a card on a self-graded skill. Records nothing. */
export interface RevealResult extends CardFace {
  drillItemId: string;
  stage: Stage;
}

/** A word the learner added themselves — a `term` item they own (ADR-0012). */
/** What a word's card can carry beyond the pair that is practised (ADR-0023). Shown, never graded. */
export interface TermDetails {
  partOfSpeech?: string;
  forms?: { label: string; value: string }[];
  exampleTranslation?: string;
  synonyms?: string[];
  antonyms?: string[];
  note?: string;
  /** "Map onto what you know" (ADR-0027). */
  analogy?: string;
  /** A snippet, rendered monospace. */
  code?: string;
  /** Where in the guide the card came from. */
  source?: string;
}

export interface LearnerTerm {
  drillItemId: string;
  blockId: string;
  packId: string;
  payload: {
    kind: 'term';
    term: string;
    translation: string;
    example?: string;
    hint?: string;
    group?: string;
    details?: TermDetails;
  };
}

/** What a coach proposed for a word the learner asked to have filled in. */
export interface TermSuggestion {
  translation: string;
  example?: string;
  hint?: string;
  /** The topic a coach suggests the word belongs in (ADR-0031). */
  group?: string;
  details?: TermDetails;
}

export type TermRequestStatus = 'requested' | 'suggested' | 'added' | 'discarded';

/** A word the learner asked to have filled in, and where it has got to (ADR-0023). */
export interface TermRequest {
  requestId: string;
  packId: string;
  blockId: string;
  term: string;
  status: TermRequestStatus;
  suggestion?: TermSuggestion;
  requestedAt: string;
  suggestedAt?: string;
  resolvedAt?: string;
  drillItemId?: string;
}

/** A field the learner can leave off the card; the translation is not one. */
export type OptionalTermField = 'example' | 'hint' | 'group' | keyof TermDetails;

export interface DeckPage {
  items: DueItem[];
  /** The chosen topic's counts when there is one, the deck's otherwise. */
  summary: DeckSummary;
  /** The whole deck's topics, whichever is chosen (ADR-0031). Empty when its cards have none. */
  topics: TopicSummary[];
}

export interface AttemptResult {
  drillItemId: string;
  correct: boolean;
  overridden: boolean;
  /** The verdict is the learner's own, given after turning the card over (ADR-0027). */
  selfGraded?: boolean;
  expected: string;
  acceptedAlso?: string[];
  /** The whole card, once answered — a `term` item only (ADR-0023). */
  example?: string;
  details?: TermDetails;
  marks?: boolean[];
  otherValidOrder?: boolean;
  alternative?: string;
  tip?: string;
  progress: DrillProgress;
}

// --- quiz sittings ---------------------------------------------------------

export type QuizMode = 'practice' | 'exam';

export interface QuizAnswer {
  drillItemId: string;
  chosen: string[];
  correct: boolean;
  categories: string[];
  at: string;
}

export interface QuizSession {
  sessionId: string;
  packId: string;
  blockId: string;
  mode: QuizMode;
  itemIds: string[];
  answers: QuizAnswer[];
  limitSeconds?: number;
  startedAt: string;
  finishedAt?: string;
}

export interface QuizScore {
  asked: number;
  answered: number;
  correct: number;
  accuracy: number | null;
}

export interface CategoryBreakdown {
  category: string;
  asked: number;
  correct: number;
  accuracy: number;
}

export interface QuizSessionView {
  session: QuizSession;
  score: QuizScore;
  current: { drillItemId: string; prompt: DrillPrompt; index: number } | null;
}

/** The verdict for one answer. Null in exam mode — it arrives with the results instead. */
export interface QuizAnswerResult {
  correct: boolean;
  expected: string;
  correctRefs: string[];
  explanation?: string;
  distractors?: { ref: string; why: string }[];
  sourceRefs?: string[];
}

export interface QuizAnswerOutcome {
  session: QuizSessionView;
  result: QuizAnswerResult | null;
}

export interface QuizReviewItem {
  drillItemId: string;
  stem: string;
  options: McqOption[];
  chosen: string[];
  correctRefs: string[];
  correct: boolean;
  explanation: string;
  distractors?: { ref: string; why: string }[];
  categories: string[];
  sourceRefs?: string[];
}

export interface QuizResults {
  session: QuizSession;
  score: QuizScore;
  byCategory: CategoryBreakdown[];
  complete: boolean;
  review: QuizReviewItem[];
}

// --- composed responses ----------------------------------------------------

export interface PackProgress {
  pack: Pack;
  currentBlock: Block | null;
  blockProgress: BlockProgress | null;
  blocks: { block: Block; progress: BlockProgress }[];
  /** `topics` are the current block's deck's — the one the Flashcards tab opens (ADR-0031). */
  decks: { terms: DeckSummary; wordOrder: DeckSummary; quiz: DeckSummary; topics: TopicSummary[] };
  reading: ReadingCounts;
  /** Words this learner asked to have filled in: waiting on a coach, and waiting on them (ADR-0023). */
  wordRequests: { waiting: number; ready: number };
  quiz: { byCategory: CategoryBreakdown[]; sessions: number; score: QuizScore };
  errorLog: {
    entries: ErrorLogEntry[];
    redrill: string[];
    retire: string[];
    top: ErrorLogEntry[];
  };
}

// --- the portable archive --------------------------------------------------

/** The sections an archive is reported in, in the order the report lists them. */
export const ARCHIVE_SECTIONS = [
  'enrollments',
  'drillState',
  'ownTerms',
  'attempts',
  'submissions',
  'corrections',
  'errorLog',
  'blockReviews',
  'quizSessions',
  'articles',
] as const;

export type ArchiveSection = (typeof ARCHIVE_SECTIONS)[number];

export interface ArchiveSectionReport {
  applied: number;
  unchanged: number;
  unresolved: number;
}

export interface ArchiveImportReport {
  dryRun: boolean;
  archive: { version: number; exportedAt: string; generator?: string };
  packs: { packId: string; archived: number; live: number | null }[];
  sections: Record<ArchiveSection, ArchiveSectionReport>;
  examples: { section: ArchiveSection; ref: string; why: string }[];
}

export interface ApiErrorBody {
  error: { code: string; message: string; details?: unknown };
}
