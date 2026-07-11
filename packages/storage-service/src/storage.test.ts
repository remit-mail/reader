import assert from "node:assert";
import { createHash } from "node:crypto";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { describe, test } from "node:test";
import { ContentEncoding, StorageType } from "@remit/domain-enums";
import { createFilesystemStorageService } from "./backends/filesystem.js";
import {
	buildBodyPartKey,
	buildDeduplicatedKey,
	buildExtractedPrefix,
	buildExtractedSkippedKey,
	buildExtractedTextKey,
	buildMessageBodyKey,
	buildParsedBodyKey,
	computeChecksum,
	createMockStorageService,
	isStorageNotFoundError,
	parseContentStorageKey,
} from "./storage.js";
import { buildStorageUri, parseStorageUri } from "./uri.js";

describe("parseStorageUri", () => {
	test("parses S3 URIs", () => {
		const result = parseStorageUri("s3://my-bucket/path/to/object");
		assert.strictEqual(result.storageType, StorageType.S3);
		assert.strictEqual(result.storageLocation, "my-bucket");
		assert.strictEqual(result.storageKey, "path/to/object");
	});

	test("parses file URIs", () => {
		const result = parseStorageUri("file:///var/data/remit/path/to/file");
		assert.strictEqual(result.storageType, StorageType.Filesystem);
		assert.strictEqual(result.storageKey, "/var/data/remit/path/to/file");
	});

	test("throws for unsupported schemes", () => {
		assert.throws(
			() => parseStorageUri("http://example.com/file"),
			/Unsupported storage URI scheme/,
		);
	});
});

describe("buildStorageUri", () => {
	test("builds S3 URIs", () => {
		const uri = buildStorageUri(StorageType.S3, "my-bucket", "path/to/object");
		assert.strictEqual(uri, "s3://my-bucket/path/to/object");
	});

	test("builds file URIs", () => {
		const uri = buildStorageUri(
			StorageType.Filesystem,
			"/var/data",
			"path/to/file",
		);
		assert.strictEqual(uri, "file:///var/data/path/to/file");
	});
});

describe("path builders", () => {
	test("buildMessageBodyKey nests accountId under accountConfigId for tenant-scoped CloudFront caching", () => {
		const key = buildMessageBodyKey("cfg1", "acc123", "msg456");
		assert.strictEqual(key, "accounts/cfg1/acc123/messages/msg456/body.eml");
	});

	test("buildBodyPartKey nests accountId under accountConfigId", () => {
		const key = buildBodyPartKey("cfg1", "acc123", "msg456", "1.2");
		assert.strictEqual(key, "accounts/cfg1/acc123/messages/msg456/parts/1.2");
	});

	test("buildDeduplicatedKey nests accountId under accountConfigId", () => {
		const hash = "abcdef1234567890";
		const key = buildDeduplicatedKey("cfg1", "acc123", hash);
		assert.strictEqual(key, "accounts/cfg1/acc123/dedup/ab/abcdef1234567890");
	});

	test("buildParsedBodyKey nests accountId under accountConfigId", () => {
		const key = buildParsedBodyKey("cfg1", "acc123", "msg456");
		assert.strictEqual(
			key,
			"accounts/cfg1/acc123/messages/msg456/parsed.json.gz",
		);
	});

	test("computeChecksum returns SHA-256 hex", () => {
		const content = Buffer.from("test content");
		const expected = createHash("sha256").update(content).digest("hex");
		assert.strictEqual(computeChecksum(content), expected);
	});

	test("path order is accountConfigId before accountId so /content/accounts/{configId}/* matches at the edge", () => {
		const key = buildMessageBodyKey("CFG", "ACC", "MSG");
		const segments = key.split("/");
		assert.strictEqual(segments[0], "accounts");
		assert.strictEqual(segments[1], "CFG");
		assert.strictEqual(segments[2], "ACC");
	});

	test("buildExtractedTextKey nests accountId under accountConfigId and suffixes .txt.gz", () => {
		const key = buildExtractedTextKey("cfg1", "acc123", "msg456", "1.2");
		assert.strictEqual(
			key,
			"accounts/cfg1/acc123/messages/msg456/extracted/1.2.txt.gz",
		);
	});

	test("buildExtractedSkippedKey nests accountId under accountConfigId and suffixes .skipped.json", () => {
		const key = buildExtractedSkippedKey("cfg1", "acc123", "msg456", "1.2");
		assert.strictEqual(
			key,
			"accounts/cfg1/acc123/messages/msg456/extracted/1.2.skipped.json",
		);
	});

	test("buildExtractedTextKey and buildExtractedSkippedKey share the same prefix", () => {
		const prefix = buildExtractedPrefix("cfg1", "acc123", "msg456");
		assert.strictEqual(
			prefix,
			"accounts/cfg1/acc123/messages/msg456/extracted/",
		);
		assert.ok(
			buildExtractedTextKey("cfg1", "acc123", "msg456", "1").startsWith(prefix),
		);
		assert.ok(
			buildExtractedSkippedKey("cfg1", "acc123", "msg456", "1").startsWith(
				prefix,
			),
		);
	});
});

describe("parseContentStorageKey", () => {
	test("parses accountConfigId/accountId/messageId out of a body key", () => {
		const key = buildMessageBodyKey("cfg1", "acc123", "msg456");
		assert.deepEqual(parseContentStorageKey(key), {
			accountConfigId: "cfg1",
			accountId: "acc123",
			messageId: "msg456",
		});
	});

	test("parses a part key the same way as a body key", () => {
		const key = buildBodyPartKey("cfg1", "acc123", "msg456", "1.2");
		assert.deepEqual(parseContentStorageKey(key), {
			accountConfigId: "cfg1",
			accountId: "acc123",
			messageId: "msg456",
		});
	});

	test("returns null for a key that doesn't match the accounts/.../messages/... layout", () => {
		assert.strictEqual(parseContentStorageKey("nope/whatever"), null);
	});
});

describe("isStorageNotFoundError", () => {
	test("matches S3 NoSuchKey via name", () => {
		assert.equal(
			isStorageNotFoundError(
				Object.assign(new Error("missing"), { name: "NoSuchKey" }),
			),
			true,
		);
	});

	test("matches S3 NoSuchKey via Code", () => {
		assert.equal(
			isStorageNotFoundError({ Code: "NoSuchKey", message: "missing" }),
			true,
		);
	});

	test("matches filesystem ENOENT", () => {
		assert.equal(
			isStorageNotFoundError(
				Object.assign(new Error("nope"), { code: "ENOENT" }),
			),
			true,
		);
	});

	test("does not match generic errors", () => {
		assert.equal(isStorageNotFoundError(new Error("boom")), false);
		assert.equal(isStorageNotFoundError(null), false);
		assert.equal(isStorageNotFoundError("oops"), false);
	});
});

describe("createMockStorageService", () => {
	test("storeMessageBody stores and retrieves content with nested accountConfigId/accountId path", async () => {
		const storage = createMockStorageService();
		const content = Buffer.from("Hello, world!");

		const ref = await storage.storeMessageBody({
			accountConfigId: "cfg1",
			accountId: "acc123",
			messageId: "msg456",
			content,
		});

		assert.strictEqual(
			ref.storageKey,
			"accounts/cfg1/acc123/messages/msg456/body.eml",
		);
		assert.strictEqual(ref.sizeBytes, content.length);
		assert.strictEqual(ref.contentEncoding, ContentEncoding.None);

		const retrieved = await storage.retrieve(ref.uri);
		assert.deepStrictEqual(retrieved, content);
	});

	test("storeBodyPart stores with part path", async () => {
		const storage = createMockStorageService();
		const content = Buffer.from("attachment content");

		const ref = await storage.storeBodyPart({
			accountConfigId: "cfg1",
			accountId: "acc123",
			messageId: "msg456",
			partPath: "1.2",
			content,
		});

		assert.strictEqual(
			ref.storageKey,
			"accounts/cfg1/acc123/messages/msg456/parts/1.2",
		);

		const retrieved = await storage.retrieve(ref.uri);
		assert.deepStrictEqual(retrieved, content);
	});

	test("storeDeduplicated uses content hash", async () => {
		const storage = createMockStorageService();
		const content = Buffer.from("deduplicate me");
		const hash = computeChecksum(content);

		const ref = await storage.storeDeduplicated({
			accountConfigId: "cfg1",
			accountId: "acc123",
			content,
		});

		assert.strictEqual(
			ref.storageKey,
			`accounts/cfg1/acc123/dedup/${hash.slice(0, 2)}/${hash}`,
		);
		assert.strictEqual(ref.checksumSha256, hash);
	});

	test("checks existence", async () => {
		const storage = createMockStorageService();
		const content = Buffer.from("test");

		const ref = await storage.storeMessageBody({
			accountConfigId: "cfg1",
			accountId: "acc123",
			messageId: "msg456",
			content,
		});

		assert.strictEqual(await storage.exists(ref.uri), true);
		assert.strictEqual(await storage.exists("mock://does-not-exist"), false);
	});

	test("deletes content", async () => {
		const storage = createMockStorageService();
		const content = Buffer.from("to delete");

		const ref = await storage.storeMessageBody({
			accountConfigId: "cfg1",
			accountId: "acc123",
			messageId: "msg456",
			content,
		});
		assert.strictEqual(await storage.exists(ref.uri), true);

		await storage.delete(ref.uri);
		assert.strictEqual(await storage.exists(ref.uri), false);
	});

	test("storeParsedBody / retrieveParsedBody round-trip", async () => {
		const storage = createMockStorageService();
		const parsed = {
			text: "hello",
			html: "<p>hello</p>",
			attachments: [
				{
					filename: "a.pdf",
					contentType: "application/pdf",
					contentDisposition: "attachment",
					contentId: null,
					size: 1234,
				},
			],
		};

		const ref = await storage.storeParsedBody({
			accountConfigId: "cfg1",
			accountId: "acc123",
			messageId: "msg456",
			parsed,
		});

		assert.strictEqual(
			ref.storageKey,
			"accounts/cfg1/acc123/messages/msg456/parsed.json.gz",
		);

		const retrieved = await storage.retrieveParsedBody(
			"cfg1",
			"acc123",
			"msg456",
		);
		assert.deepStrictEqual(retrieved, parsed);
	});

	test("retrieveParsedBody returns null on miss", async () => {
		const storage = createMockStorageService();
		const result = await storage.retrieveParsedBody("cfg1", "acc123", "nope");
		assert.strictEqual(result, null);
	});

	test("retrieveBodyPart round-trips stored content and returns null on miss", async () => {
		const storage = createMockStorageService();
		const content = Buffer.from("attachment bytes");

		await storage.storeBodyPart({
			accountConfigId: "cfg1",
			accountId: "acc123",
			messageId: "msg456",
			partPath: "1.2",
			content,
		});

		const retrieved = await storage.retrieveBodyPart(
			"cfg1",
			"acc123",
			"msg456",
			"1.2",
		);
		assert.deepStrictEqual(retrieved, content);

		const miss = await storage.retrieveBodyPart(
			"cfg1",
			"acc123",
			"msg456",
			"9",
		);
		assert.strictEqual(miss, null);
	});

	test("storeExtractedText / retrieveExtractedText round-trip", async () => {
		const storage = createMockStorageService();

		const ref = await storage.storeExtractedText({
			accountConfigId: "cfg1",
			accountId: "acc123",
			messageId: "msg456",
			partPath: "1.2",
			text: "extracted attachment text",
		});

		assert.strictEqual(
			ref.storageKey,
			"accounts/cfg1/acc123/messages/msg456/extracted/1.2.txt.gz",
		);

		const retrieved = await storage.retrieveExtractedText(
			"cfg1",
			"acc123",
			"msg456",
			"1.2",
		);
		assert.strictEqual(retrieved, "extracted attachment text");
	});

	test("retrieveExtractedText returns null on miss", async () => {
		const storage = createMockStorageService();
		const result = await storage.retrieveExtractedText(
			"cfg1",
			"acc123",
			"msg456",
			"nope",
		);
		assert.strictEqual(result, null);
	});

	test("extractedResultExists is true after either the text artifact or the skip marker is stored", async () => {
		const storage = createMockStorageService();

		assert.strictEqual(
			await storage.extractedResultExists("cfg1", "acc123", "msg456", "1"),
			false,
		);

		await storage.storeExtractedText({
			accountConfigId: "cfg1",
			accountId: "acc123",
			messageId: "msg456",
			partPath: "1",
			text: "hi",
		});
		assert.strictEqual(
			await storage.extractedResultExists("cfg1", "acc123", "msg456", "1"),
			true,
		);

		await storage.storeExtractedSkipped({
			accountConfigId: "cfg1",
			accountId: "acc123",
			messageId: "msg456",
			partPath: "2",
			marker: { status: "skipped", reason: "type-not-allowed" },
		});
		assert.strictEqual(
			await storage.extractedResultExists("cfg1", "acc123", "msg456", "2"),
			true,
		);
	});

	test("listExtractedTexts returns only .txt.gz artifacts, not skip markers", async () => {
		const storage = createMockStorageService();

		await storage.storeExtractedText({
			accountConfigId: "cfg1",
			accountId: "acc123",
			messageId: "msg456",
			partPath: "1",
			text: "first",
		});
		await storage.storeExtractedText({
			accountConfigId: "cfg1",
			accountId: "acc123",
			messageId: "msg456",
			partPath: "2.1",
			text: "second",
		});
		await storage.storeExtractedSkipped({
			accountConfigId: "cfg1",
			accountId: "acc123",
			messageId: "msg456",
			partPath: "3",
			marker: { status: "failed", reason: "pdf: corrupt" },
		});
		// A different message must not leak into the list.
		await storage.storeExtractedText({
			accountConfigId: "cfg1",
			accountId: "acc123",
			messageId: "other-msg",
			partPath: "1",
			text: "unrelated",
		});

		const items = await storage.listExtractedTexts("cfg1", "acc123", "msg456");
		assert.deepStrictEqual(items.map((i) => i.partPath).sort(), ["1", "2.1"]);
		for (const item of items) {
			assert.ok(item.key.endsWith(".txt.gz"));
		}
	});
});

describe("createFilesystemStorageService", () => {
	const testBasePath = join(tmpdir(), `remit-storage-test-${Date.now()}`);

	test("storeMessageBody stores and retrieves content", async () => {
		const storage = createFilesystemStorageService(testBasePath);
		const content = Buffer.from("Filesystem test content");

		const ref = await storage.storeMessageBody({
			accountConfigId: "cfg1",
			accountId: "acc123",
			messageId: "msg456",
			content,
		});

		assert.strictEqual(ref.storageType, StorageType.Filesystem);
		assert.strictEqual(ref.storageLocation, testBasePath);
		assert.strictEqual(
			ref.storageKey,
			"accounts/cfg1/acc123/messages/msg456/body.eml",
		);
		assert.ok(ref.uri.startsWith("file://"));

		const retrieved = await storage.retrieve(ref.uri);
		assert.deepStrictEqual(retrieved, content);
	});

	test("storeMessageBodyStream streams content to disk and round-trips via retrieve", async () => {
		const storage = createFilesystemStorageService(testBasePath);
		const content = Buffer.from("streamed filesystem body");

		const ref = await storage.storeMessageBodyStream({
			accountConfigId: "cfg1",
			accountId: "acc123",
			messageId: "msg-stream",
			content: Readable.from(content),
		});

		assert.strictEqual(ref.storageType, StorageType.Filesystem);
		assert.strictEqual(ref.contentEncoding, ContentEncoding.Gzip);
		assert.strictEqual(ref.checksumSha256, computeChecksum(content));

		const retrieved = await storage.retrieve(ref.uri);
		assert.deepStrictEqual(retrieved, content);
	});

	test("storeBodyPart stores with part path", async () => {
		const storage = createFilesystemStorageService(testBasePath);
		const content = Buffer.from("attachment content");

		const ref = await storage.storeBodyPart({
			accountConfigId: "cfg1",
			accountId: "acc123",
			messageId: "msg456",
			partPath: "1.2",
			content,
		});

		assert.strictEqual(
			ref.storageKey,
			"accounts/cfg1/acc123/messages/msg456/parts/1.2",
		);

		const retrieved = await storage.retrieve(ref.uri);
		assert.deepStrictEqual(retrieved, content);
	});

	test("storeDeduplicated uses content hash", async () => {
		const storage = createFilesystemStorageService(testBasePath);
		const content = Buffer.from("dedupe fs content");
		const hash = computeChecksum(content);

		const ref = await storage.storeDeduplicated({
			accountConfigId: "cfg1",
			accountId: "acc123",
			content,
		});

		assert.strictEqual(
			ref.storageKey,
			`accounts/cfg1/acc123/dedup/${hash.slice(0, 2)}/${hash}`,
		);
		assert.strictEqual(ref.checksumSha256, hash);

		const retrieved = await storage.retrieve(ref.uri);
		assert.deepStrictEqual(retrieved, content);
	});

	test("checks existence", async () => {
		const storage = createFilesystemStorageService(testBasePath);
		const content = Buffer.from("exists test");

		const ref = await storage.storeMessageBody({
			accountConfigId: "cfg1",
			accountId: "acc123",
			messageId: "msg789",
			content,
		});

		assert.strictEqual(await storage.exists(ref.uri), true);
		assert.strictEqual(await storage.exists("file:///nonexistent/path"), false);
	});

	test("deletes content", async () => {
		const storage = createFilesystemStorageService(testBasePath);
		const content = Buffer.from("to be deleted");

		const ref = await storage.storeMessageBody({
			accountConfigId: "cfg1",
			accountId: "acc123",
			messageId: "msg-delete",
			content,
		});
		assert.strictEqual(await storage.exists(ref.uri), true);

		await storage.delete(ref.uri);
		assert.strictEqual(await storage.exists(ref.uri), false);
	});

	test("storeParsedBody / retrieveParsedBody round-trip with gzip", async () => {
		const storage = createFilesystemStorageService(testBasePath);
		const parsed = {
			text: "hello fs",
			html: "<p>hello fs</p>",
			attachments: [],
		};

		const ref = await storage.storeParsedBody({
			accountConfigId: "cfg1",
			accountId: "acc123",
			messageId: "msg-parsed",
			parsed,
		});

		assert.strictEqual(
			ref.storageKey,
			"accounts/cfg1/acc123/messages/msg-parsed/parsed.json.gz",
		);

		const retrieved = await storage.retrieveParsedBody(
			"cfg1",
			"acc123",
			"msg-parsed",
		);
		assert.deepStrictEqual(retrieved, parsed);
	});

	test("retrieveParsedBody returns null on miss (ENOENT)", async () => {
		const storage = createFilesystemStorageService(testBasePath);
		const result = await storage.retrieveParsedBody(
			"cfg1",
			"acc123",
			"missing",
		);
		assert.strictEqual(result, null);
	});

	test("retrieveBodyPart round-trips gzipped content and returns null on miss (ENOENT)", async () => {
		const storage = createFilesystemStorageService(testBasePath);
		const content = Buffer.from("fs attachment bytes");

		await storage.storeBodyPart({
			accountConfigId: "cfg1",
			accountId: "acc123",
			messageId: "msg-part-fs",
			partPath: "1.2",
			content,
		});

		const retrieved = await storage.retrieveBodyPart(
			"cfg1",
			"acc123",
			"msg-part-fs",
			"1.2",
		);
		assert.deepStrictEqual(retrieved, content);

		const miss = await storage.retrieveBodyPart(
			"cfg1",
			"acc123",
			"msg-part-fs",
			"nope",
		);
		assert.strictEqual(miss, null);
	});

	test("storeExtractedText / retrieveExtractedText round-trip with gzip", async () => {
		const storage = createFilesystemStorageService(testBasePath);

		const ref = await storage.storeExtractedText({
			accountConfigId: "cfg1",
			accountId: "acc123",
			messageId: "msg-extracted-fs",
			partPath: "1",
			text: "fs extracted text",
		});

		assert.strictEqual(
			ref.storageKey,
			"accounts/cfg1/acc123/messages/msg-extracted-fs/extracted/1.txt.gz",
		);
		assert.strictEqual(ref.contentEncoding, ContentEncoding.Gzip);

		const retrieved = await storage.retrieveExtractedText(
			"cfg1",
			"acc123",
			"msg-extracted-fs",
			"1",
		);
		assert.strictEqual(retrieved, "fs extracted text");
	});

	test("storeExtractedSkipped writes an uncompressed JSON marker that satisfies extractedResultExists", async () => {
		const storage = createFilesystemStorageService(testBasePath);

		assert.strictEqual(
			await storage.extractedResultExists("cfg1", "acc123", "msg-skip-fs", "1"),
			false,
		);

		const ref = await storage.storeExtractedSkipped({
			accountConfigId: "cfg1",
			accountId: "acc123",
			messageId: "msg-skip-fs",
			partPath: "1",
			marker: { status: "skipped", reason: "too-large" },
		});

		assert.strictEqual(
			ref.storageKey,
			"accounts/cfg1/acc123/messages/msg-skip-fs/extracted/1.skipped.json",
		);
		assert.strictEqual(ref.contentEncoding, ContentEncoding.None);
		assert.strictEqual(
			await storage.extractedResultExists("cfg1", "acc123", "msg-skip-fs", "1"),
			true,
		);
	});

	test("listExtractedTexts lists only .txt.gz artifacts for the given message", async () => {
		const storage = createFilesystemStorageService(testBasePath);

		await storage.storeExtractedText({
			accountConfigId: "cfg1",
			accountId: "acc123",
			messageId: "msg-list-fs",
			partPath: "1",
			text: "one",
		});
		await storage.storeExtractedText({
			accountConfigId: "cfg1",
			accountId: "acc123",
			messageId: "msg-list-fs",
			partPath: "2.1",
			text: "two",
		});
		await storage.storeExtractedSkipped({
			accountConfigId: "cfg1",
			accountId: "acc123",
			messageId: "msg-list-fs",
			partPath: "3",
			marker: { status: "failed", reason: "doc: corrupt" },
		});

		const items = await storage.listExtractedTexts(
			"cfg1",
			"acc123",
			"msg-list-fs",
		);
		assert.deepStrictEqual(items.map((i) => i.partPath).sort(), ["1", "2.1"]);
	});

	test("listExtractedTexts returns an empty array when no extraction has happened yet", async () => {
		const storage = createFilesystemStorageService(testBasePath);
		const items = await storage.listExtractedTexts(
			"cfg1",
			"acc123",
			"msg-never-scanned",
		);
		assert.deepStrictEqual(items, []);
	});

	test("cleanup test directory", async () => {
		await rm(testBasePath, { recursive: true, force: true });
	});
});
