// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  metrics,
  intervalCoverage,
  speakerAccuracy,
  alignment,
} from '../../scripts/transcription-metrics.mjs';
describe('reference-based accuracy scorer (synthetic text, not audio benchmarks)', () => {
  it('scores long hypotheses exactly, including errors outside the initial alignment band', () => {
    const reference = Array.from({ length: 3000 }, (_, i) => `word${i}`);
    const hypothesis = [...reference];
    hypothesis[40] = 'substitution';
    hypothesis.splice(1800, 1);
    expect(alignment(reference, hypothesis)).toEqual({
      distance: 2,
      substitutions: 1,
      deletions: 1,
      insertions: 0,
    });
    expect(alignment(Array(100).fill('po'), Array(100).fill('ba')).distance).toBe(100);
  });
  it('measures substitutions, omissions and insertions without removing repetitions', () => {
    expect(metrics('po po we need docs', 'po we need documents')).toMatchObject({
      referenceWords: 5,
      substitutions: 1,
      deletions: 1,
      insertions: 0,
      wer: 0.4,
      omittedWordRate: 0.2,
    });
    expect(metrics('hello', 'hello extra')).toMatchObject({
      insertions: 1,
      insertedWordRate: 1,
      wer: 1,
    });
    expect(metrics('po ba nga naman', 'po ba nga naman')).toMatchObject({ wer: 0, cer: 0 });
  });
  it('does not report silence as perfect accuracy', () => {
    expect(metrics('', 'invented words')).toMatchObject({
      wer: null,
      cer: null,
      silenceInsertions: 2,
    });
    expect(metrics('actually kanina', '')).toMatchObject({ wer: 1, omittedWordRate: 1 });
  });
  it('computes character errors and avoids double-counting overlapping audio', () => {
    expect(metrics('cat', 'cut')).toMatchObject({ cer: 1 / 3 });
    expect(
      intervalCoverage(
        [
          [0, 12],
          [10, 20],
          [30, 100],
        ],
        40,
      ),
    ).toBe(0.75);
  });
  it('scores speakers invariant to label names and includes missed reference speech', () => {
    const reference = [
      { speaker: 'a', start: 0, end: 5 },
      { speaker: 'b', start: 5, end: 10 },
    ];
    expect(
      speakerAccuracy(reference, [
        { speaker: '2', start: 0, end: 5 },
        { speaker: '1', start: 5, end: 10 },
      ]),
    ).toBe(1);
    expect(speakerAccuracy(reference, [{ speaker: '2', start: 0, end: 5 }])).toBe(0.5);
  });
});
