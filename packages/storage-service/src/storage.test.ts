import assert from "node:assert";
import { createHash } from "node:crypto";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, test } from "node:test";
import { ContentEncoding, StorageType } from "@remit/domain-enums";
import { createFilesystemStorageService } from "./backends/filesystem.js";
import {
	buildBodyPartKey,
	buildDeduplicatedKey,
	buildMessageBodyKey,
	computeChecksum,
	createMockStorageService,
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
	test("buildMessageBodyKey formats correctly", () => {
		const key = buildMessageBodyKey("acc123", "msg456");
		assert.strictEqual(key, "accounts/acc123/messages/msg456/body.eml");
	});

	test("buildBodyPartKey formats correctly", () => {
		const key = buildBodyPartKey("acc123", "msg456", "1.2");
		assert.strictEqual(key, "accounts/acc123/messages/msg456/parts/1.2");
	});

	test("buildDeduplicatedKey formats correctly", () => {
		const hash = "abcdef1234567890";
		const key = buildDeduplicatedKey("acc123", hash);
		assert.strictEqual(key, "accounts/acc123/dedup/ab/abcdef1234567890");
	});

	test("computeChecksum returns SHA-256 hex", () => {
		const content = Buffer.from("test content");
		const expected = createHash("sha256").update(content).digest("hex");
		assert.strictEqual(computeChecksum(content), expected);
	});
});

describe("createMockStorageService", () => {
	test("storeMessageBody stores and retrieves content", async () => {
		const storage = createMockStorageService();
		const content = Buffer.from("Hello, world!");

		const ref = await storage.storeMessageBody({
			accountId: "acc123",
			messageId: "msg456",
			content,
		});

		assert.strictEqual(
			ref.storageKey,
			"accounts/acc123/messages/msg456/body.eml",
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
			accountId: "acc123",
			messageId: "msg456",
			partPath: "1.2",
			content,
		});

		assert.strictEqual(
			ref.storageKey,
			"accounts/acc123/messages/msg456/parts/1.2",
		);

		const retrieved = await storage.retrieve(ref.uri);
		assert.deepStrictEqual(retrieved, content);
	});

	test("storeDeduplicated uses content hash", async () => {
		const storage = createMockStorageService();
		const content = Buffer.from("deduplicate me");
		const hash = computeChecksum(content);

		const ref = await storage.storeDeduplicated({
			accountId: "acc123",
			content,
		});

		assert.strictEqual(
			ref.storageKey,
			`accounts/acc123/dedup/${hash.slice(0, 2)}/${hash}`,
		);
		assert.strictEqual(ref.checksumSha256, hash);
	});

	test("checks existence", async () => {
		const storage = createMockStorageService();
		const content = Buffer.from("test");

		const ref = await storage.storeMessageBody({
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
			accountId: "acc123",
			messageId: "msg456",
			content,
		});
		assert.strictEqual(await storage.exists(ref.uri), true);

		await storage.delete(ref.uri);
		assert.strictEqual(await storage.exists(ref.uri), false);
	});
});

describe("createFilesystemStorageService", () => {
	const testBasePath = join(tmpdir(), `remit-storage-test-${Date.now()}`);

	test("storeMessageBody stores and retrieves content", async () => {
		const storage = createFilesystemStorageService(testBasePath);
		const content = Buffer.from("Filesystem test content");

		const ref = await storage.storeMessageBody({
			accountId: "acc123",
			messageId: "msg456",
			content,
		});

		assert.strictEqual(ref.storageType, StorageType.Filesystem);
		assert.strictEqual(ref.storageLocation, testBasePath);
		assert.strictEqual(
			ref.storageKey,
			"accounts/acc123/messages/msg456/body.eml",
		);
		assert.ok(ref.uri.startsWith("file://"));

		const retrieved = await storage.retrieve(ref.uri);
		assert.deepStrictEqual(retrieved, content);
	});

	test("storeBodyPart stores with part path", async () => {
		const storage = createFilesystemStorageService(testBasePath);
		const content = Buffer.from("attachment content");

		const ref = await storage.storeBodyPart({
			accountId: "acc123",
			messageId: "msg456",
			partPath: "1.2",
			content,
		});

		assert.strictEqual(
			ref.storageKey,
			"accounts/acc123/messages/msg456/parts/1.2",
		);

		const retrieved = await storage.retrieve(ref.uri);
		assert.deepStrictEqual(retrieved, content);
	});

	test("storeDeduplicated uses content hash", async () => {
		const storage = createFilesystemStorageService(testBasePath);
		const content = Buffer.from("dedupe fs content");
		const hash = computeChecksum(content);

		const ref = await storage.storeDeduplicated({
			accountId: "acc123",
			content,
		});

		assert.strictEqual(
			ref.storageKey,
			`accounts/acc123/dedup/${hash.slice(0, 2)}/${hash}`,
		);
		assert.strictEqual(ref.checksumSha256, hash);

		const retrieved = await storage.retrieve(ref.uri);
		assert.deepStrictEqual(retrieved, content);
	});

	test("checks existence", async () => {
		const storage = createFilesystemStorageService(testBasePath);
		const content = Buffer.from("exists test");

		const ref = await storage.storeMessageBody({
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
			accountId: "acc123",
			messageId: "msg-delete",
			content,
		});
		assert.strictEqual(await storage.exists(ref.uri), true);

		await storage.delete(ref.uri);
		assert.strictEqual(await storage.exists(ref.uri), false);
	});

	test("cleanup test directory", async () => {
		await rm(testBasePath, { recursive: true, force: true });
	});
});
