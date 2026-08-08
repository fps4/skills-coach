/**
 * The API's shapes, as the web app consumes them.
 *
 * Hand-written rather than shared with the api package: the two are deployed independently and
 * versioned by the HTTP contract, and a compile-time coupling between them would be a lie about
 * how they actually relate. `docs/api/endpoints.md` is the contract these follow.
 */

export type Locale = 'nl' | 'en';
export type LocalizedText = { nl?: string; en?: string };
export type TitleText = string | LocalizedText;

export interface Learner {
  learnerId: string;
  subject: string;
  email?: string;
  displayName?: string;
  uiLanguage: Locale;
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
  tagline?: LocalizedText;
  surfaces?: PackSurface[];
}

export interface Pack {
  packId: string;
  title: LocalizedText;
  description?: LocalizedText;
  contentLanguage: string;
  translationLanguage: string;
  goal?: LocalizedText;
  framework: Framework;
  errorCategories: { id: string; label?: LocalizedText; group?: LocalizedText }[];
  presentation?: PackPresentation;
}

export interface Block {
  blockId: string;
  packId: string;
  order: number;
  slug: string;
  title: TitleText;
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
  title: TitleText;
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
 * article itself cannot disagree — and `inRequestedLanguage` is false when the article had no
 * variant in the interface language and fell back to the one the pack teaches.
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

export interface ReadingCounts {
  total: number;
  unread: number;
}

export interface Library {
  articles: ArticleSummary[];
  /** Every label in the library, not merely the filtered subset — a filter must show its way out. */
  labels: LabelFacet[];
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
  | { kind: 'term'; stage: Stage; prompt: string; hint?: string }
  | { kind: 'word-order'; stage: Stage; prompt: string; bank: string[]; leadCue?: string; tip?: string }
  // No answer key here on purpose: the browser learns which option is right only after the learner
  // has committed to one. See ADR-0014.
  | { kind: 'mcq'; stage: Stage; prompt: string; options: McqOption[]; choose: number; multiple: boolean };

export interface DueItem {
  drillItemId: string;
  stage: Stage;
  prompt: DrillPrompt;
  progress: DrillProgress;
}

/** A word the learner added themselves — a `term` item they own (ADR-0012). */
export interface LearnerTerm {
  drillItemId: string;
  blockId: string;
  packId: string;
  payload: { kind: 'term'; term: string; translation: string; example?: string };
}

export interface DeckPage {
  items: DueItem[];
  summary: DeckSummary;
}

export interface AttemptResult {
  drillItemId: string;
  correct: boolean;
  overridden: boolean;
  expected: string;
  acceptedAlso?: string[];
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
  decks: { terms: DeckSummary; wordOrder: DeckSummary; quiz: DeckSummary };
  reading: ReadingCounts;
  quiz: { byCategory: CategoryBreakdown[]; sessions: number; score: QuizScore };
  errorLog: {
    entries: ErrorLogEntry[];
    redrill: string[];
    retire: string[];
    top: ErrorLogEntry[];
  };
}

export interface ApiErrorBody {
  error: { code: string; message: string; details?: unknown };
}
