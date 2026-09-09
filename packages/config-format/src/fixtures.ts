import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * The committed v1 document. It is the seed the migration chain regresses
 * against: every later version has to lift this exact file, so the shape v1
 * shipped with can never be quietly redefined.
 */
export const goldenConfigDocumentPath = (): string =>
	fileURLToPath(new URL("./fixtures/reader-config.v1.json", import.meta.url));

export const readGoldenConfigDocument = (): unknown =>
	JSON.parse(readFileSync(goldenConfigDocumentPath(), "utf8"));
