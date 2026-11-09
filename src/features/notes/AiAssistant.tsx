import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Sparkles } from 'lucide-react';
import { toast } from 'sonner';
import type { RefObject } from 'react';
import { useRepo } from '@/app/RepositoryProvider';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { supabase } from '@/lib/supabase';
import { textDocument } from '@/lib/richText';
import type { RichEditorHandle } from './RichEditor';

const ACTIONS = {
  summarize: 'Summarize',
  grammar: 'Correct grammar & spelling',
  professional: 'Professional rewrite',
  casual: 'Casual rewrite',
  shorter: 'Make shorter',
  expand: 'Expand',
  title: 'Generate title',
  actions: 'Extract action items',
  bullets: 'Bullet summary',
  explain: 'Explain simply',
};
export function AiAssistant({
  bodyRef,
  disabled,
  onTitle,
}: {
  bodyRef: RefObject<RichEditorHandle | null>;
  disabled: boolean;
  onTitle(title: string): void;
}) {
  const { repo } = useRepo();
  const [open, setOpen] = useState(false);
  const [action, setAction] = useState('summarize');
  const [source, setSource] = useState('');
  const [range, setRange] = useState<{ from: number; to: number } | null>(null);
  const [snapshot, setSnapshot] = useState('');
  const [result, setResult] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const availability = useQuery({
    queryKey: ['ai-available', repo.scope],
    enabled: open && repo.kind === 'cloud',
    retry: false,
    queryFn: async () => {
      const { data, error } = await supabase!.functions.invoke('ai-writer', {
        body: { operation: 'status' },
      });
      if (error) throw error;
      return !!data?.available;
    },
  });
  const apply = (replace: boolean) => {
    const editor = bodyRef.current?.getEditor();
    if (!editor) return;
    if (replace && JSON.stringify(editor.getJSON()) !== snapshot) {
      setError('The note changed after generation. Copy or insert the result, or generate again.');
      setConfirm(false);
      return;
    }
    if (action === 'title') onTitle(result.trim().slice(0, 200));
    else if (replace && range)
      editor
        .chain()
        .focus()
        .insertContentAt(range, textDocument(result).content ?? [])
        .run();
    else if (replace) editor.commands.setContent(textDocument(result));
    else
      editor
        .chain()
        .focus()
        .insertContentAt(editor.state.doc.content.size, textDocument(result).content ?? [])
        .run();
    setOpen(false);
  };
  return (
    <>
      <Button
        size="xs"
        variant="ghost"
        disabled={disabled}
        onClick={() => {
          const editor = bodyRef.current?.getEditor();
          if (!editor) return;
          const { from, to, empty } = editor.state.selection;
          setRange(empty ? null : { from, to });
          setSource(empty ? editor.getText() : editor.state.doc.textBetween(from, to, '\n'));
          setSnapshot(JSON.stringify(editor.getJSON()));
          setResult('');
          setError('');
          setConfirm(false);
          setOpen(true);
        }}
      >
        <Sparkles />
        AI Assistant
      </Button>
      <Dialog
        open={open}
        onOpenChange={(o) => {
          if (!busy) setOpen(o);
        }}
      >
        <DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>AI Writing Assistant</DialogTitle>
            <DialogDescription>
              Generating sends {range ? 'your selected text' : 'this note’s text'} to Anthropic.
              Review the result before applying it. Up to 20 requests per hour.
            </DialogDescription>
          </DialogHeader>
          {repo.kind !== 'cloud' || availability.isError || availability.data === false ? (
            <p role="status" className="text-sm text-muted-foreground">
              AI is unavailable. A signed-in account, deployed ai-writer function, and server-side
              provider credentials are required. No note text has been sent.
            </p>
          ) : (
            <>
              <select
                aria-label="AI action"
                className="rounded border bg-background p-2 text-sm"
                value={action}
                disabled={busy}
                onChange={(e) => setAction(e.target.value)}
              >
                {Object.entries(ACTIONS).map(([key, label]) => (
                  <option key={key} value={key}>
                    {label}
                  </option>
                ))}
              </select>
              <p className="text-xs text-muted-foreground">
                {source.length.toLocaleString()} characters · {range ? 'Selection' : 'Entire note'}
              </p>
              <Button
                disabled={busy || availability.isLoading || !source.trim() || source.length > 20000}
                onClick={async () => {
                  setBusy(true);
                  setError('');
                  setResult('');
                  setConfirm(false);
                  try {
                    const { data, error } = await supabase!.functions.invoke('ai-writer', {
                      body: { action, text: source },
                    });
                    if (error) {
                      let message =
                        'Could not generate. Check your session, provider configuration and usage limit.';
                      try {
                        const body = await error.context?.json();
                        if (body?.error) message = body.error;
                      } catch {
                        /* no response */
                      }
                      throw new Error(message);
                    }
                    if (!data?.text) throw new Error('No result returned.');
                    setResult(data.text);
                  } catch (e) {
                    setError((e as Error).message);
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                {busy ? 'Generating…' : 'Generate with Anthropic'}
              </Button>
              {source.length > 20000 && (
                <p role="alert" className="text-sm text-destructive">
                  Select fewer than 20,000 characters.
                </p>
              )}
            </>
          )}
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          {result && (
            <>
              <textarea
                aria-label="AI result preview"
                value={result}
                onChange={(e) => setResult(e.target.value)}
                className="min-h-40 w-full rounded border bg-background p-3 text-sm"
              />
              <div className="flex flex-wrap gap-2">
                <Button onClick={() => apply(false)}>
                  Insert{action === 'title' ? ' as title' : ''}
                </Button>
                <Button variant="outline" onClick={() => setConfirm(true)}>
                  Replace{range ? ' selection' : ' note'}
                </Button>
                <Button
                  variant="outline"
                  onClick={() => {
                    void navigator.clipboard
                      .writeText(result)
                      .then(() => toast.success('Copied'))
                      .catch(() =>
                        setError('Clipboard unavailable. Select and copy the result manually.'),
                      );
                  }}
                >
                  Copy
                </Button>
              </div>
              {confirm && (
                <div className="rounded border border-destructive p-3 text-sm">
                  <p>
                    Replace{' '}
                    {action === 'title'
                      ? 'the title'
                      : range
                        ? 'the selected text'
                        : 'the entire note body'}{' '}
                    with this result?
                  </p>
                  <Button size="sm" className="mt-2" onClick={() => apply(true)}>
                    Confirm replacement
                  </Button>
                </div>
              )}
            </>
          )}
          <Button variant="ghost" disabled={busy} onClick={() => setOpen(false)}>
            Cancel
          </Button>
        </DialogContent>
      </Dialog>
    </>
  );
}
