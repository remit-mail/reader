import { z } from "zod/v4";
import { CONFIG_KIND } from "./version.js";

/**
 * The first of the two passes. Deliberately tiny and deliberately not strict:
 * it answers "what is this file, and which version of the format does it claim
 * to be" without any opinion about the rest, so a document written by a newer
 * reader still identifies itself instead of failing as a wall of unknown keys.
 */
export const ConfigEnvelopeSchema = z.object({
	kind: z.literal(CONFIG_KIND),
	schemaVersion: z.int().min(1),
});
