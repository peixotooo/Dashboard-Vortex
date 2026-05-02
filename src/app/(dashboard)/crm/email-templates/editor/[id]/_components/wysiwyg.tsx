"use client";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Underline from "@tiptap/extension-underline";
import { TextStyle } from "@tiptap/extension-text-style";
import { Color } from "@tiptap/extension-color";
import { Mark, mergeAttributes } from "@tiptap/core";
import { useEffect } from "react";
import { Bold, Italic, Underline as UnderlineIcon, Type, Palette } from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Button } from "@/components/ui/button";

// Custom mark that wraps the selection in <span style="font-size:Xpx">.
// Using TextStyle as the parent so it composes with Color cleanly.
const FontSize = Mark.create({
  name: "fontSize",
  addOptions() {
    return { HTMLAttributes: {} };
  },
  addAttributes() {
    return {
      size: {
        default: null,
        parseHTML: (el) => {
          const m = (el as HTMLElement).style.fontSize;
          return m ? parseInt(m, 10) : null;
        },
        renderHTML: (attrs: { size: number | null }) => {
          if (!attrs.size) return {};
          return { style: `font-size:${attrs.size}px` };
        },
      },
    };
  },
  parseHTML() {
    return [{ style: "font-size" }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["span", mergeAttributes(this.options.HTMLAttributes, HTMLAttributes), 0];
  },
  addCommands() {
    return {
      setFontSize:
        (size: number) =>
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ({ commands }: { commands: any }) =>
          commands.setMark(this.name, { size }),
      unsetFontSize:
        () =>
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ({ commands }: { commands: any }) =>
          commands.unsetMark(this.name),
    } as never;
  },
});

interface Props {
  /** Initial HTML (Tiptap will parse it). For hook (single-line) blocks pass
   *  raw text wrapped in a <p>. */
  value: string;
  onChange: (html: string) => void;
  /** Single-line means Enter is suppressed (used for hook/headline). */
  singleLine?: boolean;
  /** "px" font sizes shown in the toolbar dropdown. */
  sizePresets?: number[];
  placeholder?: string;
}

const SIZE_PRESETS_DEFAULT = [11, 13, 15, 18, 24, 38, 56];
const COLOR_PRESETS = [
  "#FFFFFF",
  "#D8D8D8",
  "#A8A8A8",
  "#6E6E6E",
  "#3A3A3A",
  "#000000",
  "#1F2937",
  "#0F172A",
];

export function WysiwygEditor({
  value,
  onChange,
  singleLine,
  sizePresets,
  placeholder,
}: Props) {
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: false,
        bulletList: false,
        orderedList: false,
        listItem: false,
        blockquote: false,
        codeBlock: false,
        code: false,
        horizontalRule: false,
      }),
      Underline,
      TextStyle,
      Color.configure({ types: ["textStyle"] }),
      FontSize,
    ],
    content: value || "<p></p>",
    immediatelyRender: false,
    editorProps: {
      attributes: {
        class:
          "min-h-[60px] focus:outline-none px-3 py-2 text-sm leading-relaxed prose-sm max-w-none",
      },
      handleKeyDown(_view, event) {
        if (singleLine && event.key === "Enter" && !event.shiftKey) {
          event.preventDefault();
          return true;
        }
        return false;
      },
    },
    onUpdate({ editor }) {
      onChange(editor.getHTML());
    },
  });

  // Re-sync when the underlying value changes from outside (e.g. block swap).
  useEffect(() => {
    if (!editor) return;
    if (value === editor.getHTML()) return;
    editor.commands.setContent(value || "<p></p>", { emitUpdate: false });
  }, [value, editor]);

  if (!editor) return <div className="h-16 rounded border bg-muted/30 animate-pulse" />;

  const presets = sizePresets ?? SIZE_PRESETS_DEFAULT;

  const isActive = (name: string, attrs?: Record<string, unknown>) =>
    editor.isActive(name, attrs);

  return (
    <div className="rounded-md border bg-background">
      <div className="flex items-center gap-0.5 px-1.5 py-1 border-b bg-muted/30">
        <ToolbarBtn
          active={isActive("bold")}
          onClick={() => editor.chain().focus().toggleBold().run()}
          title="Bold"
        >
          <Bold className="w-3.5 h-3.5" />
        </ToolbarBtn>
        <ToolbarBtn
          active={isActive("italic")}
          onClick={() => editor.chain().focus().toggleItalic().run()}
          title="Itálico"
        >
          <Italic className="w-3.5 h-3.5" />
        </ToolbarBtn>
        <ToolbarBtn
          active={isActive("underline")}
          onClick={() => editor.chain().focus().toggleUnderline().run()}
          title="Sublinhado"
        >
          <UnderlineIcon className="w-3.5 h-3.5" />
        </ToolbarBtn>

        <div className="w-px h-4 bg-border mx-1" />

        <Popover>
          <PopoverTrigger asChild>
            <button
              type="button"
              className="inline-flex items-center gap-1 h-7 px-2 rounded text-[11px] hover:bg-muted text-muted-foreground"
              title="Tamanho"
            >
              <Type className="w-3.5 h-3.5" />
              <span>Tamanho</span>
            </button>
          </PopoverTrigger>
          <PopoverContent className="w-44 p-2" align="start">
            <div className="text-[10px] uppercase tracking-widest text-muted-foreground mb-1.5 px-1">
              Tamanho da fonte
            </div>
            <div className="grid grid-cols-3 gap-1">
              {presets.map((s) => (
                <button
                  key={s}
                  type="button"
                  className="h-7 text-[11px] rounded border hover:bg-muted"
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  onClick={() => (editor.chain().focus() as any).setFontSize(s).run()}
                >
                  {s}px
                </button>
              ))}
            </div>
            <button
              type="button"
              className="w-full h-7 text-[11px] rounded border hover:bg-muted mt-1"
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              onClick={() => (editor.chain().focus() as any).unsetFontSize().run()}
            >
              Padrão
            </button>
          </PopoverContent>
        </Popover>

        <Popover>
          <PopoverTrigger asChild>
            <button
              type="button"
              className="inline-flex items-center gap-1 h-7 px-2 rounded text-[11px] hover:bg-muted text-muted-foreground"
              title="Cor"
            >
              <Palette className="w-3.5 h-3.5" />
              <span>Cor</span>
            </button>
          </PopoverTrigger>
          <PopoverContent className="w-56 p-2" align="start">
            <div className="text-[10px] uppercase tracking-widest text-muted-foreground mb-1.5 px-1">
              Cor do texto
            </div>
            <div className="grid grid-cols-8 gap-1">
              {COLOR_PRESETS.map((c) => (
                <button
                  key={c}
                  type="button"
                  className="w-5 h-5 rounded border border-border"
                  style={{ background: c }}
                  onClick={() => editor.chain().focus().setColor(c).run()}
                  title={c}
                />
              ))}
            </div>
            <div className="flex items-center gap-1 mt-2">
              <input
                type="color"
                onChange={(e) => editor.chain().focus().setColor(e.target.value).run()}
                className="w-7 h-7 rounded border cursor-pointer bg-transparent"
              />
              <button
                type="button"
                className="flex-1 h-7 text-[11px] rounded border hover:bg-muted"
                onClick={() => editor.chain().focus().unsetColor().run()}
              >
                Padrão
              </button>
            </div>
          </PopoverContent>
        </Popover>
      </div>
      <EditorContent editor={editor} placeholder={placeholder} />
    </div>
  );
}

function ToolbarBtn({
  active,
  onClick,
  title,
  children,
}: {
  active: boolean;
  onClick: () => void;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <Button
      type="button"
      size="sm"
      variant={active ? "default" : "ghost"}
      className="h-7 w-7 p-0"
      onClick={onClick}
      title={title}
    >
      {children}
    </Button>
  );
}
