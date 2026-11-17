import { useRef, useState } from 'react';
import { toast } from 'sonner';
import { useRepo } from '@/app/RepositoryProvider';
import { useRefreshLists } from '@/features/notes/hooks';
import { errorMessage, plural } from '@/lib/format';
import { readDocuments } from './documents';

export function useDocumentImport({
  folderId = null,
  onImported,
}: { folderId?: string | null; onImported?: () => void } = {}) {
  const { repo } = useRepo();
  const refresh = useRefreshLists();
  const inputRef = useRef<HTMLInputElement>(null);
  const importing = useRef(false);
  const [busy, setBusy] = useState(false);

  const importFiles = async (files: FileList | null) => {
    if (!files?.length || importing.current) return;
    importing.current = true;
    setBusy(true);
    let count = 0;
    const messages: string[] = [];
    try {
      const { ok, errors } = await readDocuments(Array.from(files));
      messages.push(...errors);
      for (const { title, content } of ok) {
        try {
          await repo.createNote({ title, content, folderId });
          count++;
        } catch (error) {
          messages.push(errorMessage(error, 'Could not import a note.'));
        }
      }
      if (count) {
        await refresh();
        onImported?.();
        toast.success(`Imported ${plural(count, 'note')}`);
      }
    } catch (error) {
      messages.push(errorMessage(error, 'Could not import notes.'));
    } finally {
      messages.slice(0, 3).forEach((message) => toast.error(message));
      if (inputRef.current) inputRef.current.value = '';
      importing.current = false;
      setBusy(false);
    }
  };

  return {
    busy,
    open: () => {
      if (!importing.current) inputRef.current?.click();
    },
    input: (
      <input
        ref={inputRef}
        type="file"
        accept=".txt,.md,.markdown,.pdf,.docx"
        multiple
        hidden
        tabIndex={-1}
        onChange={(event) => void importFiles(event.target.files)}
        data-testid="import-txt-input"
      />
    ),
  };
}
