import { createHash } from "node:crypto";

export function sha256(text: string): string {
  return createHash("sha256").update(text.replace(/\r\n/g, "\n")).digest("hex");
}

// Short hash written in generated headers.
export function schemaHash(text: string): string {
  return sha256(text).slice(0, 16);
}
