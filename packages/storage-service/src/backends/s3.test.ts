import assert from "node:assert";
import { Readable } from "node:stream";
import { describe, test } from "node:test";
import { gunzipSync } from "node:zlib";
import {
	GetObjectCommand,
	HeadObjectCommand,
	ListObjectsV2Command,
	PutObjectCommand,
	S3Client,
} from "@aws-sdk/client-s3";
import { ContentEncoding, StorageType } from "@remit/domain-enums";
import { mockClient } from "aws-sdk-client-mock";
import { computeChecksum } from "../storage.js";
import { createS3StorageService } from "./s3.js";

interface CapturedCommand {
	name: string;
	input: Record<string, unknown>;
}

const createFakeS3Client = (): {
	client: S3Client;
	commands: CapturedCommand[];
	stored: Map<string, { body: Buffer; contentEncoding?: string }>;
} => {
	const commands: CapturedCommand[] = [];
	const stored = new Map<string, { body: Buffer; contentEncoding?: string }>();

	const send = async (command: unknown): Promise<unknown> => {
		if (command instanceof PutObjectCommand) {
			const input = command.input as unknown as Record<string, unknown>;
			commands.push({ name: "PutObjectCommand", input });

			if (input.ChecksumSHA256 !== undefined) {
				throw Object.assign(
					new Error(
						"BadDigest: The SHA256 you specified did not match the calculated checksum.",
					),
					{ name: "BadDigest" },
				);
			}

			const key = String(input.Key);
			const body = input.Body;
			if (!Buffer.isBuffer(body)) {
				throw new Error("expected Body to be a Buffer");
			}
			stored.set(key, {
				body,
				contentEncoding:
					typeof input.ContentEncoding === "string"
						? input.ContentEncoding
						: undefined,
			});
			return {};
		}

		if (command instanceof GetObjectCommand) {
			const input = command.input as unknown as Record<string, unknown>;
			const key = String(input.Key);
			const entry = stored.get(key);
			if (!entry) {
				throw Object.assign(new Error(`not found: ${key}`), {
					name: "NoSuchKey",
				});
			}
			return {
				Body: {
					transformToByteArray: async () => new Uint8Array(entry.body),
				},
				ContentEncoding: entry.contentEncoding,
			};
		}

		if (command instanceof HeadObjectCommand) {
			const input = command.input as unknown as Record<string, unknown>;
			const key = String(input.Key);
			if (!stored.has(key)) {
				throw Object.assign(new Error(`not found: ${key}`), {
					name: "NotFound",
				});
			}
			return {};
		}

		if (command instanceof ListObjectsV2Command) {
			const input = command.input as unknown as Record<string, unknown>;
			const prefix = String(input.Prefix ?? "");
			const Contents = [...stored.keys()]
				.filter((key) => key.startsWith(prefix))
				.map((Key) => ({ Key }));
			return { Contents, IsTruncated: false };
		}

		throw new Error(`unexpected command: ${String(command)}`);
	};

	return {
		client: { send } as unknown as S3Client,
		commands,
		stored,
	};
};

describe("createS3StorageService", () => {
	test("storeMessageBody sends gzipped body keyed under accounts/{configId}/{accountId}/...", async () => {
		const { client, commands, stored } = createFakeS3Client();
		const storage = createS3StorageService(client, "bucket");
		const content = Buffer.from("Hello, world! This is a message body.");

		const ref = await storage.storeMessageBody({
			accountConfigId: "cfg1",
			accountId: "acc123",
			messageId: "msg456",
			content,
		});

		assert.strictEqual(commands.length, 1);
		const put = commands[0];
		assert.strictEqual(put.name, "PutObjectCommand");
		assert.strictEqual(put.input.ChecksumSHA256, undefined);
		assert.strictEqual(put.input.ContentEncoding, "gzip");

		const entry = stored.get("accounts/cfg1/acc123/messages/msg456/body.eml");
		assert.ok(entry, "object should be stored");
		assert.deepStrictEqual(gunzipSync(entry.body), content);

		assert.strictEqual(ref.storageType, StorageType.S3);
		assert.strictEqual(ref.contentEncoding, ContentEncoding.Gzip);
		assert.strictEqual(ref.checksumSha256, computeChecksum(content));
		assert.strictEqual(ref.sizeBytes, entry.body.length);
	});

	test("storeMessageBodyStream streams a gzipped body to S3 with the pre-gzip checksum", async () => {
		// lib-storage's Upload needs a real S3Client surface (config, request
		// handler), so mock the client rather than hand-rolling a `send` stub.
		const s3Mock = mockClient(S3Client);
		const captured: Buffer[] = [];
		s3Mock.on(PutObjectCommand).callsFake((input) => {
			const body = input.Body;
			captured.push(Buffer.isBuffer(body) ? body : Buffer.from(body));
			assert.strictEqual(input.ContentEncoding, "gzip");
			assert.strictEqual(input.ContentType, "message/rfc822");
			return {};
		});

		const storage = createS3StorageService(
			new S3Client({ region: "us-east-1" }),
			"bucket",
		);
		const content = Buffer.from("streamed message body bytes");

		const ref = await storage.storeMessageBodyStream({
			accountConfigId: "cfg1",
			accountId: "acc123",
			messageId: "msg-stream",
			content: Readable.from(content),
		});

		// One PutObject, gzipped, decoding back to the original bytes — proves the
		// stream was uploaded, not silently dropped.
		assert.strictEqual(captured.length, 1);
		assert.deepStrictEqual(gunzipSync(captured[0]), content);

		assert.strictEqual(ref.storageType, StorageType.S3);
		assert.strictEqual(ref.contentEncoding, ContentEncoding.Gzip);
		// Checksum is over the logical pre-gzip content, matching storeMessageBody.
		assert.strictEqual(ref.checksumSha256, computeChecksum(content));
		assert.strictEqual(ref.sizeBytes, captured[0].length);

		s3Mock.restore();
	});

	test("storeDeduplicated places object at content-hash key based on pre-gzip checksum", async () => {
		const { client, stored } = createFakeS3Client();
		const storage = createS3StorageService(client, "bucket");
		const content = Buffer.from("dedupable content");
		const hash = computeChecksum(content);

		const ref = await storage.storeDeduplicated({
			accountConfigId: "cfg1",
			accountId: "acc123",
			content,
		});

		const expectedKey = `accounts/cfg1/acc123/dedup/${hash.slice(0, 2)}/${hash}`;
		assert.strictEqual(ref.storageKey, expectedKey);
		assert.strictEqual(ref.checksumSha256, hash);

		const entry = stored.get(expectedKey);
		assert.ok(entry, "dedup object should be stored");
		assert.deepStrictEqual(gunzipSync(entry.body), content);
	});

	test("round-trips content through retrieve with gzip decoding", async () => {
		const { client } = createFakeS3Client();
		const storage = createS3StorageService(client, "bucket");
		const content = Buffer.from("round trip payload");

		const ref = await storage.storeMessageBody({
			accountConfigId: "cfg1",
			accountId: "acc123",
			messageId: "msg789",
			content,
		});

		const retrieved = await storage.retrieve(ref.uri);
		assert.deepStrictEqual(retrieved, content);
	});

	test("storeParsedBody writes gzipped JSON keyed under accounts/{configId}/{accountId}/...", async () => {
		const { client, commands, stored } = createFakeS3Client();
		const storage = createS3StorageService(client, "bucket");
		const parsed = {
			text: "hi",
			html: "<p>hi</p>",
			attachments: [
				{
					filename: "a.txt",
					contentType: "text/plain",
					contentDisposition: "attachment",
					contentId: null,
					size: 12,
				},
			],
		};

		const ref = await storage.storeParsedBody({
			accountConfigId: "cfg-x",
			accountId: "acc-x",
			messageId: "msg-x",
			parsed,
		});

		assert.strictEqual(commands.length, 1);
		const put = commands[0];
		assert.strictEqual(put.input.ChecksumSHA256, undefined);
		assert.strictEqual(put.input.ContentEncoding, "gzip");
		assert.strictEqual(put.input.ContentType, "application/json");
		assert.strictEqual(
			put.input.Key,
			"accounts/cfg-x/acc-x/messages/msg-x/parsed.json.gz",
		);

		const entry = stored.get(
			"accounts/cfg-x/acc-x/messages/msg-x/parsed.json.gz",
		);
		assert.ok(entry, "parsed body should be stored");
		assert.deepStrictEqual(
			JSON.parse(gunzipSync(entry.body).toString("utf8")),
			parsed,
		);
		assert.strictEqual(ref.storageType, StorageType.S3);
	});

	test("retrieveParsedBody returns parsed JSON on hit and null on miss", async () => {
		const { client } = createFakeS3Client();
		const storage = createS3StorageService(client, "bucket");
		const parsed = {
			text: "hello",
			html: null,
			attachments: [],
		};

		await storage.storeParsedBody({
			accountConfigId: "cfg-r",
			accountId: "acc-r",
			messageId: "msg-r",
			parsed,
		});

		const hit = await storage.retrieveParsedBody("cfg-r", "acc-r", "msg-r");
		assert.deepStrictEqual(hit, parsed);

		const miss = await storage.retrieveParsedBody("cfg-r", "acc-r", "nope");
		assert.strictEqual(miss, null);
	});

	test("retrieveBodyPart round-trips gzipped content and returns null on miss", async () => {
		const { client } = createFakeS3Client();
		const storage = createS3StorageService(client, "bucket");
		const content = Buffer.from("attachment bytes");

		await storage.storeBodyPart({
			accountConfigId: "cfg-p",
			accountId: "acc-p",
			messageId: "msg-p",
			partPath: "1.2",
			content,
		});

		const retrieved = await storage.retrieveBodyPart(
			"cfg-p",
			"acc-p",
			"msg-p",
			"1.2",
		);
		assert.deepStrictEqual(retrieved, content);

		const miss = await storage.retrieveBodyPart(
			"cfg-p",
			"acc-p",
			"msg-p",
			"nope",
		);
		assert.strictEqual(miss, null);
	});

	test("storeExtractedText writes gzipped text keyed under .../extracted/{partPath}.txt.gz and round-trips", async () => {
		const { client, commands, stored } = createFakeS3Client();
		const storage = createS3StorageService(client, "bucket");

		const ref = await storage.storeExtractedText({
			accountConfigId: "cfg-x",
			accountId: "acc-x",
			messageId: "msg-x",
			partPath: "1.2",
			text: "extracted attachment text",
		});

		assert.strictEqual(
			ref.storageKey,
			"accounts/cfg-x/acc-x/messages/msg-x/extracted/1.2.txt.gz",
		);
		const put = commands.find((c) => c.name === "PutObjectCommand");
		assert.strictEqual(put?.input.ContentEncoding, "gzip");
		assert.strictEqual(put?.input.ContentType, "text/plain; charset=utf-8");

		const entry = stored.get(
			"accounts/cfg-x/acc-x/messages/msg-x/extracted/1.2.txt.gz",
		);
		assert.ok(entry);
		assert.strictEqual(
			gunzipSync(entry.body).toString("utf8"),
			"extracted attachment text",
		);

		const retrieved = await storage.retrieveExtractedText(
			"cfg-x",
			"acc-x",
			"msg-x",
			"1.2",
		);
		assert.strictEqual(retrieved, "extracted attachment text");
	});

	test("retrieveExtractedText returns null on miss", async () => {
		const { client } = createFakeS3Client();
		const storage = createS3StorageService(client, "bucket");
		const result = await storage.retrieveExtractedText(
			"cfg-x",
			"acc-x",
			"msg-x",
			"nope",
		);
		assert.strictEqual(result, null);
	});

	test("storeExtractedSkipped writes an uncompressed JSON marker keyed under .../extracted/{partPath}.skipped.json", async () => {
		const { client, commands, stored } = createFakeS3Client();
		const storage = createS3StorageService(client, "bucket");

		const ref = await storage.storeExtractedSkipped({
			accountConfigId: "cfg-s",
			accountId: "acc-s",
			messageId: "msg-s",
			partPath: "3",
			marker: { status: "failed", reason: "pdf: corrupt" },
		});

		assert.strictEqual(
			ref.storageKey,
			"accounts/cfg-s/acc-s/messages/msg-s/extracted/3.skipped.json",
		);
		const put = commands.find((c) => c.name === "PutObjectCommand");
		assert.strictEqual(put?.input.ContentEncoding, undefined);
		assert.strictEqual(put?.input.ContentType, "application/json");

		const entry = stored.get(
			"accounts/cfg-s/acc-s/messages/msg-s/extracted/3.skipped.json",
		);
		assert.ok(entry);
		assert.deepStrictEqual(JSON.parse(entry.body.toString("utf8")), {
			status: "failed",
			reason: "pdf: corrupt",
		});
	});

	test("extractedResultExists is true once either the text artifact or the skip marker is stored", async () => {
		const { client } = createFakeS3Client();
		const storage = createS3StorageService(client, "bucket");

		assert.strictEqual(
			await storage.extractedResultExists("cfg-e", "acc-e", "msg-e", "1"),
			false,
		);

		await storage.storeExtractedText({
			accountConfigId: "cfg-e",
			accountId: "acc-e",
			messageId: "msg-e",
			partPath: "1",
			text: "hi",
		});
		assert.strictEqual(
			await storage.extractedResultExists("cfg-e", "acc-e", "msg-e", "1"),
			true,
		);

		await storage.storeExtractedSkipped({
			accountConfigId: "cfg-e",
			accountId: "acc-e",
			messageId: "msg-e",
			partPath: "2",
			marker: { status: "skipped", reason: "too-large" },
		});
		assert.strictEqual(
			await storage.extractedResultExists("cfg-e", "acc-e", "msg-e", "2"),
			true,
		);
	});

	test("listExtractedTexts returns only .txt.gz artifacts for the given message, excluding skip markers and other messages", async () => {
		const { client } = createFakeS3Client();
		const storage = createS3StorageService(client, "bucket");

		await storage.storeExtractedText({
			accountConfigId: "cfg-l",
			accountId: "acc-l",
			messageId: "msg-l",
			partPath: "1",
			text: "one",
		});
		await storage.storeExtractedText({
			accountConfigId: "cfg-l",
			accountId: "acc-l",
			messageId: "msg-l",
			partPath: "2.1",
			text: "two",
		});
		await storage.storeExtractedSkipped({
			accountConfigId: "cfg-l",
			accountId: "acc-l",
			messageId: "msg-l",
			partPath: "3",
			marker: { status: "failed", reason: "doc: corrupt" },
		});
		await storage.storeExtractedText({
			accountConfigId: "cfg-l",
			accountId: "acc-l",
			messageId: "other-msg",
			partPath: "1",
			text: "unrelated",
		});

		const items = await storage.listExtractedTexts("cfg-l", "acc-l", "msg-l");
		assert.deepStrictEqual(items.map((i) => i.partPath).sort(), ["1", "2.1"]);
		for (const item of items) {
			assert.ok(item.key.endsWith(".txt.gz"));
		}
	});
});
