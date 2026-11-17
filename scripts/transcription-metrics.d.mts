export interface Alignment {
  distance: number;
  substitutions: number;
  deletions: number;
  insertions: number;
}
export interface Metrics extends Alignment {
  referenceWords: number;
  referenceCharacters: number;
  characterErrors: number;
  wer: number | null;
  cer: number | null;
  omittedWordRate: number | null;
  insertedWordRate: number | null;
  silenceInsertions: number | null;
}
export function normalize(text: string): string;
export function alignment(reference: string[], hypothesis: string[]): Alignment;
export function metrics(reference: string, hypothesis: string): Metrics;
export function intervalCoverage(intervals: [number, number][], duration: number): number | null;
export function speakerAccuracy(
  reference: { start: number; end: number; speaker: string }[],
  hypothesis: { start: number; end: number; speaker: string }[],
): number | null;
