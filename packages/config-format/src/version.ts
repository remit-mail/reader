/**
 * A reader configuration document declares its own kind and version in two
 * fields that never move between versions. Everything else in the document is
 * free to change shape; these two are the contract that lets a reader decide
 * what it is looking at before it knows how to read it.
 */
export const CONFIG_KIND = "reader.config";

/** The document version this package writes and can read up to. */
export const CURRENT_SCHEMA_VERSION = 1;

/** `$id` of the emitted JSON Schema artifact. */
export const CONFIG_SCHEMA_ID =
	"https://schemas.remit.email/reader-config.v1.schema.json";

/** Path of the emitted JSON Schema artifact, relative to the repository root. */
export const CONFIG_SCHEMA_ARTIFACT_PATH =
	"build/config-schema/reader-config.v1.schema.json";
