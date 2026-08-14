/**
 * ZIP archives via fflate (DEFLATE). Do not use CompressionStream here:
 * writing then reading the same stream deadlocks on large log bodies.
 */

import { strToU8, zip, type AsyncZippable } from "fflate";

export interface ZipEntry {
  path: string;
  content: string | Uint8Array;
}

export function zipFiles(entries: ZipEntry[], now: Date = new Date()): Promise<Uint8Array> {
  const files: AsyncZippable = {};
  for (const entry of entries) {
    const path = entry.path.replace(/\\/g, "/");
    const data = typeof entry.content === "string" ? strToU8(entry.content) : entry.content;
    files[path] = [data, { level: 6, mtime: now }];
  }

  return new Promise((resolve, reject) => {
    zip(files, (err, data) => {
      if (err) {
        reject(err);
        return;
      }
      resolve(data);
    });
  });
}
