import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { RemitImapQuarantineResponse } from "@remit/api-http-client/types.gen.ts";
import { toQuarantineEntry } from "./quarantine-entries";

const wire: RemitImapQuarantineResponse = {
	quarantineId: "8b1e0c2a-0000-4000-8000-000000000001",
	accountConfigId: "8b1e0c2a-0000-4000-8000-000000000002",
	accountId: "8b1e0c2a-0000-4000-8000-000000000003",
	mailboxId: "8b1e0c2a-0000-4000-8000-000000000004",
	uidValidity: 1717171717,
	uid: 4211,
	mailboxRole: "Junk",
	mailboxPath: "INBOX/Spam",
	quarantinedAt: 1_750_000_000_000,
	attempts: 3,
	failureStage: "BodyParse",
	failureCode: "UnknownCharset",
	failureMessage: 'unknown charset "x-mac-roman"',
	failurePartPath: "1.2",
	workerVersion: "imap-worker@1.4.0",
	contentType: "multipart/mixed",
	transferEncoding: "base64",
	charset: "x-mac-roman",
	sizeBytes: 91_204,
	structure: [
		{ depth: 0, contentType: "multipart/mixed" },
		{ depth: 1, contentType: "text/plain" },
	],
	messageIdHash: "sha256:abc",
	createdAt: 1_750_000_000_000,
	updatedAt: 1_750_000_000_000,
};

describe("toQuarantineEntry", () => {
	it("spells the folder role the way the kit does", () => {
		assert.equal(toQuarantineEntry(wire, "/").mailboxRole, "junk");
	});

	it("leaves the role absent when the folder has none appointed", () => {
		const { mailboxRole: _dropped, ...roleless } = wire;
		assert.equal(toQuarantineEntry(roleless, "/").mailboxRole, undefined);
	});

	it("carries every field the report and the row are built from", () => {
		const entry = toQuarantineEntry(wire, "/");
		assert.equal(entry.quarantineId, wire.quarantineId);
		assert.equal(entry.uid, wire.uid);
		assert.equal(entry.uidValidity, wire.uidValidity);
		assert.equal(entry.mailboxPath, wire.mailboxPath);
		assert.equal(entry.failureCode, wire.failureCode);
		assert.equal(entry.failureStage, wire.failureStage);
		assert.equal(entry.failureMessage, wire.failureMessage);
		assert.equal(entry.failurePartPath, wire.failurePartPath);
		assert.equal(entry.attempts, wire.attempts);
		assert.equal(entry.quarantinedAt, wire.quarantinedAt);
		assert.equal(entry.workerVersion, wire.workerVersion);
		assert.equal(entry.contentType, wire.contentType);
		assert.equal(entry.transferEncoding, wire.transferEncoding);
		assert.equal(entry.charset, wire.charset);
		assert.equal(entry.sizeBytes, wire.sizeBytes);
		assert.equal(entry.messageIdHash, wire.messageIdHash);
		assert.deepEqual(entry.structure, wire.structure);
	});

	it("carries the delimiter the caller resolved, which the wire has not", () => {
		assert.equal("mailboxDelimiter" in wire, false);
		assert.equal(toQuarantineEntry(wire, ".").mailboxDelimiter, ".");
	});

	it("drops the fields the settings surface has no use for", () => {
		const entry = toQuarantineEntry(wire, "/");
		assert.equal("accountConfigId" in entry, false);
		assert.equal("createdAt" in entry, false);
		assert.equal("updatedAt" in entry, false);
	});
});
