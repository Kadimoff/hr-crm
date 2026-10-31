"use client";

import { CalendarIcon } from "lucide-react";
import type * as React from "react";
import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

/** YYYY-MM-DD → DD.MM.YYYY */
const toDisplay = (iso: string) => (/^\d{4}-\d{2}-\d{2}$/.test(iso) ? `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}` : "");

/** DD.MM.YYYY → YYYY-MM-DD (təqvimdə olmayan tarix — null) */
function toIso(text: string): string | null {
  const m = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(text);
  if (!m) return null;
  const [, dd, mm, yyyy] = m;
  const d = new Date(Date.UTC(Number(yyyy), Number(mm) - 1, Number(dd)));
  return d.getUTCDate() === Number(dd) && d.getUTCMonth() === Number(mm) - 1 ? `${yyyy}-${mm}-${dd}` : null;
}

/** Yazdıqca nöqtələr özü qoyulur: 31102026 → 31.10.2026 */
const mask = (raw: string) => {
  const digits = raw.replace(/\D/g, "").slice(0, 8);
  return [digits.slice(0, 2), digits.slice(2, 4), digits.slice(4)].filter(Boolean).join(".");
};

type Props = Omit<React.ComponentProps<"input">, "value" | "defaultValue" | "onChange" | "type"> & {
  /** YYYY-MM-DD və ya "" — idarə olunan rejim */
  value?: string;
  defaultValue?: string;
  /** Tam və düzgün tarix yazılanda və ya sahə təmizlənəndə: YYYY-MM-DD və ya "" */
  onChange?: (iso: string) => void;
};

/**
 * Tarix sahəsi — brauzerin dilindən asılı olmayaraq həmişə gün.ay.il (DD.MM.YYYY) göstərir.
 * Formaya `name` ilə YYYY-MM-DD göndərir (gizli sahə) — server tərəfi <input type="date"> ilə eyni qalır.
 */
export function DateInput({ value, defaultValue = "", onChange, name, className, disabled, id, ...rest }: Props) {
  const controlled = value !== undefined;
  const [iso, setIso] = useState(controlled ? value : defaultValue);
  const [text, setText] = useState(toDisplay(controlled ? value : defaultValue));
  const picker = useRef<HTMLInputElement>(null);

  // Yalnız value prop-u kənardan dəyişəndə (məs. filtr sıfırlananda) yenilənir — URL gecikməsi yazılanı geri qaytarmasın
  const lastValue = useRef(value);
  useEffect(() => {
    if (!controlled || value === lastValue.current) return;
    lastValue.current = value;
    setIso(value);
    setText(toDisplay(value));
  }, [controlled, value]);

  const commit = (next: string) => {
    setIso(next);
    onChange?.(next);
  };

  const invalid = text.length === 10 && !toIso(text);

  return (
    <div className={cn("relative", className)}>
      <input
        {...rest}
        id={id}
        data-field={name}
        type="text"
        inputMode="numeric"
        autoComplete="off"
        placeholder="gg.aa.iiii"
        maxLength={10}
        disabled={disabled}
        value={text}
        aria-invalid={invalid || rest["aria-invalid"]}
        onChange={(e) => {
          const t = mask(e.target.value);
          setText(t);
          if (!t) commit("");
          else {
            const next = toIso(t);
            if (next) commit(next);
          }
        }}
        onBlur={() => {
          // Yarımçıq və ya səhv yazılıbsa son düzgün dəyərə qayıdır
          if (text && !toIso(text)) setText(toDisplay(iso));
        }}
        className={cn(
          "flex h-9 w-full min-w-0 rounded-md border border-input bg-card py-1 pr-9 pl-3 text-sm tabular-nums shadow-xs outline-none transition-[color,box-shadow] placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/30 disabled:opacity-50",
          invalid && "border-danger",
        )}
      />
      {name && <input type="hidden" name={name} value={iso} />}
      {/* Təqvim: brauzerin öz seçicisi, amma dəyər yuxarıdakı sahədə gün.ay.il göstərilir */}
      <input
        ref={picker}
        type="date"
        tabIndex={-1}
        aria-hidden
        value={iso}
        disabled={disabled}
        onChange={(e) => {
          setText(toDisplay(e.target.value));
          commit(e.target.value);
        }}
        className="pointer-events-none absolute right-0 bottom-0 size-0 opacity-0"
      />
      <button
        type="button"
        disabled={disabled}
        onClick={() => picker.current?.showPicker?.()}
        aria-label="Təqvimdən seç"
        className="absolute top-1/2 right-1.5 -translate-y-1/2 rounded p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50"
      >
        <CalendarIcon className="size-4" />
      </button>
    </div>
  );
}
