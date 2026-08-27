import { z } from "zod/v4";
import { ReaderConfigDocumentSchema } from "./document.js";
import { CONFIG_SCHEMA_ID, CURRENT_SCHEMA_VERSION } from "./version.js";

/**
 * The document schema as JSON Schema, for anyone writing a reader
 * configuration file without this package: an editor, a script, another client.
 * Derived from the zod schema rather than maintained beside it, so the two
 * cannot describe different documents.
 */
export function buildConfigJsonSchema(): Record<string, unknown> {
	return {
		...z.toJSONSchema(ReaderConfigDocumentSchema, {
			target: "draft-2020-12",
			io: "input",
		}),
		$id: CONFIG_SCHEMA_ID,
		title: `reader configuration document, v${CURRENT_SCHEMA_VERSION}`,
	};
}

export function serializeConfigJsonSchema(): string {
	return `${JSON.stringify(buildConfigJsonSchema(), null, "\t")}\n`;
}
