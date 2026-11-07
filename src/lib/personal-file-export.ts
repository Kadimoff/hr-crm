import "server-only";
import { existsSync } from "node:fs";
import path from "node:path";
import { PassThrough, Readable } from "node:stream";
import archiver from "archiver";
import ExcelJS from "exceljs";
import { DOCUMENT_KINDS } from "@/lib/document-types";
import { DOCUMENTS_DIR } from "@/lib/documents";
import { buildPersonalIndex, INDEX_SECTION_LABELS } from "@/lib/personal-file";
import type { Dossier } from "@/lib/queries";
import { SALARY_HIDDEN_LABEL } from "@/lib/salary-privacy";
import { UNKNOWN_LABEL } from "@/lib/unknown-values";
import { formatAzDate } from "@/lib/validation/primitives";

const safe = (s: string) =>
  s
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80) || "sened";

const KIND_ORDER = Object.keys(DOCUMENT_KINDS);

/** İndeks, müqavilələr və sənədlər siyahısı — bir Excel faylında (maaş gizlədilibsə oklad «Məxfi») */
async function indexWorkbook(data: Dossier): Promise<Buffer> {
  const p = data.person;
  const wb = new ExcelJS.Workbook();
  wb.creator = "ASOİU HR CRM";
  const idx = wb.addWorksheet("İndeks");
  idx.columns = [
    { header: "Tarix", key: "date", width: 12 },
    { header: "Bölmə", key: "section", width: 22 },
    { header: "Qeyd", key: "title", width: 40 },
    { header: "Məzmun", key: "detail", width: 60 },
    { header: "Yoxlanılıb", key: "verified", width: 11 },
  ];
  for (const r of buildPersonalIndex(p))
    idx.addRow({ date: r.date ? formatAzDate(r.date) : UNKNOWN_LABEL, section: INDEX_SECTION_LABELS[r.section], title: r.title, detail: r.detail, verified: r.documentId ? (r.verified ? "bəli" : "xeyr") : "" });
  const emp = wb.addWorksheet("Müqavilələr");
  emp.columns = [
    { header: "Bölmə", key: "dep", width: 34 },
    { header: "Vəzifə", key: "pos", width: 30 },
    { header: "İşə qəbul", key: "hire", width: 12 },
    { header: "Növ", key: "type", width: 12 },
    { header: "Bitmə", key: "end", width: 12 },
    { header: "Ştat", key: "share", width: 8 },
    { header: "Oklad", key: "salary", width: 12 },
    { header: "Status", key: "status", width: 14 },
  ];
  for (const e of p.employments)
    emp.addRow({
      dep: e.department.name,
      pos: e.position.name,
      hire: e.hireDate ? formatAzDate(e.hireDate) : UNKNOWN_LABEL,
      type: e.contractType === "MUDDETLI" ? "müddətli" : e.contractType === "MUDDETSIZ" ? "müddətsiz" : "",
      end: formatAzDate(e.contractEndDate),
      share: Number(e.unitShare),
      salary: data.salaryHidden ? SALARY_HIDDEN_LABEL : e.baseSalary === null ? UNKNOWN_LABEL : Number(e.baseSalary),
      status: e.status === "TERMINATED" ? `azad ${formatAzDate(e.terminationDate)}` : e.status === "ON_LEAVE" ? "məzuniyyətdə" : "aktiv",
    });
  const docs = wb.addWorksheet("Sənədlər");
  docs.columns = [
    { header: "Növ", key: "kind", width: 26 },
    { header: "Ad", key: "title", width: 44 },
    { header: "Nömrə", key: "number", width: 14 },
    { header: "Tarix", key: "date", width: 12 },
    { header: "Fayl (ZIP-də)", key: "file", width: 60 },
    { header: "Yoxlanılıb", key: "verified", width: 22 },
  ];
  for (const f of zipEntries(data)) docs.addRow({ kind: DOCUMENT_KINDS[f.doc.kind], title: f.doc.title, number: f.doc.number ?? "", date: formatAzDate(f.doc.documentDate), file: f.name, verified: f.doc.verifiedAt ? `${formatAzDate(f.doc.verifiedAt)} · ${f.doc.verifiedBy?.fullName ?? ""}` : "xeyr" });
  for (const ws of [idx, emp, docs]) {
    ws.getRow(1).font = { bold: true };
    ws.views = [{ state: "frozen", ySplit: 1 }];
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}

/** ZIP-dəki yollar: senedler/<NN növ>/<tarix>_<ad>.<uzantı> (təkrarlanan adlara nömrə) */
function zipEntries(data: Dossier) {
  const used = new Set<string>();
  return data.person.documents.map((doc) => {
    const n = KIND_ORDER.indexOf(doc.kind) + 1;
    const dir = `senedler/${String(n).padStart(2, "0")} ${safe(DOCUMENT_KINDS[doc.kind])}`;
    const base = `${doc.documentDate ? doc.documentDate.toISOString().slice(0, 10) : "tarixsiz"}_${safe(doc.title)}`;
    let name = `${dir}/${base}.${doc.extension}`;
    for (let i = 2; used.has(name); i++) name = `${dir}/${base} (${i}).${doc.extension}`;
    used.add(name);
    return { doc, name };
  });
}

/** Şəxsi işin ZIP arxivi (axınla): indeks.xlsx + bütün sənəd faylları + izah */
export async function personalFileZip(data: Dossier): Promise<ReadableStream> {
  const archive = archiver("zip", { zlib: { level: 6 } });
  const out = new PassThrough();
  archive.on("error", (e) => out.destroy(e));
  archive.pipe(out);
  const p = data.person;
  archive.append(
    [
      `Şəxsi iş: ${p.fullName} (${p.code})`,
      `Hazırlanıb: ${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC`,
      "",
      "00-indeks.xlsx — vahid xronoloji indeks, müqavilələr və sənədlərin siyahısı (yoxlanılma işarəsi ilə).",
      "senedler/ — şəxsi iş qovluğundakı fayllar, növ üzrə qovluqlarda.",
      data.salaryHidden ? "Maaş məlumatı sizə görünmədiyi üçün indeksdə oklad «Məxfi» kimi göstərilib." : "",
      "«Məlum deyil» — miqrasiyada mənbədə olmayan sahə (uydurulmayıb).",
    ]
      .filter((l) => l !== null)
      .join("\r\n"),
    { name: "README.txt" },
  );
  archive.append(await indexWorkbook(data), { name: "00-indeks.xlsx" });
  // Diskdə olmayan fayl arxivi pozmasın — siyahıda qeyd olunur
  const missing: string[] = [];
  for (const f of zipEntries(data)) {
    const abs = path.join(DOCUMENTS_DIR, f.doc.storagePath);
    if (existsSync(abs)) archive.file(abs, { name: f.name, store: true });
    else missing.push(f.name);
  }
  if (missing.length) archive.append(`Diskdə tapılmayan fayllar:\r\n${missing.join("\r\n")}`, { name: "TAPILMAYANLAR.txt" });
  void archive.finalize();
  return Readable.toWeb(out) as ReadableStream;
}
