"use client";

import React, { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Smile } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";

const EMOJI_CATEGORIES = [
  {
    name: "Rostos",
    emojis: [
      "\u{1F600}", "\u{1F602}", "\u{1F605}", "\u{1F606}", "\u{1F609}", "\u{1F60A}", "\u{1F60D}", "\u{1F618}",
      "\u{1F60E}", "\u{1F917}", "\u{1F914}", "\u{1F928}", "\u{1F644}", "\u{1F612}", "\u{1F62D}", "\u{1F631}",
      "\u{1F621}", "\u{1F525}", "\u{1F4AF}", "\u{2764}\u{FE0F}", "\u{1F60F}", "\u{1F913}", "\u{1F929}", "\u{1F973}",
      "\u{1F97A}", "\u{1F62C}", "\u{1F634}", "\u{1F637}", "\u{1F4A9}", "\u{1F47B}", "\u{1F480}", "\u{1F4A5}",
    ],
  },
  {
    name: "Gestos",
    emojis: [
      "\u{1F44D}", "\u{1F44E}", "\u{1F44C}", "\u{270C}\u{FE0F}", "\u{1F91E}", "\u{1F44A}", "\u{1F44B}", "\u{1F91D}",
      "\u{1F64F}", "\u{1F4AA}", "\u{1F44F}", "\u{1F64C}", "\u{1F91F}", "\u{261D}\u{FE0F}", "\u{1F448}", "\u{1F449}",
      "\u{1F446}", "\u{1F447}", "\u{270B}", "\u{1F596}",
    ],
  },
  {
    name: "Objetos",
    emojis: [
      "\u{1F4B0}", "\u{1F4B8}", "\u{1F4B5}", "\u{1F4B3}", "\u{1F381}", "\u{1F389}", "\u{1F38A}", "\u{1F3C6}",
      "\u{2B50}", "\u{1F31F}", "\u{26A1}", "\u{1F4A1}", "\u{1F4E2}", "\u{1F514}", "\u{1F4F1}", "\u{1F4BB}",
      "\u{1F4E6}", "\u{1F4CA}", "\u{1F4C8}", "\u{1F4C9}",
    ],
  },
  {
    name: "Comida",
    emojis: [
      "\u{2615}", "\u{1F37A}", "\u{1F377}", "\u{1F355}", "\u{1F354}", "\u{1F382}", "\u{1F370}", "\u{1F36B}",
      "\u{1F349}", "\u{1F34E}", "\u{1F34C}", "\u{1F353}",
    ],
  },
  {
    name: "Natureza",
    emojis: [
      "\u{2600}\u{FE0F}", "\u{1F308}", "\u{1F320}", "\u{1F30E}", "\u{1F334}", "\u{1F33B}", "\u{1F337}", "\u{1F340}",
      "\u{1F436}", "\u{1F431}", "\u{1F98B}", "\u{1F426}",
    ],
  },
  {
    name: "Marcadores",
    emojis: [
      "\u{2705}", "\u{274C}", "\u{2757}", "\u{2753}", "\u{1F4CC}", "\u{1F3AF}", "\u{1F6A8}", "\u{26A0}\u{FE0F}",
      "\u{1F6AB}", "\u{2B06}\u{FE0F}", "\u{2B07}\u{FE0F}", "\u{27A1}\u{FE0F}", "\u{2B05}\u{FE0F}", "\u{1F504}",
      "\u{2022}", "\u{25CF}", "\u{25CB}", "\u{25AA}\u{FE0F}", "\u{25AB}\u{FE0F}", "\u{1F7E2}",
    ],
  },
];

interface EmojiPickerProps {
  onSelect: (emoji: string) => void;
}

export function EmojiPicker({ onSelect }: EmojiPickerProps) {
  const [category, setCategory] = useState(0);
  const [open, setOpen] = useState(false);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          title="Emojis"
        >
          <Smile className="h-3.5 w-3.5" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-72 p-2" align="start">
        <div className="flex gap-1 mb-2 flex-wrap">
          {EMOJI_CATEGORIES.map((cat, i) => (
            <button
              key={cat.name}
              type="button"
              onClick={() => setCategory(i)}
              className={`text-xs px-2 py-1 rounded-md transition-colors ${
                i === category
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted hover:bg-muted/80 text-muted-foreground"
              }`}
            >
              {cat.name}
            </button>
          ))}
        </div>
        <ScrollArea className="h-[180px]">
          <div className="grid grid-cols-8 gap-0.5">
            {EMOJI_CATEGORIES[category].emojis.map((emoji) => (
              <button
                key={emoji}
                type="button"
                className="h-8 w-8 flex items-center justify-center rounded hover:bg-muted transition-colors text-lg"
                onClick={() => {
                  onSelect(emoji);
                  setOpen(false);
                }}
              >
                {emoji}
              </button>
            ))}
          </div>
        </ScrollArea>
      </PopoverContent>
    </Popover>
  );
}
