import assert from "node:assert";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, test } from "node:test";
import { S3Client } from "@aws-sdk/client-s3";
import { createFilesystemStorageService } from "./backends/filesystem.js";
import { createS3StorageService } from "./backends/s3.js";
import {
	authorizeUploadRequest,
	UPLOAD_ROUTE_PREFIX,
	UPLOAD_URL_SIGNING_LABEL,
} from "./outbox-upload-url.js";
import { signStoragePath } from "./signed-path.js";
import {
	buildOutboxAttachmentKey,
	parseOutboxAttachmentKey,
} from "./storage.js";

const SECRET = "a-signing-secret-of-at-least-32-characters";
const KEY = buildOutboxAttachmentKey("cfg1", "acc1", "draft1", "att1");

const sign = (path: string, exp: number, max: number): string =>
	signStoragePath(SECRET, UPLOAD_URL_SIGNING_LABEL, path, [exp, max]);

describe("authorizeUploadRequest", () => {
	const now = 1_000_000;
	const exp = now + 900;

	test("admits a request presenting the signature that was minted for it", () => {
		const result = authorizeUploadRequest({
			secret: SECRET,
			relativePath: KEY,
			exp: String(exp),
			max: "2048",
			sig: sign(KEY, exp, 2048),
			nowSeconds: now,
		});
		assert.deepStrictEqual(result, { authorized: true, maxBytes: 2048 });
	});

	test("refuses a signature minted for another attachment's key", () => {
		const otherKey = buildOutboxAttachmentKey("cfg1", "acc1", "draft1", "att2");
		const result = authorizeUploadRequest({
			secret: SECRET,
			relativePath: otherKey,
			exp: String(exp),
			max: "2048",
			sig: sign(KEY, exp, 2048),
			nowSeconds: now,
		});
		assert.strictEqual(result.authorized, false);
	});

	test("refuses a signature minted for another account's key", () => {
		const otherTenant = buildOutboxAttachmentKey(
			"cfg2",
			"acc1",
			"draft1",
			"att1",
		);
		const result = authorizeUploadRequest({
			secret: SECRET,
			relativePath: otherTenant,
			exp: String(exp),
			max: "2048",
			sig: sign(KEY, exp, 2048),
			nowSeconds: now,
		});
		assert.strictEqual(result.authorized, false);
	});

	test("refuses a raised byte count — the size is part of what was signed", () => {
		const result = authorizeUploadRequest({
			secret: SECRET,
			relativePath: KEY,
			exp: String(exp),
			max: "999999",
			sig: sign(KEY, exp, 2048),
			nowSeconds: now,
		});
		assert.strictEqual(result.authorized, false);
	});

	test("refuses an extended expiry", () => {
		const result = authorizeUploadRequest({
			secret: SECRET,
			relativePath: KEY,
			exp: String(exp + 10_000),
			max: "2048",
			sig: sign(KEY, exp, 2048),
			nowSeconds: now,
		});
		assert.strictEqual(result.authorized, false);
	});

	test("refuses a lapsed URL", () => {
		const result = authorizeUploadRequest({
			secret: SECRET,
			relativePath: KEY,
			exp: String(exp),
			max: "2048",
			sig: sign(KEY, exp, 2048),
			nowSeconds: exp + 1,
		});
		assert.strictEqual(result.authorized, false);
		assert.strictEqual(result.authorized === false && result.reason, "expired");
	});

	test("refuses a request presenting no signature at all", () => {
		const result = authorizeUploadRequest({
			secret: SECRET,
			relativePath: KEY,
			exp: String(exp),
			max: "2048",
			sig: undefined,
			nowSeconds: now,
		});
		assert.strictEqual(result.authorized === false && result.status, 401);
	});

	test("fails closed when no secret is configured", () => {
		const result = authorizeUploadRequest({
			secret: undefined,
			relativePath: KEY,
			exp: String(exp),
			max: "2048",
			sig: sign(KEY, exp, 2048),
			nowSeconds: now,
		});
		assert.strictEqual(result.authorized === false && result.status, 500);
	});

	test("a read grant for the same path is not a write grant", () => {
		// The content signer covers the path and an expiry under its own label.
		const readSignature = signStoragePath(
			SECRET,
			"remit-content-url-signing-v1",
			KEY,
			[exp],
		);
		const result = authorizeUploadRequest({
			secret: SECRET,
			relativePath: KEY,
			exp: String(exp),
			max: "2048",
			sig: readSignature,
			nowSeconds: now,
		});
		assert.strictEqual(result.authorized, false);
	});
});

describe("attachment keys", () => {
	test("parseOutboxAttachmentKey recovers the ids the upload route needs", () => {
		assert.deepStrictEqual(parseOutboxAttachmentKey(KEY), {
			accountConfigId: "cfg1",
			accountId: "acc1",
			outboxMessageId: "draft1",
			outboxAttachmentId: "att1",
		});
	});

	test("parseOutboxAttachmentKey refuses a message content key", () => {
		assert.strictEqual(
			parseOutboxAttachmentKey("accounts/cfg1/acc1/messages/msg1/parts/1.2"),
			null,
		);
	});

	test("parseOutboxAttachmentKey refuses a traversal, signature or no signature", () => {
		// `..` matches a naive [^/]+ and the write side joins this onto a
		// filesystem root, so the shape has to refuse it before the HMAC is the
		// only thing left standing.
		assert.strictEqual(
			parseOutboxAttachmentKey(
				"accounts/cfg1/acc1/outbox/draft1/attachments/..",
			),
			null,
		);
		assert.strictEqual(
			parseOutboxAttachmentKey("accounts/../../etc/outbox/x/attachments/y"),
			null,
		);
		assert.strictEqual(
			parseOutboxAttachmentKey(
				"accounts/cfg1/acc1/outbox/draft1/attachments/a.b",
			),
			null,
		);
	});
});

describe("minting an upload URL", () => {
	test("the filesystem backend mints a URL its own route will admit", async () => {
		const basePath = await mkdtemp(join(tmpdir(), "remit-upload-url-"));
		try {
			const storage = createFilesystemStorageService(basePath, {
				origin: "https://mail.example.test/",
				signingSecret: SECRET,
			});
			const expiresAt = Math.floor(Date.now() / 1000) + 900;

			const { uploadUrl } = await storage.createOutboxAttachmentUploadUrl({
				accountConfigId: "cfg1",
				accountId: "acc1",
				outboxMessageId: "draft1",
				outboxAttachmentId: "att1",
				sizeBytes: 2048,
				expiresAt,
			});

			const url = new URL(uploadUrl);
			assert.strictEqual(url.origin, "https://mail.example.test");
			assert.strictEqual(url.pathname, `${UPLOAD_ROUTE_PREFIX}${KEY}`);

			const admitted = authorizeUploadRequest({
				secret: SECRET,
				relativePath: url.pathname.slice(UPLOAD_ROUTE_PREFIX.length),
				exp: url.searchParams.get("exp") ?? undefined,
				max: url.searchParams.get("max") ?? undefined,
				sig: url.searchParams.get("sig") ?? undefined,
				nowSeconds: Math.floor(Date.now() / 1000),
			});
			assert.deepStrictEqual(admitted, { authorized: true, maxBytes: 2048 });
		} finally {
			await rm(basePath, { recursive: true, force: true });
		}
	});

	test("the filesystem backend refuses to mint without an origin and a secret", async () => {
		const basePath = await mkdtemp(join(tmpdir(), "remit-upload-url-"));
		try {
			const storage = createFilesystemStorageService(basePath);
			await assert.rejects(
				() =>
					storage.createOutboxAttachmentUploadUrl({
						accountConfigId: "cfg1",
						accountId: "acc1",
						outboxMessageId: "draft1",
						outboxAttachmentId: "att1",
						sizeBytes: 1,
						expiresAt: Math.floor(Date.now() / 1000) + 60,
					}),
				/cannot mint an upload URL/,
			);
		} finally {
			await rm(basePath, { recursive: true, force: true });
		}
	});

	test("the S3 backend mints a presigned PUT with the size inside the signature", async () => {
		const client = new S3Client({
			region: "eu-west-1",
			credentials: {
				accessKeyId: "AKIATESTTESTTEST",
				secretAccessKey: "test-secret",
			},
		});
		const storage = createS3StorageService(client, "a-bucket");
		const params = {
			accountConfigId: "cfg1",
			accountId: "acc1",
			outboxMessageId: "draft1",
			outboxAttachmentId: "att1",
			sizeBytes: 2048,
			expiresAt: Math.floor(Date.now() / 1000) + 900,
		};

		const { uploadUrl } = await storage.createOutboxAttachmentUploadUrl(params);
		const url = new URL(uploadUrl);

		assert.ok(url.pathname.endsWith(KEY));
		// content-length inside SignedHeaders is what makes the declared size
		// unforgeable: S3 recomputes the signature over the length it is sent.
		assert.match(
			url.searchParams.get("X-Amz-SignedHeaders") ?? "",
			/content-length/,
		);

		const larger = await storage.createOutboxAttachmentUploadUrl({
			...params,
			sizeBytes: 4096,
		});
		assert.notStrictEqual(
			url.searchParams.get("X-Amz-Signature"),
			new URL(larger.uploadUrl).searchParams.get("X-Amz-Signature"),
		);
	});
});
