import assert from "node:assert/strict";
import { test } from "node:test";
import {
	ConfigCredentialError,
	ConfigKindError,
	ConfigMalformedError,
	ConfigNotAnObjectError,
	ConfigReadErrorCode,
	ConfigUnknownKeysError,
	ConfigVersionError,
} from "./errors.js";
import { readGoldenConfigDocument } from "./fixtures.js";
import { readConfigDocument } from "./read.js";

type Mutable = Record<string, unknown>;
type MutableAccount = Record<string, unknown>;

const document = (): Mutable =>
	structuredClone(readGoldenConfigDocument()) as Mutable;

const firstAccount = (source: Mutable): MutableAccount =>
	(source.accounts as MutableAccount[])[0] as MutableAccount;

test("a value that is not a JSON object is refused before anything else", () => {
	for (const input of ["{}", 1, null, [], undefined]) {
		assert.throws(() => readConfigDocument(input), ConfigNotAnObjectError);
	}
});

test("a foreign document is named by kind, not by its unknown keys", () => {
	const source = { ...document(), kind: "some.other.format" };

	assert.throws(
		() => readConfigDocument(source),
		(error: unknown) => {
			assert.ok(error instanceof ConfigKindError);
			assert.equal(error.code, ConfigReadErrorCode.WrongKind);
			assert.equal(error.expected, "reader.config");
			assert.equal(error.received, "some.other.format");
			return true;
		},
	);
});

test("a document with no kind at all is refused as the wrong kind", () => {
	const source = document();
	delete source.kind;

	assert.throws(() => readConfigDocument(source), ConfigKindError);
});

test("a newer document is refused by version, before its shape is judged", () => {
	const source = { ...document(), schemaVersion: 2, somethingV2Added: true };

	assert.throws(
		() => readConfigDocument(source),
		(error: unknown) => {
			assert.ok(error instanceof ConfigVersionError);
			assert.equal(error.documentVersion, 2);
			assert.equal(error.supportedVersion, 1);
			return true;
		},
	);
});

test("a version that is not a positive integer is malformed, not unsupported", () => {
	for (const schemaVersion of [0, -1, 1.5, "1", null]) {
		assert.throws(
			() => readConfigDocument({ ...document(), schemaVersion }),
			ConfigMalformedError,
		);
	}
});

test("an unknown top-level key is refused rather than dropped", () => {
	const source = { ...document(), notes: "hand-edited" };

	assert.throws(
		() => readConfigDocument(source),
		(error: unknown) => {
			assert.ok(error instanceof ConfigUnknownKeysError);
			assert.equal(error.path, "(document root)");
			assert.deepEqual(error.keys, ["notes"]);
			return true;
		},
	);
});

test("an unknown key names the nested object it sits in", () => {
	const source = document();
	firstAccount(source).imapDebug = true;

	assert.throws(
		() => readConfigDocument(source),
		(error: unknown) => {
			assert.ok(error instanceof ConfigUnknownKeysError);
			assert.equal(error.path, "accounts[0]");
			return true;
		},
	);
});

test("an account carrying a password is refused as a credential, not as an unknown key", () => {
	const source = document();
	firstAccount(source).password = "hunter2";

	assert.throws(
		() => readConfigDocument(source),
		(error: unknown) => {
			assert.ok(error instanceof ConfigCredentialError);
			assert.equal(error.code, ConfigReadErrorCode.CredentialPresent);
			assert.equal(error.path, "accounts[0]");
			assert.deepEqual(error.keys, ["password"]);
			return true;
		},
	);
});

test("a blank credential is refused exactly like a filled one", () => {
	const source = document();
	firstAccount(source).password = "";

	assert.throws(() => readConfigDocument(source), ConfigCredentialError);
});

test("every spelling of a credential is refused", () => {
	for (const key of [
		"passwordHash",
		"smtpPassword",
		"smtpPasswordHash",
		"oauthRefreshToken",
		"oauthRefreshTokenHash",
		"accessToken",
		"clientSecret",
		"apiKey",
	]) {
		const source = document();
		firstAccount(source)[key] = "value";

		assert.throws(
			() => readConfigDocument(source),
			(error: unknown) => {
				assert.ok(error instanceof ConfigCredentialError);
				assert.deepEqual(error.keys, [key]);
				return true;
			},
		);
	}
});

test("a credential smuggled into the requirement declaration is refused", () => {
	const source = document();
	firstAccount(source).credentials = {
		required: "password",
		password: "hunter2",
	};

	assert.throws(
		() => readConfigDocument(source),
		(error: unknown) => {
			assert.ok(error instanceof ConfigCredentialError);
			assert.equal(error.path, "accounts[0].credentials");
			return true;
		},
	);
});

test("a declared credential requirement is what a valid document carries instead", () => {
	const parsed = readConfigDocument(document());

	assert.deepEqual(parsed.accounts[0]?.credentials, { required: "password" });
	assert.equal(Object.hasOwn(parsed.accounts[0] as object, "password"), false);
});

test("a body that fails the schema for any other reason is malformed", () => {
	const source = document();
	source.accounts = "none";

	assert.throws(() => readConfigDocument(source), ConfigMalformedError);
});

test("the reserved decisions slot accepts nothing in v1", () => {
	const source = document();
	source.messageDecisions = [{ messageId: "x", decision: "filed" }];

	assert.throws(() => readConfigDocument(source), ConfigMalformedError);
});

test("the optional slots may be omitted entirely", () => {
	const source = document();
	delete source.clientPreferences;
	delete source.messageDecisions;

	const parsed = readConfigDocument(source);

	assert.equal(parsed.clientPreferences, undefined);
	assert.equal(parsed.messageDecisions, undefined);
});
