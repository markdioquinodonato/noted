import { ArrowUpRight, PenLine } from 'lucide-react';

export type CaptureMode =
  'text' | 'checklist' | 'voice' | 'scan' | 'attachments' | 'reminder' | 'color';

export function CaptureBar({ onCompose }: { onCompose: () => void }) {
  return (
    <button
      type="button"
      className="noted-capture"
      aria-label="Write something"
      onClick={onCompose}
    >
      <span className="noted-capture-mark" aria-hidden="true">
        <PenLine />
      </span>
      <span className="noted-capture-label">Write something…</span>
      <ArrowUpRight className="noted-capture-open" aria-hidden="true" />
    </button>
  );
}
