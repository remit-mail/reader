import assert from "node:assert/strict";
import { test } from "node:test";
import * as configFormat from "./index.js";

test("the package exports the reader, the schemas and the named failures", () => {
	for (const name of [
		"CONFIG_KIND",
		"CURRENT_SCHEMA_VERSION",
		"ConfigEnvelopeSchema",
		"ReaderConfigDocumentSchema",
		"readConfigDocument",
		"liftToCurrentVersion",
		"configMigrations",
		"buildConfigJsonSchema",
		"readGoldenConfigDocument",
		"ConfigKindError",
		"ConfigVersionError",
		"ConfigUnknownKeysError",
		"ConfigCredentialError",
		"ConfigMalformedError",
		"ConfigNotAnObjectError",
	]) {
		assert.ok(name in configFormat, `missing export: ${name}`);
	}
});
