import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import {
	_resetSemanticCapabilityForTest,
	isSemanticSearchUnavailable,
	noteSemanticCapabilityAbsence,
} from "./semantic-capability.js";

const moduleNotFound = (): Error => {
	const error = new Error(
		"Cannot find package '@huggingface/transformers' imported from /app/server.mjs",
	);
	(error as Error & { code: string }).code = "ERR_MODULE_NOT_FOUND";
	return error;
};

describe("noteSemanticCapabilityAbsence", () => {
	const ORIGINAL = process.env.DATA_BACKEND;
	beforeEach(() => {
		_resetSemanticCapabilityForTest();
	});
	afterEach(() => {
		if (ORIGINAL === undefined) delete process.env.DATA_BACKEND;
		else process.env.DATA_BACKEND = ORIGINAL;
		_resetSemanticCapabilityForTest();
	});

	it("absorbs a missing-module failure on the self-host SQL backends and remembers it", () => {
		for (const backend of ["sqlite", "postgres"]) {
			_resetSemanticCapabilityForTest();
			process.env.DATA_BACKEND = backend;
			assert.equal(isSemanticSearchUnavailable(), false);
			assert.equal(noteSemanticCapabilityAbsence(moduleNotFound()), true);
			assert.equal(isSemanticSearchUnavailable(), true);
		}
	});

	it("absorbs a dlopen failure (musl loading a glibc extension)", () => {
		process.env.DATA_BACKEND = "sqlite";
		const error = new Error(
			"Error loading shared library ld-linux-x86-64.so.2: No such file or directory",
		);
		(error as Error & { code: string }).code = "ERR_DLOPEN_FAILED";
		assert.equal(noteSemanticCapabilityAbsence(error), true);
	});

	it("rethrows genuine query errors on the self-host SQL backends", () => {
		process.env.DATA_BACKEND = "sqlite";
		assert.equal(
			noteSemanticCapabilityAbsence(new Error("SQLITE_BUSY")),
			false,
		);
		assert.equal(isSemanticSearchUnavailable(), false);
		assert.equal(noteSemanticCapabilityAbsence(undefined), false);
	});

	it("never engages on the AWS DynamoDB path — a missing module there is a broken deploy", () => {
		delete process.env.DATA_BACKEND;
		assert.equal(noteSemanticCapabilityAbsence(moduleNotFound()), false);
		process.env.DATA_BACKEND = "dynamodb";
		assert.equal(noteSemanticCapabilityAbsence(moduleNotFound()), false);
		assert.equal(isSemanticSearchUnavailable(), false);
	});
});
