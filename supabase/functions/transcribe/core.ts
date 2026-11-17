/** Pure validation and provider adapter, shared with offline contract tests. */
export function validateWav(bytes: Uint8Array): number {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const text = (at: number, length: number) =>
    new TextDecoder().decode(bytes.subarray(at, at + length));
  if (
    bytes.length < 46 || bytes.length > 44 + 45 * 32000 ||
    text(0, 4) !== "RIFF" ||
    text(8, 4) !== "WAVE" || text(12, 4) !== "fmt " || text(36, 4) !== "data" ||
    view.getUint32(16, true) !== 16 || view.getUint16(20, true) !== 1 ||
    view.getUint16(22, true) !== 1 || view.getUint32(24, true) !== 16000 ||
    view.getUint32(28, true) !== 32000 || view.getUint16(32, true) !== 2 ||
    view.getUint16(34, true) !== 16 ||
    view.getUint32(40, true) !== bytes.length - 44 ||
    view.getUint32(4, true) !== bytes.length - 8 ||
    (bytes.length - 44) % 2 !== 0
  ) {
    throw new Error("Expected mono 16 kHz PCM WAV, up to 45 seconds.");
  }
  return (bytes.length - 44) / 32000;
}
export interface Options {
  language: "multi" | "tl" | "en";
  mode: "strict" | "clean";
  vocabulary: string[];
  pass: "primary" | "review";
}
export function validateOptions(value: unknown): Options {
  const o = value as Options;
  if (
    !o || !["multi", "tl", "en"].includes(o.language) ||
    !["strict", "clean"].includes(o.mode) ||
    !["primary", "review"].includes(o.pass) || !Array.isArray(o.vocabulary) ||
    o.vocabulary.length > 30 ||
    o.vocabulary.some((v) =>
      typeof v !== "string" || !v.trim() || v.length > 80 ||
      /[\r\n\x00-\x1f]/.test(v)
    )
  ) {
    throw new Error("Invalid transcription options.");
  }
  return {
    language: o.language,
    mode: o.mode,
    vocabulary: o.vocabulary,
    pass: o.pass,
  };
}
export function providerUrl(options: Options, version?: string): URL {
  const url = new URL("https://api.deepgram.com/v1/listen");
  const params = {
    model: "nova-3",
    language: options.language,
    diarize_model: "v2",
    punctuate: "true",
    smart_format: "false",
    numerals: "false",
    filler_words: "true",
    redact_usage: "true",
    mip_opt_out: "true",
  };
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  if (version) url.searchParams.set("version", version);
  if (options.pass === "primary") {
    if (options.language === "multi") {
      ["tl", "en"].forEach((l) => url.searchParams.append("language_hint", l));
    }
    options.vocabulary.forEach((v) => url.searchParams.append("keyterm", v));
  }
  // Review uses the same original audio without lexical/language bias. No repeated clear sections.
  return url;
}
export interface ProviderWord {
  word: string;
  start: number;
  end: number;
  punctuated_word?: string;
  confidence?: number;
  speaker?: number;
  speaker_confidence?: number;
  language?: string;
}
export interface ProviderResponse {
  metadata?: {
    duration?: number;
    model_info?: Record<string, { name?: string; version?: string }>;
    diarize_info?: { arch?: string };
  };
  results?: {
    channels?: {
      detected_language?: string;
      alternatives?: {
        transcript?: string;
        words?: ProviderWord[];
        languages?: string[];
      }[];
    }[];
  };
}
export function parseProvider(data: ProviderResponse, duration: number) {
  const channel = data.results?.channels?.[0],
    alternative = channel?.alternatives?.[0];
  if (
    !alternative || !Array.isArray(alternative.words) ||
    typeof alternative.transcript !== "string"
  ) {
    throw new Error("Invalid provider response.");
  }
  if (
    typeof data.metadata?.duration !== "number" ||
    Math.abs(data.metadata.duration - duration) > 0.25
  ) {
    throw new Error("Provider did not process the full chunk.");
  }
  const probability = (n: unknown) =>
    n === undefined ||
    (typeof n === "number" && Number.isFinite(n) && n >= 0 && n <= 1);
  const words = alternative.words.map((w) => {
    if (
      typeof w.word !== "string" || !w.word.trim() ||
      !Number.isFinite(w.start) || !Number.isFinite(w.end) ||
      w.start < 0 || w.end < w.start || w.end > duration + 0.25 ||
      !probability(w.confidence) || !probability(w.speaker_confidence) ||
      (w.speaker !== undefined &&
        (!Number.isInteger(w.speaker) || w.speaker < 0)) ||
      (w.punctuated_word !== undefined && typeof w.punctuated_word !== "string")
    ) throw new Error("Invalid provider word metadata.");
    return {
      word: w.word,
      start: w.start,
      end: w.end,
      punctuated_word: w.punctuated_word,
      confidence: w.confidence,
      speaker: w.speaker,
      speaker_confidence: w.speaker_confidence,
      language: typeof w.language === "string" ? w.language : undefined,
    };
  });
  if (alternative.transcript.trim() && !words.length) {
    throw new Error("Provider omitted word timestamps.");
  }
  const models = Object.values(data.metadata?.model_info ?? {});
  const languages = [
    ...new Set([
      ...words.flatMap((w) => w.language ? [w.language] : []),
      ...(alternative.languages ?? []),
      ...(channel?.detected_language ? [channel.detected_language] : []),
    ]),
  ];
  return {
    words,
    text: alternative.transcript,
    duration,
    model: "nova-3",
    version:
      models.map((m) => `${m.name ?? "nova-3"}:${m.version ?? "unreported"}`)
        .join(",") || "unreported",
    diarizer: data.metadata?.diarize_info?.arch ?? null,
    languages,
  };
}
