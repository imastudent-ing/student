export type WordState = 'unassessed' | 'weak' | 'mastered' | 'archived';

export type PronunciationState = 'ok' | 'needs_review';

export type AttemptResult = 'fast_correct' | 'slow_correct' | 'wrong';

export type AttemptPhase =
  | 'diagnosis'
  | 'daily_first'
  | 'audit_first'
  | 'same_day_retest'
  | 'pronunciation';

/** カード上でユーザーが選ぶ自己判定 */
export type Judgment = 'correct' | 'ambiguous' | 'wrong' | 'dont_know';

export interface Word {
  id: string;
  number: number;
  word: string;
  meaning: string;
  secondaryMeaning?: string;
  pronunciation?: string;
  phrase?: string;
  phraseMeaning?: string;
  audioUrl?: string;
  tags: string[];
  createdAt: string;
  updatedAt: string;
}

export interface WordProgress {
  wordId: string;
  state: WordState;
  pronunciationState: PronunciationState;
  separateDaySuccessStreak: number;
  dueDate: string | null;
  nextAuditEligibleDate: string | null;
  lastSeenAt: string | null;
  lastFirstAttemptDate: string | null;
  lastAuditAt: string | null;
  totalFastCorrect: number;
  totalSlowCorrect: number;
  totalWrong: number;
  totalRetestCorrect: number;
  totalRetestWrong: number;
  lapseCount: number;
  lastResult: AttemptResult | null;
  createdAt: string;
  updatedAt: string;
}

export interface SessionSummary {
  firstFast: number;
  firstSlow: number;
  firstWrong: number;
  retestTargetWordIds: string[];
  retestCorrectWordIds: string[];
  carryOverWordIds: string[];
  newlyWeakWordIds: string[];
  graduatedWordIds: string[];
  pronunciationFlaggedWordIds: string[];
}

export type SessionMode = 'daily' | 'diagnosis' | 'custom';

export interface StudySession {
  id: string;
  localStudyDate: string;
  mode: SessionMode;
  /** custom セッションの内訳（追加学習・発音確認） */
  customKind?: 'extra' | 'pronunciation';
  status: 'active' | 'completed' | 'abandoned';
  plannedFirstAttemptCount: number;
  completedFirstAttemptCount: number;
  queueWordIds: string[];
  currentQueueIndex: number;
  /** 同日再テストの解放位置計算に使う、提示済みカード総数（再テスト含む） */
  presentedCardCount: number;
  summary: SessionSummary;
  startedAt: string;
  completedAt: string | null;
  updatedAt: string;
}

export interface Attempt {
  id: string;
  sessionId: string;
  wordId: string;
  localStudyDate: string;
  phase: AttemptPhase;
  result: AttemptResult;
  responseTimeMs: number | null;
  pronunciationUnknown: boolean;
  answerRevealed: boolean;
  attemptNumberSameDay: number;
  isFirstAttemptOfDay: boolean;
  createdAt: string;
}

export interface RetestQueueItem {
  id: string;
  sessionId: string;
  wordId: string;
  releaseAfterQueuePosition: number;
  retestCount: number;
  completed: boolean;
  /** 3回失敗して翌日へ持ち越しになった */
  carriedOver?: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface AppSettings {
  dailyTarget: number;
  auditTarget: number;
  fastThresholdMs: number;
  retestGapMin: number;
  retestGapMax: number;
  maxSameDayRetests: number;
  graduationSuccessCount: number;
  intervalAfterFirstSuccessDays: number;
  intervalAfterSecondSuccessDays: number;
  masteredAuditMinimumDays: number;
  shuffleEnabled: boolean;
  showTimer: boolean;
  showWordNumber: boolean;
  showPhrase: boolean;
  autoAdvance: boolean;
  speechEnabled: boolean;
  speechRate: number;
  speechVoiceURI: string | null;
  speechVolume: number;
  preferRegisteredAudio: boolean;
  autoPlayAudio: boolean;
  autoPlayPronunciationIssue: boolean;
  fontScale: 'small' | 'medium' | 'large';
  theme: 'light' | 'dark' | 'system';
}

export const DEFAULT_SETTINGS: AppSettings = {
  dailyTarget: 100,
  auditTarget: 20,
  fastThresholdMs: 3000,
  retestGapMin: 10,
  retestGapMax: 20,
  maxSameDayRetests: 3,
  graduationSuccessCount: 3,
  intervalAfterFirstSuccessDays: 3,
  intervalAfterSecondSuccessDays: 7,
  masteredAuditMinimumDays: 14,
  shuffleEnabled: true,
  showTimer: true,
  showWordNumber: true,
  showPhrase: true,
  autoAdvance: false,
  speechEnabled: true,
  speechRate: 1,
  speechVoiceURI: null,
  speechVolume: 1,
  preferRegisteredAudio: true,
  autoPlayAudio: false,
  autoPlayPronunciationIssue: true,
  fontScale: 'medium',
  theme: 'system'
};

export function createDefaultProgress(wordId: string, now: string): WordProgress {
  return {
    wordId,
    state: 'unassessed',
    pronunciationState: 'ok',
    separateDaySuccessStreak: 0,
    dueDate: null,
    nextAuditEligibleDate: null,
    lastSeenAt: null,
    lastFirstAttemptDate: null,
    lastAuditAt: null,
    totalFastCorrect: 0,
    totalSlowCorrect: 0,
    totalWrong: 0,
    totalRetestCorrect: 0,
    totalRetestWrong: 0,
    lapseCount: 0,
    lastResult: null,
    createdAt: now,
    updatedAt: now
  };
}

export function createEmptySummary(): SessionSummary {
  return {
    firstFast: 0,
    firstSlow: 0,
    firstWrong: 0,
    retestTargetWordIds: [],
    retestCorrectWordIds: [],
    carryOverWordIds: [],
    newlyWeakWordIds: [],
    graduatedWordIds: [],
    pronunciationFlaggedWordIds: []
  };
}
