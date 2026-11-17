import { readFile, writeFile, stat } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { metrics, intervalCoverage, speakerAccuracy } from './transcription-metrics.mjs';

const manifestPath = resolve(process.argv[2] ?? 'tests/fixtures/transcription/manifest.json');
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
const root = dirname(manifestPath);
if (!manifest.recordings?.length) {
  console.log(
    'ACCURACY NOT YET VERIFIED: no consented recordings with human-verified references. WER/CER unavailable. Target: WER <= 0.05 on curated clear audio.',
  );
  process.exit(0);
}
const rows = [];
for (const recording of manifest.recordings) {
  if (
    !recording.audioPath ||
    !Number.isFinite(recording.durationSeconds) ||
    recording.durationSeconds <= 0 ||
    !(await stat(resolve(root, recording.audioPath))).size
  )
    throw new Error(
      `An existing nonempty recording and valid duration are required: ${recording.id}`,
    );
  if (recording.referenceVerified !== true || recording.consent !== true)
    throw new Error(`Human verification and recording consent are required: ${recording.id}`);
  const reference = await readFile(resolve(root, recording.referencePath), 'utf8');
  for (const implementation of ['baseline', 'upgraded']) {
    const path = recording[`${implementation}ResultPath`];
    if (!path) {
      rows.push({
        id: recording.id,
        implementation,
        status: 'not measured',
        language: recording.language,
        condition: recording.condition,
      });
      continue;
    }
    const result = JSON.parse(await readFile(resolve(root, path), 'utf8'));
    if (typeof result.text !== 'string') throw new Error(`Missing hypothesis: ${path}`);
    const measured = metrics(reference, result.text);
    rows.push({
      id: recording.id,
      language: recording.language,
      condition: recording.condition,
      implementation,
      status: 'measured',
      model: result.model ?? 'unreported',
      modelVersion: result.modelVersion ?? 'unreported',
      ...measured,
      audioCoverage: result.processedIntervals
        ? intervalCoverage(result.processedIntervals, recording.durationSeconds)
        : null,
      speakerAssignmentAccuracy:
        recording.speakerReferencePath && result.speakerSegments
          ? speakerAccuracy(
              JSON.parse(await readFile(resolve(root, recording.speakerReferencePath), 'utf8')),
              result.speakerSegments,
            )
          : null,
      processingMs: result.processingMs ?? null,
      apiCostUsd: result.apiCostUsd ?? null,
    });
  }
}
const groups = {};
for (const row of rows.filter((r) => r.status === 'measured')) {
  const key = `${row.implementation}/${row.language}/${row.condition}`;
  const group = (groups[key] ??= {
    recordings: 0,
    referenceWords: 0,
    errors: 0,
    referenceCharacters: 0,
    characterErrors: 0,
    deletions: 0,
    insertions: 0,
  });
  group.recordings++;
  group.referenceWords += row.referenceWords;
  group.errors += row.distance;
  group.referenceCharacters += row.referenceCharacters;
  group.characterErrors += row.characterErrors;
  group.deletions += row.deletions;
  group.insertions += row.insertions;
}
for (const group of Object.values(groups)) {
  group.wer = group.referenceWords ? group.errors / group.referenceWords : null;
  group.cer = group.referenceCharacters ? group.characterErrors / group.referenceCharacters : null;
  group.omittedWordRate = group.referenceWords ? group.deletions / group.referenceWords : null;
  group.insertedWordRate = group.referenceWords ? group.insertions / group.referenceWords : null;
}
const report = {
  generatedAt: new Date().toISOString(),
  targetWer: 0.05,
  note: 'Insertion rate is a hallucination proxy, not a verified hallucination count. No unmeasured metric is zero. Baseline may be absent because saved-audio STT did not exist.',
  groups,
  recordings: rows,
};
const output = resolve(process.argv[3] ?? 'transcription-evaluation.local.json');
await writeFile(output, JSON.stringify(report, null, 2));
console.log(JSON.stringify(groups, null, 2));
console.log(`Report written to ${output}`);
