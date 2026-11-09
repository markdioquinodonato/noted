import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router';
import { Bell, Check, Link2, LockKeyhole, Mic, Paperclip, Square, Users } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { GmailField, normalizeGmail, useGmailField } from '@/features/auth/gmail';
import { useRepo } from '@/app/RepositoryProvider';
import type { Note, NoteDraft } from '@/domain/types';
import { uploadAttachment } from '@/data/attachments';
import { supabase } from '@/lib/supabase';
import { errorMessage } from '@/lib/format';
import { displayTitle } from '@/lib/text';
import { useDebouncedValue, useRefreshLists, useNow } from './hooks';
import type { RichEditorHandle } from './RichEditor';
import { AttachmentPanel } from './AttachmentPanel';
import { Alert } from '@/components/common';
import { useAuth } from '@/features/auth/AuthProvider';
import { postAuthNext } from '@/lib/mode';
import type { RefObject } from 'react';

type Tool = 'reminder' | 'attachments' | 'voice' | 'links' | 'sharing' | null;
export function ProductivityTools({
  note,
  disabled,
  bodyRef,
  update,
}: {
  note: Note;
  disabled: boolean;
  bodyRef: RefObject<RichEditorHandle | null>;
  update(patch: NoteDraft): Promise<boolean>;
}) {
  const [tool, setTool] = useState<Tool>(null);
  const { repo } = useRepo();
  // Sharing needs a signed-in cloud account; guest notes live only on this device.
  const guest = repo.kind !== 'cloud';
  const owned = !note.permission;
  const tools = [
    ['reminder', 'Reminder', Bell],
    ['attachments', 'Attachments', Paperclip],
    ['voice', 'Voice', Mic],
    ['links', 'Linked notes', Link2],
    ['sharing', 'Share', Users],
  ] as const;
  return (
    <>
      {tools
        .filter(([key]) => owned || key === 'links')
        .map(([key, label, Icon]) => (
          <Button
            key={key}
            size="xs"
            variant="ghost"
            disabled={disabled}
            title={key === 'sharing' && guest ? 'Log in to share notes' : undefined}
            onClick={() => setTool(key)}
          >
            <Icon />
            {label}
          </Button>
        ))}
      <Dialog
        open={tool !== null}
        onOpenChange={(open) => {
          if (!open) setTool(null);
        }}
      >
        {tool === 'sharing' && guest ? (
          <DialogContent className="sm:max-w-md">
            <ShareLoginPrompt onClose={() => setTool(null)} />
          </DialogContent>
        ) : (
          <DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-xl">
            <DialogHeader>
              <DialogTitle>{tools.find((t) => t[0] === tool)?.[1]}</DialogTitle>
              <DialogDescription>
                Tools for this note. Changes are saved to your current storage.
              </DialogDescription>
            </DialogHeader>
            {tool === 'reminder' && <ReminderPanel note={note} update={update} />}
            {tool === 'attachments' && (
              <AttachmentPanel noteId={note.id} onRecordVoice={() => setTool('voice')} />
            )}
            {tool === 'voice' && <VoicePanel noteId={note.id} bodyRef={bodyRef} />}
            {tool === 'links' && <LinkPanel noteId={note.id} bodyRef={bodyRef} />}
            {tool === 'sharing' && <SharingPanel noteId={note.id} />}
          </DialogContent>
        )}
      </Dialog>
    </>
  );
}

function ReminderPanel({ note, update }: { note: Note; update(p: NoteDraft): Promise<boolean> }) {
  const now = useNow();
  const [when, setWhen] = useState(() => {
    if (!note.reminderAt) return '';
    const date = new Date(note.reminderAt);
    return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
  });
  const [busy, setBusy] = useState(false);
  const save = async (p: NoteDraft) => {
    setBusy(true);
    try {
      if (await update(p)) toast.success('Reminder updated');
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="space-y-4">
      <label className="block space-y-2 text-sm">
        Reminder date and time (your local time)
        <Input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} />
      </label>
      {note.reminderAt && (
        <p className="text-sm">
          {note.reminderCompletedAt
            ? 'Completed'
            : Date.parse(note.reminderAt) <= now
              ? 'Due / overdue'
              : 'Upcoming'}{' '}
          · {new Date(note.reminderAt).toLocaleString()}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button
          disabled={busy || !when || !Number.isFinite(Date.parse(when))}
          onClick={() =>
            void save({ reminderAt: new Date(when).toISOString(), reminderCompletedAt: null })
          }
        >
          Set reminder
        </Button>
        {note.reminderAt && (
          <>
            <Button
              variant="outline"
              disabled={busy}
              onClick={() =>
                void save({
                  reminderCompletedAt: note.reminderCompletedAt ? null : new Date().toISOString(),
                })
              }
            >
              {note.reminderCompletedAt ? 'Reopen' : 'Complete'}
            </Button>
            <Button
              variant="ghost"
              disabled={busy}
              onClick={() => void save({ reminderAt: null, reminderCompletedAt: null })}
            >
              Cancel reminder
            </Button>
          </>
        )}
      </div>
      <p className="text-xs text-muted-foreground">
        In-app reminders are checked while Noted is open. Delivery when the app is closed requires
        an external scheduler and notification service, which are not configured.
      </p>
      {'Notification' in window && (
        <Button
          variant="outline"
          onClick={async () => {
            const result = await Notification.requestPermission();
            toast.info(
              result === 'granted'
                ? 'Browser notifications enabled while Noted is open.'
                : 'Notifications were not enabled. In-app reminders still work.',
            );
          }}
        >
          Enable browser notifications
        </Button>
      )}
    </div>
  );
}

interface SpeechResult {
  results: { isFinal: boolean; [i: number]: { transcript: string } }[];
  resultIndex: number;
}
interface SpeechApi {
  start(): void;
  stop(): void;
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((event: SpeechResult) => void) | null;
  onerror: (() => void) | null;
  onend: (() => void) | null;
}
function VoicePanel({
  noteId,
  bodyRef,
}: {
  noteId: string;
  bodyRef: RefObject<RichEditorHandle | null>;
}) {
  const { repo } = useRepo();
  const recorder = useRef<MediaRecorder | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const speech = useRef<SpeechApi | null>(null);
  const [state, setState] = useState<'idle' | 'recording' | 'paused'>('idle');
  const [recording, setRecording] = useState<Blob | null>(null);
  const [audioUrl, setAudioUrl] = useState('');
  const [text, setText] = useState('');
  const [listening, setListening] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(
    () => () => {
      speech.current?.stop();
      if (recorder.current) {
        recorder.current.onstop = null;
        recorder.current.ondataavailable = null;
        if (recorder.current.state !== 'inactive') recorder.current.stop();
      }
      stream.current?.getTracks().forEach((t) => t.stop());
    },
    [],
  );
  useEffect(
    () => () => {
      if (audioUrl) URL.revokeObjectURL(audioUrl);
    },
    [audioUrl],
  );
  const start = async () => {
    try {
      if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder)
        throw new Error(
          'Audio recording is unavailable in this browser. Use HTTPS and a supported browser.',
        );
      stream.current = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mime = ['audio/webm', 'audio/mp4', 'audio/ogg'].find((m) =>
        MediaRecorder.isTypeSupported(m),
      );
      if (!mime) throw new Error('No supported audio format is available.');
      const r = new MediaRecorder(stream.current, { mimeType: mime });
      recorder.current = r;
      const chunks: Blob[] = [];
      let bytes = 0;
      r.ondataavailable = (e) => {
        if (e.data.size) {
          chunks.push(e.data);
          bytes += e.data.size;
        }
        if (bytes > 9 * 1024 * 1024 && r.state !== 'inactive') r.stop();
      };
      r.onstop = () => {
        const blob = new Blob(chunks, { type: mime });
        setRecording(blob);
        setAudioUrl(URL.createObjectURL(blob));
        setState('idle');
        stream.current?.getTracks().forEach((t) => t.stop());
      };
      r.onerror = () => {
        toast.error('Recording failed.');
        stream.current?.getTracks().forEach((t) => t.stop());
        setState('idle');
      };
      r.start(1000);
      setState('recording');
    } catch (e) {
      stream.current?.getTracks().forEach((t) => t.stop());
      toast.error(errorMessage(e, 'Microphone access was denied.'));
    }
  };
  const transcribe = () => {
    const w = window as unknown as {
      SpeechRecognition?: new () => SpeechApi;
      webkitSpeechRecognition?: new () => SpeechApi;
    };
    const Api = w.SpeechRecognition ?? w.webkitSpeechRecognition;
    if (!Api) {
      toast.info(
        'Live transcription is not supported by this browser. You can record audio and type a transcript manually.',
      );
      return;
    }
    const api = new Api();
    speech.current = api;
    api.lang = navigator.language;
    api.continuous = true;
    api.interimResults = false;
    api.onresult = (e) => {
      for (let i = e.resultIndex; i < e.results.length; i++)
        if (e.results[i].isFinal)
          setText((t) => `${t}${t ? ' ' : ''}${e.results[i][0].transcript}`);
    };
    api.onerror = () => {
      setListening(false);
      toast.error('Speech recognition could not continue. Check permission and network access.');
    };
    api.onend = () => setListening(false);
    try {
      api.start();
      setListening(true);
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };
  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        Recording requires microphone permission. Save your recording before closing this dialog.
        Live dictation uses your browser’s speech service and may send audio to that service; it
        does not transcribe an existing recording.
      </p>
      <div className="flex flex-wrap gap-2">
        {state === 'idle' ? (
          <Button onClick={() => void start()} disabled={listening || busy}>
            <Mic />
            Start recording
          </Button>
        ) : (
          <>
            <Button
              variant="outline"
              onClick={() => {
                if (state === 'recording') recorder.current?.pause();
                else recorder.current?.resume();
                setState(state === 'recording' ? 'paused' : 'recording');
              }}
            >
              {state === 'paused' ? 'Resume' : 'Pause'}
            </Button>
            <Button onClick={() => recorder.current?.stop()}>
              <Square />
              Stop recording
            </Button>
          </>
        )}
      </div>
      {state !== 'idle' && (
        <p role="status" className="text-sm">
          Microphone {state}…
        </p>
      )}
      {audioUrl && (
        <>
          <audio src={audioUrl} controls className="w-full" />
          <Button
            disabled={busy || state !== 'idle'}
            onClick={async () => {
              setBusy(true);
              try {
                const mime = recording!.type,
                  ext = mime === 'audio/mp4' ? 'm4a' : mime.split('/')[1];
                await uploadAttachment(
                  repo,
                  noteId,
                  new File([recording!], `Voice-${Date.now()}.${ext}`, { type: mime }),
                );
                setRecording(null);
                setAudioUrl('');
                toast.success('Voice recording attached');
              } catch (e) {
                toast.error(errorMessage(e));
              } finally {
                setBusy(false);
              }
            }}
          >
            Save recording to note
          </Button>
        </>
      )}
      <div className="border-t pt-3">
        <Button
          variant="outline"
          disabled={state !== 'idle'}
          onClick={() => {
            if (listening) {
              speech.current?.stop();
              setListening(false);
            } else transcribe();
          }}
        >
          {listening ? 'Stop dictation' : 'Start live dictation'}
        </Button>
      </div>
      <textarea
        aria-label="Editable transcript"
        value={text}
        onChange={(e) => setText(e.target.value)}
        className="min-h-24 w-full rounded border bg-background p-2 text-sm"
      />
      <Button
        disabled={!text.trim()}
        onClick={() => {
          bodyRef.current
            ?.getEditor()
            ?.chain()
            .focus()
            .insertContent({ type: 'paragraph', content: [{ type: 'text', text }] })
            .run();
          setText('');
        }}
      >
        Insert transcript
      </Button>
    </div>
  );
}

function LinkPanel({
  noteId,
  bodyRef,
}: {
  noteId: string;
  bodyRef: RefObject<RichEditorHandle | null>;
}) {
  const { repo } = useRepo();
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const needle = useDebouncedValue(search, 250);
  const matches = useQuery({
    queryKey: ['link-search', repo.scope, needle],
    queryFn: () =>
      repo.listNotes({ view: 'all', search: needle, sort: 'updated', limit: 30, offset: 0 }),
  });
  const backlinks = useQuery({
    queryKey: ['backlinks', repo.scope, noteId],
    queryFn: async () => {
      if (repo.kind === 'cloud') {
        const { data, error } = await supabase!
          .from('notes')
          .select('id,title,content')
          .is('deleted_at', null)
          .like('content', `%/notes/${noteId}%`)
          .limit(100);
        if (error) throw error;
        return data;
      }
      const result: Note[] = [];
      let offset: number | null = 0;
      while (offset !== null) {
        const page = await repo.listNotes({ view: 'all', sort: 'updated', limit: 200, offset });
        result.push(...(await repo.getNotes(page.items.map((n) => n.id))));
        offset = page.nextOffset;
      }
      return result.filter((n) => n.content.includes(`/notes/${noteId}`));
    },
  });
  return (
    <div className="space-y-3">
      <Input
        placeholder="Find a note to link…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />
      <ul className="max-h-48 space-y-1 overflow-y-auto">
        {matches.data?.items
          .filter((n) => n.id !== noteId)
          .map((n) => (
            <li key={n.id}>
              <Button
                variant="ghost"
                className="w-full justify-start truncate"
                onClick={() => {
                  bodyRef.current
                    ?.getEditor()
                    ?.chain()
                    .focus()
                    .insertContent({
                      type: 'text',
                      text: displayTitle(n.title, n.preview),
                      marks: [{ type: 'link', attrs: { href: `/notes/${n.id}` } }],
                    })
                    .run();
                  toast.success('Note link inserted. Ctrl/⌘+click the link to open it.');
                }}
              >
                {displayTitle(n.title, n.preview)}
              </Button>
            </li>
          ))}
      </ul>
      {matches.isError && <p role="alert">Could not search notes.</p>}
      <h3 className="text-sm font-medium">Backlinks</h3>
      {backlinks.isError && <p role="alert">Could not load backlinks.</p>}
      {!backlinks.data?.length && (
        <p className="text-xs text-muted-foreground">
          No readable notes link here yet. Deleted notes are excluded.
        </p>
      )}
      {backlinks.data?.map((n) => (
        <Button
          key={n.id}
          aria-label={`Backlink from ${displayTitle(n.title, n.content)}`}
          variant="outline"
          className="mr-2"
          onClick={() => navigate(`/notes/${n.id}`)}
        >
          {displayTitle(n.title, n.content)}
        </Button>
      ))}
    </div>
  );
}

function SharingPanel({ noteId }: { noteId: string }) {
  const { repo } = useRepo();
  const refresh = useRefreshLists();
  const emailField = useGmailField();
  const email = normalizeGmail(emailField.value);
  const [permission, setPermission] = useState('read');
  const [busy, setBusy] = useState(false);
  const shares = useQuery({
    queryKey: ['shares', repo.scope, noteId],
    enabled: repo.kind === 'cloud',
    queryFn: async () => {
      const { data, error } = await supabase!
        .from('note_shares')
        .select('user_id,permission')
        .eq('note_id', noteId);
      if (error) throw error;
      return data;
    },
  });
  if (repo.kind !== 'cloud') return <ShareLoginPrompt />;
  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        Share with a registered account. Recipients can read text and links; attachments and
        organization stay private to you. Editing uses revision checks with an explicit conflict
        resolution prompt, rather than live cursors or character-level merging.
      </p>
      <GmailField field={emailField} label="Collaborator email" placeholder="friend@gmail.com" />
      <select
        aria-label="Sharing permission"
        value={permission}
        onChange={(e) => setPermission(e.target.value)}
        className="rounded border bg-background p-2 text-sm"
      >
        <option value="read">Read only</option>
        <option value="edit">Can edit text</option>
      </select>
      <Button
        disabled={busy || !emailField.value.trim()}
        onClick={async () => {
          if (emailField.validate()) return;
          setBusy(true);
          try {
            const { error } = await supabase!.rpc('share_note', {
              p_note_id: noteId,
              p_email: email,
              p_permission: permission,
            });
            if (error)
              throw new Error(
                'Could not share. Confirm the email belongs to another registered user.',
              );
            await shares.refetch();
            emailField.reset();
            refresh();
            toast.success('Note access updated');
          } catch (e) {
            toast.error(errorMessage(e));
          } finally {
            setBusy(false);
          }
        }}
      >
        Share note
      </Button>
      {shares.isError && (
        <p role="alert">Could not load collaborators. Apply the sharing migration and retry.</p>
      )}
      {shares.data?.map((s) => (
        <div key={s.user_id} className="flex items-center gap-2 rounded border p-2">
          <span className="min-w-0 flex-1 break-all text-xs">
            Account {s.user_id}
            <small className="block text-muted-foreground">
              {s.permission === 'edit' ? 'Can edit' : 'Read only'}
            </small>
          </span>
          <Button
            variant="ghost"
            size="sm"
            onClick={async () => {
              const { error } = await supabase!
                .from('note_shares')
                .delete()
                .eq('note_id', noteId)
                .eq('user_id', s.user_id);
              if (error) toast.error('Could not revoke access.');
              else {
                void shares.refetch();
                toast.success('Access revoked');
              }
            }}
          >
            Revoke
          </Button>
        </div>
      ))}
    </div>
  );
}

/** Shown instead of sharing controls in Guest Mode: sharing needs an account. */
function ShareLoginPrompt({ onClose }: { onClose?: () => void }) {
  const { configured } = useAuth();
  const next = '/import';
  return (
    <div>
      <div className="mb-4 grid size-12 place-items-center rounded-2xl bg-primary/10 text-primary">
        <LockKeyhole className="size-6" aria-hidden="true" />
      </div>
      <DialogTitle className="text-lg">Log in to share notes</DialogTitle>
      <DialogDescription className="mt-1.5">
        Sharing isn’t available in Guest Mode. Guest notes are stored only on this device, so nobody
        else can open them. Log in or create a free account to share.
      </DialogDescription>
      <ul className="my-5 space-y-2 text-sm">
        {[
          'Share a note with another Noted account as read-only or editable.',
          'Bring your guest notes into your account first — you choose which ones.',
          'Your notes stay private unless you share them.',
        ].map((t) => (
          <li key={t} className="flex gap-2">
            <Check className="mt-0.5 size-4 shrink-0 text-success" aria-hidden="true" />
            <span>{t}</span>
          </li>
        ))}
      </ul>
      {configured ? (
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          {onClose && (
            <Button variant="ghost" onClick={onClose}>
              Not now
            </Button>
          )}
          <Button variant="outline" asChild>
            <Link
              to={`/register?next=${encodeURIComponent(next)}`}
              onClick={() => postAuthNext.set(next)}
            >
              Create free account
            </Link>
          </Button>
          <Button asChild>
            <Link
              to={`/login?next=${encodeURIComponent(next)}`}
              onClick={() => postAuthNext.set(next)}
            >
              Log in to share
            </Link>
          </Button>
        </div>
      ) : (
        <>
          <Alert>
            Cloud accounts aren’t configured for this deployment yet, so sharing is unavailable.
            Your notes stay safe on this device.
          </Alert>
          {onClose && (
            <div className="mt-4 flex justify-end">
              <Button onClick={onClose}>OK</Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
