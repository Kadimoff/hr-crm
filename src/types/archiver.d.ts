// archiver üçün minimal tip tərifi (yalnız istifadə olunan API; versiya 5.3.2 sabitlənib)
declare module "archiver" {
  import type { Readable, Writable } from "node:stream";
  interface EntryData {
    name: string;
    /** true — sıxılmadan (PDF/şəkil artıq sıxılıb) */
    store?: boolean;
  }
  interface Archiver {
    pipe<T extends Writable>(dest: T): T;
    append(source: string | Buffer | Readable, data: EntryData): this;
    file(filepath: string, data: EntryData): this;
    finalize(): Promise<void>;
    on(event: "error" | "warning", listener: (err: Error) => void): this;
  }
  export default function archiver(format: "zip", options?: { zlib?: { level?: number } }): Archiver;
}
