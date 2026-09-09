import { fileURLToPath } from "node:url";
import { CONFIG_SCHEMA_ARTIFACT_PATH } from "./version.js";

/**
 * The reviewable copy of the JSON Schema. Committed inside the package so a
 * change to the document shape shows up as a schema diff in the same review,
 * which is the only thing the check can compare against — the build artifact
 * below is regenerated from empty on every CI run and would agree with itself.
 */
export const committedSchemaPath = (): string =>
	fileURLToPath(
		new URL("../schema/reader-config.v1.schema.json", import.meta.url),
	);

/** The generated artifact, at its path under the repository root. */
export const artifactSchemaPath = (): string =>
	fileURLToPath(
		new URL(`../../../${CONFIG_SCHEMA_ARTIFACT_PATH}`, import.meta.url),
	);
