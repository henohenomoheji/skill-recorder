import { existsSync } from "node:fs";

/** Native helpers need real disk paths; ASAR virtual paths cannot be spawned. */
export function unpackedPathOnDisk(file: string, exists: (file: string) => boolean = existsSync): string | undefined {
  const physical = file.replace(/\.asar([\\/])/, ".asar.unpacked$1");
  return exists(physical) ? physical : undefined;
}
