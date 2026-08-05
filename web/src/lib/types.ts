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
export type PackSurface = 'lessons' | 'drills:terms' | 'drills:word-order' | 'progress';

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
  errorCategories: { id: string; label?: LocalizedText }[];
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

export type DrillPrompt =
  | { kind: 'term'; stage: Stage; prompt: string; hint?: string }
  | { kind: 'word-order'; stage: Stage; prompt: string; bank: string[]; leadCue?: string; tip?: string };

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

// --- composed responses ----------------------------------------------------

export interface PackProgress {
  pack: Pack;
  currentBlock: Block | null;
  blockProgress: BlockProgress | null;
  blocks: { block: Block; progress: BlockProgress }[];
  decks: { terms: DeckSummary; wordOrder: DeckSummary };
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
