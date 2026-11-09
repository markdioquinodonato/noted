import { useNavigate } from 'react-router';
import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { getNoteFont } from '@/lib/fonts';
import {
  ArrowDown,
  ArrowUp,
  Bold,
  ChevronDown,
  Columns3,
  Heading1,
  Heading2,
  Heading3,
  Highlighter,
  Italic,
  Link as LinkIcon,
  List,
  ListOrdered,
  ListTodo,
  Minus,
  Pilcrow,
  Plus,
  Quote,
  Redo2,
  Rows3,
  SquareCode,
  Strikethrough,
  Table2,
  Trash2,
  Underline as UnderlineIcon,
  Undo2,
} from 'lucide-react';
import { Placeholder } from '@tiptap/extensions';
import { cn } from '@/lib/utils';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  EditorContent,
  useEditor,
  useEditorState,
  type Editor,
  type JSONContent,
} from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import Highlight from '@tiptap/extension-highlight';
import { TableKit } from '@tiptap/extension-table';
import { Markdown } from '@tiptap/markdown';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { readRich, serializeRich, textDocument } from '@/lib/richText';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

export const richExtensions = [
  StarterKit.configure({
    heading: { levels: [1, 2, 3] },
    link: {
      openOnClick: false,
      protocols: ['https', 'http', 'mailto'],
      HTMLAttributes: { rel: 'noopener noreferrer nofollow', target: '_blank' },
      isAllowedUri: (url, ctx) => /^\/notes\/[0-9a-f-]{36}$/i.test(url) || ctx.defaultValidate(url),
    },
  }),
  TaskList,
  TaskItem.extend({ draggable: true }).configure({ nested: true }),
  Highlight,
  TableKit.configure({ table: { resizable: false } }),
  Markdown,
];

function moveTask(editor: Editor, direction: -1 | 1) {
  const { $from } = editor.state.selection;
  for (let depth = $from.depth; depth > 0; depth--) {
    if ($from.node(depth).type.name !== 'taskItem') continue;
    const parent = $from.node(depth - 1),
      index = $from.index(depth - 1);
    const other = index + direction;
    if (other < 0 || other >= parent.childCount) return;
    const node = $from.node(depth),
      start = $from.before(depth),
      neighbor = parent.child(other);
    editor.view.dispatch(
      editor.state.tr
        .delete(start, start + node.nodeSize)
        .insert(start + direction * neighbor.nodeSize, node),
    );
    return;
  }
}

export interface RichEditorHandle {
  focus(): void;
  getEditor(): Editor | null;
}
interface Props {
  initialContent: string;
  readOnly: boolean;
  fontSize: number;
  onChange(content: string): void;
  onBlur(): void;
  /** Extra actions pinned to the right end of the formatting toolbar. */
  trailing?: ReactNode;
  /** Writing font id for this note; saved with the content. */
  font?: string;
}

const editorExtensions = [
  ...richExtensions,
  Placeholder.configure({ placeholder: 'Start writing… or scan text with your camera' }),
];

export const RichEditor = forwardRef<RichEditorHandle, Props>(function RichEditor(
  { initialContent, readOnly, fontSize, onChange, onBlur, trailing, font },
  ref,
) {
  const navigate = useNavigate();
  const [linkOpen, setLinkOpen] = useState(false);
  const [url, setUrl] = useState('');
  const fontRef = useRef(font);
  useEffect(() => {
    fontRef.current = font;
  }, [font]);
  const writing = getNoteFont(font);
  const editor = useEditor({
    extensions: editorExtensions,
    content: readRich(initialContent)?.doc ?? textDocument(initialContent),
    editable: !readOnly,
    editorProps: {
      handleClick: (_view, _pos, event) => {
        const anchor = (event.target as HTMLElement).closest('a');
        const href = anchor?.getAttribute('href');
        if ((event.ctrlKey || event.metaKey) && href && /^\/notes\/[0-9a-f-]{36}$/i.test(href)) {
          event.preventDefault();
          navigate(href);
          return true;
        }
        return false;
      },
      attributes: {
        role: 'textbox',
        'aria-label': 'Note content',
        'aria-multiline': 'true',
        class: 'noted-prose outline-none min-h-[45vh]',
      },
    },
    onUpdate: ({ editor: e }) =>
      onChange(
        serializeRich(
          e.getJSON(),
          e.getText({ blockSeparator: '\n' }),
          e.getMarkdown(),
          fontRef.current,
        ),
      ),
    onBlur,
  });
  if (editor && editor.isEditable === readOnly) editor.setEditable(!readOnly, false);
  useImperativeHandle(
    ref,
    () => ({
      focus: () => {
        if (!editor || editor.isDestroyed) return;
        // commands.focus() defers to the next animation frame; move DOM focus now so
        // keys typed right after Enter in the title land in the body, not the title.
        editor.view.focus();
        editor.commands.focus();
      },
      getEditor: () => editor,
    }),
    [editor],
  );
  const state = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      bold: e?.isActive('bold'),
      italic: e?.isActive('italic'),
      underline: e?.isActive('underline'),
      strike: e?.isActive('strike'),
      highlight: e?.isActive('highlight'),
      tasks: e?.isActive('taskList'),
      bullets: e?.isActive('bulletList'),
      numbers: e?.isActive('orderedList'),
      quote: e?.isActive('blockquote'),
      code: e?.isActive('codeBlock'),
      link: e?.isActive('link'),
      table: e?.isActive('table'),
      h1: e?.isActive('heading', { level: 1 }),
      h2: e?.isActive('heading', { level: 2 }),
      h3: e?.isActive('heading', { level: 3 }),
    }),
  });
  if (!editor) return null;
  const action = (label: string, icon: ReactNode, run: () => unknown, pressed?: boolean) => (
    <Button
      key={label}
      type="button"
      size="icon-sm"
      variant="ghost"
      disabled={readOnly}
      title={label}
      aria-label={label}
      aria-pressed={pressed}
      onMouseDown={(e) => e.preventDefault()}
      onClick={() => run()}
      className={cn(
        'size-8 shrink-0 rounded-lg text-muted-foreground hover:text-foreground',
        pressed && 'bg-primary/12 text-primary hover:bg-primary/18 hover:text-primary',
      )}
    >
      {icon}
    </Button>
  );
  const styleLabel = state?.h1
    ? 'Heading 1'
    : state?.h2
      ? 'Heading 2'
      : state?.h3
        ? 'Heading 3'
        : 'Normal';
  const sep = (key: string) => (
    <span key={key} aria-hidden="true" className="mx-1 h-5 w-px shrink-0 bg-border" />
  );
  const tasks: JSONContent[] = [];
  const collect = (node: JSONContent) => {
    if (node.type === 'taskItem') tasks.push(node);
    node.content?.forEach(collect);
  };
  collect(editor.getJSON() as JSONContent);
  return (
    <>
      <div className="sticky top-3 z-10 -mx-2 mb-6 flex max-w-[calc(100%+1rem)] items-center self-start gap-1 rounded-2xl border bg-background/85 p-1 shadow-lg shadow-slate-900/[0.06] backdrop-blur-xl dark:shadow-black/30">
        <div
          className="flex min-w-0 flex-1 items-center overflow-x-auto scrollbar-none"
          role="toolbar"
          aria-label="Text formatting"
        >
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={readOnly}
                aria-label="Text style"
                onMouseDown={(e) => e.preventDefault()}
                className="h-8 w-[6.6rem] shrink-0 justify-between rounded-lg px-2.5 text-[0.8rem] font-medium text-foreground/80"
              >
                <span className="truncate">{styleLabel}</span>
                <ChevronDown className="size-3.5 opacity-60" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="start"
              className="w-52"
              onCloseAutoFocus={(e) => {
                e.preventDefault();
                editor.commands.focus();
              }}
            >
              <DropdownMenuItem onSelect={() => editor.chain().focus().setParagraph().run()}>
                <Pilcrow /> Normal text
              </DropdownMenuItem>
              <DropdownMenuItem
                onSelect={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
              >
                <Heading1 /> <span className="text-base font-bold">Heading 1</span>
              </DropdownMenuItem>
              <DropdownMenuItem
                onSelect={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
              >
                <Heading2 /> <span className="font-bold">Heading 2</span>
              </DropdownMenuItem>
              <DropdownMenuItem
                onSelect={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
              >
                <Heading3 /> <span className="font-semibold">Heading 3</span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          {sep('s1')}
          {action(
            'Bold (Ctrl+B)',
            <Bold />,
            () => editor.chain().focus().toggleBold().run(),
            state?.bold,
          )}
          {action(
            'Italic (Ctrl+I)',
            <Italic />,
            () => editor.chain().focus().toggleItalic().run(),
            state?.italic,
          )}
          {action(
            'Underline (Ctrl+U)',
            <UnderlineIcon />,
            () => editor.chain().focus().toggleUnderline().run(),
            state?.underline,
          )}
          {action(
            'Strikethrough',
            <Strikethrough />,
            () => editor.chain().focus().toggleStrike().run(),
            state?.strike,
          )}
          {action(
            'Highlight',
            <Highlighter />,
            () => editor.chain().focus().toggleHighlight().run(),
            state?.highlight,
          )}
          {sep('s2')}
          {action(
            'Bullet list',
            <List />,
            () => editor.chain().focus().toggleBulletList().run(),
            state?.bullets,
          )}
          {action(
            'Numbered list',
            <ListOrdered />,
            () => editor.chain().focus().toggleOrderedList().run(),
            state?.numbers,
          )}
          {action(
            'Checklist',
            <ListTodo />,
            () => editor.chain().focus().toggleTaskList().run(),
            state?.tasks,
          )}
          {state?.tasks && (
            <>
              {action('Move list item up', <ArrowUp />, () => moveTask(editor, -1))}
              {action('Move list item down', <ArrowDown />, () => moveTask(editor, 1))}
            </>
          )}
          {sep('s3')}
          {action(
            'Hyperlink',
            <LinkIcon />,
            () => {
              setUrl(editor.getAttributes('link').href ?? '');
              setLinkOpen(true);
            },
            state?.link,
          )}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                disabled={readOnly}
                aria-label="Insert"
                title="Insert"
                onMouseDown={(e) => e.preventDefault()}
                className={cn(
                  'size-8 shrink-0 rounded-lg text-muted-foreground hover:text-foreground',
                  (state?.quote || state?.code || state?.table) && 'bg-primary/12 text-primary',
                )}
              >
                <Plus />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="start"
              className="w-56"
              onCloseAutoFocus={(e) => {
                e.preventDefault();
                editor.commands.focus();
              }}
            >
              <DropdownMenuLabel className="text-xs text-muted-foreground">
                Insert
              </DropdownMenuLabel>
              <DropdownMenuItem onSelect={() => editor.chain().focus().toggleBlockquote().run()}>
                <Quote /> Quote
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => editor.chain().focus().toggleCodeBlock().run()}>
                <SquareCode /> Code block
              </DropdownMenuItem>
              <DropdownMenuItem
                onSelect={() =>
                  editor
                    .chain()
                    .focus()
                    .insertTable({ rows: 3, cols: 3, withHeaderRow: true })
                    .run()
                }
              >
                <Table2 /> Table
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => editor.chain().focus().setHorizontalRule().run()}>
                <Minus /> Divider
              </DropdownMenuItem>
              {state?.table && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuLabel className="text-xs text-muted-foreground">
                    Table
                  </DropdownMenuLabel>
                  <DropdownMenuItem onSelect={() => editor.chain().focus().addRowAfter().run()}>
                    <Rows3 /> Add row
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => editor.chain().focus().addColumnAfter().run()}>
                    <Columns3 /> Add column
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    variant="destructive"
                    onSelect={() => editor.chain().focus().deleteTable().run()}
                  >
                    <Trash2 /> Delete table
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
          {sep('s4')}
          {action('Undo', <Undo2 />, () => editor.chain().focus().undo().run())}
          {action('Redo', <Redo2 />, () => editor.chain().focus().redo().run())}
        </div>
        {trailing && <div className="flex shrink-0 items-center pl-1">{trailing}</div>}
      </div>
      {tasks.length > 0 && (
        <p className="mb-3 text-xs text-muted-foreground" role="status">
          {tasks.filter((t) => t.attrs?.checked).length} of {tasks.length} tasks complete · Drag a
          task handle to reorder
        </p>
      )}
      <EditorContent
        editor={editor}
        style={{
          fontSize: Math.round(fontSize * writing.scale * 10) / 10,
          fontFamily: writing.family,
          lineHeight: 1.75,
        }}
      />
      <Dialog open={linkOpen} onOpenChange={setLinkOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Hyperlink</DialogTitle>
            <DialogDescription>
              Use an https, http or mailto URL. Clear it to remove the link.
            </DialogDescription>
          </DialogHeader>
          <Input aria-label="Link URL" value={url} onChange={(e) => setUrl(e.target.value)} />
          <Button
            onClick={() => {
              if (!url.trim()) editor.chain().focus().unsetLink().run();
              else if (/^(https?:\/\/|mailto:)/i.test(url))
                editor.chain().focus().setLink({ href: url.trim() }).run();
              else return;
              setLinkOpen(false);
            }}
          >
            Apply link
          </Button>
        </DialogContent>
      </Dialog>
    </>
  );
});
