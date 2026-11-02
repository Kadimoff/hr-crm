"use client";

import { SearchIcon } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";

/**
 * Başlıqdakı əməkdaş axtarışı. Göndəriş SPA keçidi ilə (router.push) — əvvəl adi GET forması bütün səhifəni
 * yenidən yükləyirdi (telefonda bir neçə saniyəlik «donma»). JS yüklənməyibsə forma yenə də işləyir.
 * Dar ekranda yalnız ikon — Əməkdaşlar siyahısının axtarış sahəsinə aparır.
 */
export function TopbarSearch() {
  const router = useRouter();
  return (
    <>
      <form
        action="/employees"
        role="search"
        className="relative hidden md:block"
        onSubmit={(e) => {
          e.preventDefault();
          const q = String(new FormData(e.currentTarget).get("q") ?? "").trim();
          router.push(q ? `/employees?q=${encodeURIComponent(q)}` : "/employees");
        }}
      >
        <SearchIcon className="pointer-events-none absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-muted-foreground" />
        <input
          name="q"
          type="search"
          enterKeyHint="search"
          placeholder="Əməkdaş, kod, FİN axtar…"
          aria-label="Əməkdaş axtar"
          className="h-9 w-48 rounded-xl border bg-muted pr-3 pl-8 text-xs placeholder:text-muted-foreground focus:ring-2 focus:ring-ring focus:outline-none xl:w-64"
        />
      </form>
      <Link href="/employees" aria-label="Əməkdaş axtar" className="flex size-10 items-center justify-center rounded-xl bg-muted text-muted-foreground md:hidden">
        <SearchIcon className="size-4" />
      </Link>
    </>
  );
}
