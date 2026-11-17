export const UNCLEAR = '[Unclear audio — review required]';
export type TranscriptMode = 'strict' | 'clean';
export interface Word {
  word: string;
  punctuated_word?: string;
  start: number;
  end: number;
  confidence?: number;
  speaker?: number;
  speaker_confidence?: number;
  language?: string;
}
export interface Recognition {
  words: Word[];
  text: string;
  duration: number;
  model: string;
  version: string;
  diarizer: string | null;
  languages: string[];
  estimatedCost: number | null;
  processingMs: number;
}
export interface Segment {
  id: string;
  start: number;
  end: number;
  machine: string;
  text: string;
  speaker: string;
  flags: string[];
  reviewed?: boolean;
  alternative?: string;
}
export interface AudioChunk {
  index: number;
  start: number;
  end: number;
  coreStart: number;
  coreEnd: number;
  activity: [number, number][];
  primaryId: string;
  reviewId: string;
  result?: Recognition;
  review?: Recognition;
  reviewAttempted?: boolean;
  attempts: number;
  error?: string;
}
export interface TranscriptJob {
  id: string;
  scope: string;
  noteId: string;
  name: string;
  audio: Blob;
  duration: number;
  mode: TranscriptMode;
  language: 'multi' | 'tl' | 'en';
  vocabulary: string[];
  normalize: boolean;
  chunks: AudioChunk[];
  segments: Segment[];
  speakers: Record<string, string>;
  status: 'ready' | 'processing' | 'partial' | 'complete';
  updatedAt: string;
}
