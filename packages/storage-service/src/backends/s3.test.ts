import assert from "node:assert";
import { describe, test } from "node:test";
import { gunzipSync } from "node:zlib";
import {
	DeleteObjectCommand,
	DeleteObjectsCommand,
	GetObjectCommand,
	HeadObjectCommand,
	ListObjectsV2Command,
	PutObjectCommand,
	type S3Client,
} from "@aws-sdk/client-s3";
import { ContentEncoding, StorageType } from "@remit/domain-enums";
import { computeChecksum } from "../storage.js";
import { createS3StorageService } from "./s3.js";

interface CapturedCommand {
	name: string;
	input: Record<string, unknown>;
}

const createFakeS3Client = (): {
	client: S3Client;
	commands: CapturedCommand[];
	stored: Map<string, { body: Buffer; etag: string; contentEncoding?: string }>;
} => {
	const commands: CapturedCommand[] = [];
	const stored = new Map<
		string,
		{ body: Buffer; etag: string; contentEncoding?: string }
	>();
	let etagCounter = 0;

	const send = async (command: unknown): Promise<unknown> => {
		if (command instanceof PutObjectCommand) {
			const input = command.input as unknown as Record<string, unknown>;
			commands.push({ name: "PutObjectCommand", input });

			// S3's conditional write, which is what the ledger's compare-and-set
			// rides on: If-None-Match refuses an overwrite, If-Match refuses a
			// stale one. Both answer 412.
			const existing = stored.get(String(input.Key));
			const precondition =
				(input.IfNoneMatch === "*" && existing !== undefined) ||
				(typeof input.IfMatch === "string" && input.IfMatch !== existing?.etag);
			if (precondition) {
				throw Object.assign(new Error("PreconditionFailed"), {
					name: "PreconditionFailed",
					$metadata: { httpStatusCode: 412 },
				});
			}

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
			etagCounter += 1;
			stored.set(key, {
				body,
				etag: `"etag-${etagCounter}"`,
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
				ETag: entry.etag,
			};
		}

		if (command instanceof HeadObjectCommand) {
			const input = command.input as unknown as Record<string, unknown>;
			const key = String(input.Key);
			const entry = stored.get(key);
			if (!entry) {
				throw Object.assign(new Error(`not found: ${key}`), {
					name: "NotFound",
				});
			}
			return { ContentLength: entry.body.length };
		}

		if (command instanceof DeleteObjectCommand) {
			const input = command.input as unknown as Record<string, unknown>;
			commands.push({ name: "DeleteObjectCommand", input });
			stored.delete(String(input.Key));
			return {};
		}

		if (command instanceof DeleteObjectsCommand) {
			const input = command.input as unknown as Record<string, unknown>;
			commands.push({ name: "DeleteObjectsCommand", input });
			const del = input.Delete as { Objects: { Key: string }[] };
			for (const { Key } of del.Objects) stored.delete(Key);
			return {};
		}

		if (command instanceof ListObjectsV2Command) {
			const input = command.input as unknown as Record<string, unknown>;
			const prefix = String(input.Prefix ?? "");
			const maxKeys = Number(input.MaxKeys ?? Number.POSITIVE_INFINITY);
			const matching = [...stored.entries()].filter(([key]) =>
				key.startsWith(prefix),
			);

			// A delimited listing answers with directory-like prefixes instead of
			// the objects beneath them, the way listOutboxDraftsWithAttachments
			// asks for them.
			if (typeof input.Delimiter === "string") {
				const delimiter = input.Delimiter;
				const prefixes = new Set<string>();
				for (const [key] of matching) {
					const rest = key.slice(prefix.length);
					const at = rest.indexOf(delimiter);
					if (at >= 0) prefixes.add(prefix + rest.slice(0, at + 1));
				}
				return {
					CommonPrefixes: [...prefixes].map((Prefix) => ({ Prefix })),
					IsTruncated: false,
				};
			}

			const Contents = matching
				.slice(0, maxKeys)
				.map(([Key, entry]) => ({ Key, Size: entry.body.length }));
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
});

describe("createS3StorageService: outbox attachments", () => {
	test("an uploaded object lists at the size the bucket holds", async () => {
		const { client } = createFakeS3Client();
		const storage = createS3StorageService(client, "bucket");

		await storage.storeOutboxAttachment({
			accountConfigId: "cfg1",
			accountId: "acc1",
			outboxMessageId: "draft1",
			outboxAttachmentId: "att1",
			content: Buffer.alloc(777),
		});

		const [entry] = await storage.listOutboxAttachments(
			"cfg1",
			"acc1",
			"draft1",
		);
		assert.strictEqual(entry.outboxAttachmentId, "att1");
		// Uncompressed, so the size in the bucket is the size the cap counts.
		assert.strictEqual(entry.sizeBytes, 777);
		assert.strictEqual(
			await storage
				.statOutboxAttachment("cfg1", "acc1", "draft1", "att1")
				.then((found) => found?.sizeBytes),
			777,
		);
	});

	test("statOutboxAttachment answers null for an object that was never uploaded", async () => {
		const { client } = createFakeS3Client();
		const storage = createS3StorageService(client, "bucket");

		assert.strictEqual(
			await storage.statOutboxAttachment("cfg1", "acc1", "draft1", "nothing"),
			null,
		);
	});

	test("deleting a draft's attachments empties the prefix", async () => {
		const { client } = createFakeS3Client();
		const storage = createS3StorageService(client, "bucket");
		await storage.storeOutboxAttachment({
			accountConfigId: "cfg1",
			accountId: "acc1",
			outboxMessageId: "draft1",
			outboxAttachmentId: "att2",
			content: Buffer.alloc(8),
		});
		await storage.deleteOutboxAttachments("cfg1", "acc1", "draft1");

		assert.deepStrictEqual(
			await storage.listOutboxAttachments("cfg1", "acc1", "draft1"),
			[],
		);
	});

	test("listOutboxDraftsWithAttachments finds prefixes whose row may be long gone", async () => {
		const { client } = createFakeS3Client();
		const storage = createS3StorageService(client, "bucket");
		for (const draft of ["draft1", "draft2"]) {
			await storage.storeOutboxAttachment({
				accountConfigId: "cfg1",
				accountId: "acc1",
				outboxMessageId: draft,
				outboxAttachmentId: "att1",
				content: Buffer.alloc(4),
			});
		}

		assert.deepStrictEqual(
			(await storage.listOutboxDraftsWithAttachments("cfg1", "acc1")).sort(),
			["draft1", "draft2"],
		);
	});
});
