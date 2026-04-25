import assert from "node:assert";
import { describe, test } from "node:test";
import { gunzipSync } from "node:zlib";
import {
	GetObjectCommand,
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
			if (!entry) throw new Error(`not found: ${key}`);
			return {
				Body: {
					transformToByteArray: async () => new Uint8Array(entry.body),
				},
				ContentEncoding: entry.contentEncoding,
			};
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
	test("storeMessageBody sends gzipped body without a client-supplied ChecksumSHA256", async () => {
		const { client, commands, stored } = createFakeS3Client();
		const storage = createS3StorageService(client, "bucket");
		const content = Buffer.from("Hello, world! This is a message body.");

		const ref = await storage.storeMessageBody({
			accountId: "acc123",
			messageId: "msg456",
			content,
		});

		assert.strictEqual(commands.length, 1);
		const put = commands[0];
		assert.strictEqual(put.name, "PutObjectCommand");
		assert.strictEqual(put.input.ChecksumSHA256, undefined);
		assert.strictEqual(put.input.ContentEncoding, "gzip");

		const entry = stored.get("accounts/acc123/messages/msg456/body.eml");
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
			accountId: "acc123",
			content,
		});

		const expectedKey = `accounts/acc123/dedup/${hash.slice(0, 2)}/${hash}`;
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
			accountId: "acc123",
			messageId: "msg789",
			content,
		});

		const retrieved = await storage.retrieve(ref.uri);
		assert.deepStrictEqual(retrieved, content);
	});
});
