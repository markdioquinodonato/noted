/** Reference-based metrics, not model confidence. NFC + lowercase, punctuation
 * ignored, repetitions/particles retained. Rates are fractions and WER can exceed 1. */
export function normalize(text) {
  return text
    .normalize('NFC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}'’-]+/gu, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}
export function alignment(reference, hypothesis) {
  let prefix = 0,
    rEnd = reference.length,
    hEnd = hypothesis.length;
  while (prefix < rEnd && prefix < hEnd && reference[prefix] === hypothesis[prefix]) prefix++;
  while (rEnd > prefix && hEnd > prefix && reference[rEnd - 1] === hypothesis[hEnd - 1]) {
    rEnd--;
    hEnd--;
  }
  const ref = reference.slice(prefix, rEnd),
    hyp = hypothesis.slice(prefix, hEnd);
  const n = ref.length,
    m = hyp.length;
  if (!n || !m) return { distance: n + m, substitutions: 0, deletions: n, insertions: m };
  // Exact adaptive-banded Levenshtein: a path with cost <= band cannot leave
  // that diagonal band. Widen until this condition holds, never approximate.
  for (let band = Math.max(32, Math.abs(n - m)); ; band *= 2) {
    const row = () => Array.from({ length: 4 }, () => new Int32Array(m + 1));
    let previous = row(),
      current = row();
    const infinity = n + m + 1;
    previous[0].fill(infinity);
    for (let h = 0; h <= Math.min(m, band); h++) {
      previous[0][h] = h;
      previous[3][h] = h;
    }
    for (let r = 1; r <= n; r++) {
      current[0].fill(infinity);
      if (r <= band) {
        current[0][0] = r;
        current[1][0] = 0;
        current[2][0] = r;
        current[3][0] = 0;
      }
      for (let h = Math.max(1, r - band); h <= Math.min(m, r + band); h++) {
        const substitution = Number(ref[r - 1] !== hyp[h - 1]);
        const diagonal = previous[0][h - 1] + substitution;
        const deletion = previous[0][h] + 1,
          insertion = current[0][h - 1] + 1;
        if (diagonal <= deletion && diagonal <= insertion) {
          current[0][h] = diagonal;
          current[1][h] = previous[1][h - 1] + substitution;
          current[2][h] = previous[2][h - 1];
          current[3][h] = previous[3][h - 1];
        } else if (deletion <= insertion) {
          current[0][h] = deletion;
          current[1][h] = previous[1][h];
          current[2][h] = previous[2][h] + 1;
          current[3][h] = previous[3][h];
        } else {
          current[0][h] = insertion;
          current[1][h] = current[1][h - 1];
          current[2][h] = current[2][h - 1];
          current[3][h] = current[3][h - 1] + 1;
        }
      }
      [previous, current] = [current, previous];
    }
    if (previous[0][m] <= band)
      return {
        distance: previous[0][m],
        substitutions: previous[1][m],
        deletions: previous[2][m],
        insertions: previous[3][m],
      };
  }
}
export function metrics(reference, hypothesis) {
  const ref = normalize(reference),
    hyp = normalize(hypothesis);
  const words = ref ? ref.split(' ') : [],
    recognized = hyp ? hyp.split(' ') : [];
  const word = alignment(words, recognized),
    character = alignment([...ref], [...hyp]);
  return {
    referenceWords: words.length,
    referenceCharacters: [...ref].length,
    ...word,
    characterErrors: character.distance,
    wer: words.length ? word.distance / words.length : null,
    cer: ref.length ? character.distance / [...ref].length : null,
    omittedWordRate: words.length ? word.deletions / words.length : null,
    insertedWordRate: words.length ? word.insertions / words.length : null,
    // Insertions are a hallucination proxy only: audio review is required to classify them.
    silenceInsertions: words.length ? null : recognized.length,
  };
}
export function intervalCoverage(intervals, duration) {
  if (!(duration > 0)) return null;
  let covered = 0,
    end = 0;
  for (const [a, b] of intervals.toSorted((x, y) => x[0] - y[0])) {
    const start = Math.max(0, a),
      stop = Math.min(duration, b);
    covered += Math.max(0, stop - Math.max(start, end));
    end = Math.max(end, stop);
  }
  return covered / duration;
}
/** Permutation-invariant time-weighted speaker accuracy. Overlap must be scored
 * separately; intervals with multiple active references are excluded. */
export function speakerAccuracy(reference, hypothesis) {
  const refs = [...new Set(reference.map((s) => s.speaker))],
    hyps = [...new Set(hypothesis.map((s) => s.speaker))];
  if (!refs.length || !hyps.length || Math.max(refs.length, hyps.length) > 8) return null;
  const times = [...new Set([...reference, ...hypothesis].flatMap((s) => [s.start, s.end]))].sort(
    (a, b) => a - b,
  );
  const weights = hyps.map(() => refs.map(() => 0));
  let total = 0;
  for (let i = 1; i < times.length; i++) {
    const mid = (times[i - 1] + times[i]) / 2,
      dt = times[i] - times[i - 1];
    const r = reference.filter((s) => s.start <= mid && s.end > mid);
    const h = hypothesis.filter((s) => s.start <= mid && s.end > mid);
    if (r.length !== 1) continue;
    total += dt;
    if (h.length === 1) weights[hyps.indexOf(h[0].speaker)][refs.indexOf(r[0].speaker)] += dt;
  }
  const best = (i, used) =>
    i === hyps.length
      ? 0
      : Math.max(
          best(i + 1, used),
          ...refs.map((_, j) =>
            used.has(j) ? -Infinity : weights[i][j] + best(i + 1, new Set([...used, j])),
          ),
        );
  return total ? best(0, new Set()) / total : null;
}
