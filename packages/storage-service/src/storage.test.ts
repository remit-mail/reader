import assert from "node:assert";
import { createHash } from "node:crypto";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, test } from "node:test";
import { ContentEncoding, StorageType } from "@remit/domain-enums";
import { createFilesystemStorageService } from "./backends/filesystem.js";
import { createMockStorageService } from "./storage.js";
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
		assert.throws(() => parseStorageUri("http://example.com/file"), /Unsupported storage URI scheme/);
	});
});

describe("buildStorageUri", () => {
	test("builds S3 URIs", () => {
		const uri = buildStorageUri(StorageType.S3, "my-bucket", "path/to/object");
		assert.strictEqual(uri, "s3://my-bucket/path/to/object");
	});

	test("builds file URIs", () => {
		const uri = buildStorageUri(StorageType.Filesystem, "/var/data", "path/to/file");
		assert.strictEqual(uri, "file:///var/data/path/to/file");
	});
});

describe("createMockStorageService", () => {
	test("stores and retrieves content", async () => {
		const storage = createMockStorageService();
		const content = Buffer.from("Hello, world!");

		const ref = await storage.store(content, { key: "test/file.txt" });

		assert.strictEqual(ref.storageKey, "test/file.txt");
		assert.strictEqual(ref.sizeBytes, content.length);
		assert.strictEqual(ref.contentEncoding, ContentEncoding.None);

		const retrieved = await storage.retrieve(ref.uri);
		assert.deepStrictEqual(retrieved, content);
	});

	test("checks existence", async () => {
		const storage = createMockStorageService();
		const content = Buffer.from("test");

		const ref = await storage.store(content, { key: "exists.txt" });

		assert.strictEqual(await storage.exists(ref.uri), true);
		assert.strictEqual(await storage.exists("mock://does-not-exist"), false);
	});

	test("deletes content", async () => {
		const storage = createMockStorageService();
		const content = Buffer.from("to delete");

		const ref = await storage.store(content, { key: "delete.txt" });
		assert.strictEqual(await storage.exists(ref.uri), true);

		await storage.delete(ref.uri);
		assert.strictEqual(await storage.exists(ref.uri), false);
	});

	test("generates content-addressable keys", async () => {
		const storage = createMockStorageService();
		const content = Buffer.from("deduplicate me");
		const hash = createHash("sha256").update(content).digest("hex");

		const ref = await storage.store(content, {
			key: "ignored",
			contentAddressable: true,
		});

		assert.strictEqual(ref.storageKey, `dedup/${hash.slice(0, 2)}/${hash}`);
		assert.strictEqual(ref.checksumSha256, hash);
	});

	test("contentAddressableKey returns correct format", () => {
		const storage = createMockStorageService();
		const content = Buffer.from("test content");
		const hash = createHash("sha256").update(content).digest("hex");

		const key = storage.contentAddressableKey(content);
		assert.strictEqual(key, `dedup/${hash.slice(0, 2)}/${hash}`);

		const customKey = storage.contentAddressableKey(content, "attachments");
		assert.strictEqual(customKey, `attachments/${hash.slice(0, 2)}/${hash}`);
	});
});

describe("createFilesystemStorageService", () => {
	const testBasePath = join(tmpdir(), `remit-storage-test-${Date.now()}`);

	test("stores and retrieves content", async () => {
		const storage = createFilesystemStorageService(testBasePath);
		const content = Buffer.from("Filesystem test content");

		const ref = await storage.store(content, { key: "test/fs-file.txt" });

		assert.strictEqual(ref.storageType, StorageType.Filesystem);
		assert.strictEqual(ref.storageLocation, testBasePath);
		assert.strictEqual(ref.storageKey, "test/fs-file.txt");
		assert.ok(ref.uri.startsWith("file://"));

		const retrieved = await storage.retrieve(ref.uri);
		assert.deepStrictEqual(retrieved, content);
	});

	test("stores and retrieves gzipped content", async () => {
		const storage = createFilesystemStorageService(testBasePath);
		const content = Buffer.from("Compressed content for testing");

		const ref = await storage.store(content, {
			key: "test/compressed.txt",
			contentEncoding: ContentEncoding.Gzip,
		});

		assert.strictEqual(ref.contentEncoding, ContentEncoding.Gzip);
		assert.ok(ref.sizeBytes < content.length || ref.sizeBytes > 0);

		const retrieved = await storage.retrieve(ref.uri);
		assert.deepStrictEqual(retrieved, content);
	});

	test("checks existence", async () => {
		const storage = createFilesystemStorageService(testBasePath);
		const content = Buffer.from("exists test");

		const ref = await storage.store(content, { key: "test/exists-fs.txt" });

		assert.strictEqual(await storage.exists(ref.uri), true);
		assert.strictEqual(await storage.exists("file:///nonexistent/path"), false);
	});

	test("deletes content", async () => {
		const storage = createFilesystemStorageService(testBasePath);
		const content = Buffer.from("to be deleted");

		const ref = await storage.store(content, { key: "test/delete-fs.txt" });
		assert.strictEqual(await storage.exists(ref.uri), true);

		await storage.delete(ref.uri);
		assert.strictEqual(await storage.exists(ref.uri), false);
	});

	test("content-addressable storage", async () => {
		const storage = createFilesystemStorageService(testBasePath);
		const content = Buffer.from("dedupe fs content");
		const hash = createHash("sha256").update(content).digest("hex");

		const ref = await storage.store(content, {
			key: "ignored",
			contentAddressable: true,
		});

		assert.strictEqual(ref.storageKey, `dedup/${hash.slice(0, 2)}/${hash}`);
		assert.strictEqual(ref.checksumSha256, hash);

		const retrieved = await storage.retrieve(ref.uri);
		assert.deepStrictEqual(retrieved, content);
	});

	test("cleanup test directory", async () => {
		await rm(testBasePath, { recursive: true, force: true });
	});
});
