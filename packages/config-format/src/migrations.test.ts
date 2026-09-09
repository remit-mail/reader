import assert from "node:assert/strict";
import { test } from "node:test";
import { ConfigVersionError } from "./errors.js";
import { readGoldenConfigDocument } from "./fixtures.js";
import {
	type ConfigMigration,
	configMigrations,
	liftToCurrentVersion,
} from "./migrations.js";
import { readConfigDocument } from "./read.js";
import { CURRENT_SCHEMA_VERSION } from "./version.js";

test("v1 needs no migrations, and the chain is empty rather than absent", () => {
	assert.deepEqual(configMigrations, []);
});

test("a document already at the current version passes through untouched", () => {
	const source = readGoldenConfigDocument() as Record<string, unknown>;

	assert.equal(liftToCurrentVersion(source, CURRENT_SCHEMA_VERSION), source);
});

test("the chain lifts one version at a time", () => {
	const migrations: ConfigMigration[] = [
		{
			from: 1,
			to: 2,
			migrate: (document) => ({ ...document, schemaVersion: 2, added: "two" }),
		},
		{
			from: 2,
			to: 3,
			migrate: (document) => ({
				...document,
				schemaVersion: 3,
				added: "three",
			}),
		},
	];

	const lifted = liftToCurrentVersion({ schemaVersion: 1 }, 1, migrations, 3);

	assert.deepEqual(lifted, { schemaVersion: 3, added: "three" });
});

test("a gap in the chain fails instead of leaving the document at its old version", () => {
	const migrations: ConfigMigration[] = [
		{ from: 2, to: 3, migrate: (document) => document },
	];

	assert.throws(
		() => liftToCurrentVersion({ schemaVersion: 1 }, 1, migrations, 3),
		(error: unknown) => {
			assert.ok(error instanceof ConfigVersionError);
			assert.equal(error.documentVersion, 1);
			assert.equal(error.supportedVersion, 3);
			return true;
		},
	);
});

test("a document already at the current version never enters the chain", () => {
	let ran = 0;
	const migrations: ConfigMigration[] = [
		{
			from: 1,
			to: 2,
			migrate: (document) => {
				ran += 1;
				return document;
			},
		},
	];

	const parsed = readConfigDocument(readGoldenConfigDocument(), migrations);

	assert.equal(ran, 0);
	assert.equal(parsed.schemaVersion, CURRENT_SCHEMA_VERSION);
});
