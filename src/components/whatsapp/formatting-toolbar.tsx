"use client";

import React from "react";
import { Button } from "@/components/ui/button";
import { Bold, Italic, Strikethrough, Code } from "lucide-react";

interface FormattingToolbarProps {
  textareaRef: React.RefObject<HTMLTextAreaElement | null>;
  value: string;
  onChange: (value: string) => void;
}

function wrapSelection(
  textareaRef: React.RefObject<HTMLTextAreaElement | null>,
  value: string,
  onChange: (value: string) => void,
  marker: string
) {
  const textarea = textareaRef.current;
  if (!textarea) return;

  const start = textarea.selectionStart;
  const end = textarea.selectionEnd;
  const selected = value.slice(start, end);
  const before = value.slice(0, start);
  const after = value.slice(end);

  const wrapped = `${marker}${selected}${marker}`;
  const newValue = `${before}${wrapped}${after}`;
  onChange(newValue);

  // Restore cursor after React re-render
  requestAnimationFrame(() => {
    textarea.focus();
    if (selected.length > 0) {
      // Select the text inside markers
      textarea.setSelectionRange(
        start + marker.length,
        end + marker.length
      );
    } else {
      // Place cursor between markers
      textarea.setSelectionRange(
        start + marker.length,
        start + marker.length
      );
    }
  });
}

const FORMATS = [
  { icon: Bold, marker: "*", title: "Negrito" },
  { icon: Italic, marker: "_", title: "Italico" },
  { icon: Strikethrough, marker: "~", title: "Tachado" },
  { icon: Code, marker: "```", title: "Monoespaco" },
] as const;

export function FormattingToolbar({
  textareaRef,
  value,
  onChange,
}: FormattingToolbarProps) {
  return (
    <div className="flex items-center gap-0.5">
      {FORMATS.map(({ icon: Icon, marker, title }) => (
        <Button
          key={title}
          type="button"
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          title={title}
          onClick={() => wrapSelection(textareaRef, value, onChange, marker)}
        >
          <Icon className="h-3.5 w-3.5" />
        </Button>
      ))}
    </div>
  );
}
