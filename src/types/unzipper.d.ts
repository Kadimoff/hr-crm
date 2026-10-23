// unzipper üçün minimal tip tərifi (yalnız istifadə olunan API)
declare module "unzipper" {
  interface CentralDirectoryFile {
    path: string;
    type: "File" | "Directory";
    buffer(): Promise<Buffer>;
    stream(): import("node:stream").Readable;
  }
  interface CentralDirectory {
    files: CentralDirectoryFile[];
  }
  export const Open: { file(path: string): Promise<CentralDirectory> };
}

// ExcelJS daxili axın iteratoru (versiya 4.4.0 sabitlənib)
declare module "exceljs/lib/utils/iterate-stream.js" {
  const iterateStream: (stream: import("node:stream").Readable) => AsyncIterable<unknown>;
  export default iterateStream;
}
