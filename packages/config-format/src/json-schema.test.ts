import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
	buildConfigJsonSchema,
	serializeConfigJsonSchema,
} from "./json-schema.js";
import { artifactSchemaPath, committedSchemaPath } from "./schema-artifact.js";
import { CONFIG_SCHEMA_ARTIFACT_PATH, CONFIG_SCHEMA_ID } from "./version.js";

type JsonObject = Record<string, unknown>;

const schema = () => buildConfigJsonSchema() as JsonObject;

test("the emitted schema identifies itself", () => {
	const emitted = schema();

	assert.equal(emitted.$id, CONFIG_SCHEMA_ID);
	assert.equal(emitted.$schema, "https://json-schema.org/draft/2020-12/schema");
});

test("the emitted schema pins the envelope and closes the document", () => {
	const emitted = schema();
	const properties = emitted.properties as JsonObject;

	assert.deepEqual((properties.kind as JsonObject).const, "reader.config");
	assert.deepEqual((properties.schemaVersion as JsonObject).const, 1);
	assert.equal(emitted.additionalProperties, false);
	assert.deepEqual(emitted.required, [
		"kind",
		"schemaVersion",
		"generator",
		"provenance",
		"accountConfig",
		"accounts",
		"labels",
		"filters",
		"addressFlags",
	]);
});

test("the emitted schema closes every account object too", () => {
	const properties = schema().properties as JsonObject;
	const account = (properties.accounts as JsonObject).items as JsonObject;

	assert.equal(account.additionalProperties, false);
	assert.equal(
		Object.hasOwn(account.properties as JsonObject, "credentials"),
		true,
	);
	assert.equal(
		Object.hasOwn(account.properties as JsonObject, "password"),
		false,
	);
});

test("the generated artifact lands at its declared path under the repository root", () => {
	assert.ok(artifactSchemaPath().endsWith(`/${CONFIG_SCHEMA_ARTIFACT_PATH}`));
});

test("the committed schema artifact matches what the code emits", () => {
	assert.equal(
		readFileSync(committedSchemaPath(), "utf8"),
		serializeConfigJsonSchema(),
	);
});
