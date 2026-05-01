import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type {
	ParsedBody,
	StorageService,
	StoreParsedBodyParams,
} from "@remit/storage-service";
import {
	extractAccountIdsFromBodyKey,
	fetchBodyFromStorage,
	isStorageNotFoundError,
} from "./message.js";

describe("isStorageNotFoundError", () => {
	it("matches S3 NoSuchKey via .name", () => {
		const err = Object.assign(new Error("missing"), { name: "NoSuchKey" });
		assert.equal(isStorageNotFoundError(err), true);
	});

	it("matches S3 NoSuchKey via .Code", () => {
		const err = { Code: "NoSuchKey", message: "missing" };
		assert.equal(isStorageNotFoundError(err), true);
	});

	it("matches filesystem ENOENT", () => {
		const err = Object.assign(new Error("no such file"), { code: "ENOENT" });
		assert.equal(isStorageNotFoundError(err), true);
	});

	it("does not match generic errors", () => {
		assert.equal(isStorageNotFoundError(new Error("boom")), false);
	});

	it("does not match other S3 errors", () => {
		const err = Object.assign(new Error("denied"), { name: "AccessDenied" });
		assert.equal(isStorageNotFoundError(err), false);
	});

	it("does not match non-objects", () => {
		assert.equal(isStorageNotFoundError(null), false);
		assert.equal(isStorageNotFoundError(undefined), false);
		assert.equal(isStorageNotFoundError("oops"), false);
	});
});

describe("extractAccountIdsFromBodyKey", () => {
	it("extracts accountConfigId + accountId from a /accounts/{cfg}/{acc}/... s3 URI", () => {
		assert.deepEqual(
			extractAccountIdsFromBodyKey(
				"s3://remit-storage-dev/accounts/cfg-1/acc-abc/messages/msg-1/body.eml",
			),
			{ accountConfigId: "cfg-1", accountId: "acc-abc" },
		);
	});

	it("returns null when the URI shape doesn't match", () => {
		assert.equal(
			extractAccountIdsFromBodyKey("s3://bucket/some/other/path.bin"),
			null,
		);
	});

	it("returns null when only one segment is present (legacy path)", () => {
		assert.equal(
			extractAccountIdsFromBodyKey(
				"s3://bucket/accounts/legacy-acc/messages/m1/body.eml",
			),
			null,
		);
	});
});

interface FakeStorageOptions {
	parsedHit?: ParsedBody | null;
	rawBody?: Buffer | "missing";
	parsedHitOnce?: ParsedBody;
	storeParsedThrows?: boolean;
}

interface FakeStorage {
	storage: StorageService;
	calls: {
		retrieveParsedBody: number;
		retrieve: number;
		storeParsedBody: number;
	};
	stored: StoreParsedBodyParams[];
}

const A_RAW_EML = Buffer.from(
	[
		"From: a@example.com",
		"To: b@example.com",
		"Subject: hi",
		"Content-Type: text/plain",
		"",
		"hello world",
		"",
	].join("\r\n"),
);

const createFakeStorage = (opts: FakeStorageOptions): FakeStorage => {
	const calls = { retrieveParsedBody: 0, retrieve: 0, storeParsedBody: 0 };
	const stored: StoreParsedBodyParams[] = [];

	const storage: StorageService = {
		storeMessageBody: async () => {
			throw new Error("not implemented");
		},
		storeBodyPart: async () => {
			throw new Error("not implemented");
		},
		storeDeduplicated: async () => {
			throw new Error("not implemented");
		},
		storeParsedBody: async (params) => {
			calls.storeParsedBody += 1;
			if (opts.storeParsedThrows) {
				throw new Error("simulated cache write failure");
			}
			stored.push(params);
			return {
				uri: `mock://parsed/${params.messageId}`,
				storageType: "s3",
				storageLocation: "mock",
				storageKey: `accounts/${params.accountConfigId}/${params.accountId}/messages/${params.messageId}/parsed.json.gz`,
				sizeBytes: 0,
				checksumSha256: "x",
				contentEncoding: "gzip",
			};
		},
		retrieveParsedBody: async () => {
			calls.retrieveParsedBody += 1;
			return opts.parsedHit ?? null;
		},
		retrieve: async () => {
			calls.retrieve += 1;
			if (opts.rawBody === "missing") {
				throw Object.assign(new Error("NoSuchKey"), { name: "NoSuchKey" });
			}
			if (!opts.rawBody) {
				throw new Error("test setup: rawBody not provided");
			}
			return opts.rawBody;
		},
		exists: async () => true,
		delete: async () => {},
	};

	return { storage, calls, stored };
};

describe("fetchBodyFromStorage", () => {
	const bodyKey =
		"s3://remit-storage-dev/accounts/cfg1/acc1/messages/msg1/body.eml";

	it("returns cached parsed body and skips raw retrieve + parse", async () => {
		const cached: ParsedBody = {
			text: "cached text",
			html: "<p>cached</p>",
			attachments: [],
		};
		const { storage, calls } = createFakeStorage({ parsedHit: cached });

		const result = await fetchBodyFromStorage(storage, "msg1", bodyKey);

		assert.deepEqual(result, {
			bodyText: "cached text",
			bodyHtml: "<p>cached</p>",
		});
		assert.equal(calls.retrieveParsedBody, 1);
		assert.equal(calls.retrieve, 0);
		assert.equal(calls.storeParsedBody, 0);
	});

	it("falls back to raw .eml on cache miss, parses, and writes the cache", async () => {
		const { storage, calls, stored } = createFakeStorage({
			parsedHit: null,
			rawBody: A_RAW_EML,
		});

		const result = await fetchBodyFromStorage(storage, "msg1", bodyKey);

		assert.equal(result?.bodyText?.includes("hello world"), true);
		assert.equal(calls.retrieveParsedBody, 1);
		assert.equal(calls.retrieve, 1);
		assert.equal(calls.storeParsedBody, 1);
		assert.equal(stored[0].accountConfigId, "cfg1");
		assert.equal(stored[0].accountId, "acc1");
		assert.equal(stored[0].messageId, "msg1");
		assert.equal(typeof stored[0].parsed.text, "string");
		assert.ok(Array.isArray(stored[0].parsed.attachments));
	});

	it("returns null when both parsed cache and raw .eml are missing", async () => {
		const { storage, calls } = createFakeStorage({
			parsedHit: null,
			rawBody: "missing",
		});

		const result = await fetchBodyFromStorage(storage, "msg1", bodyKey);

		assert.equal(result, null);
		assert.equal(calls.retrieveParsedBody, 1);
		assert.equal(calls.retrieve, 1);
		assert.equal(calls.storeParsedBody, 0);
	});

	it("does not fail the read when the parsed-cache write fails", async () => {
		const { storage, calls } = createFakeStorage({
			parsedHit: null,
			rawBody: A_RAW_EML,
			storeParsedThrows: true,
		});

		const result = await fetchBodyFromStorage(storage, "msg1", bodyKey);

		assert.equal(result?.bodyText?.includes("hello world"), true);
		assert.equal(calls.storeParsedBody, 1);
	});

	it("propagates non-NotFound errors from raw retrieve", async () => {
		const storage: StorageService = {
			storeMessageBody: async () => {
				throw new Error("not implemented");
			},
			storeBodyPart: async () => {
				throw new Error("not implemented");
			},
			storeDeduplicated: async () => {
				throw new Error("not implemented");
			},
			storeParsedBody: async () => {
				throw new Error("not implemented");
			},
			retrieveParsedBody: async () => null,
			retrieve: async () => {
				throw Object.assign(new Error("denied"), { name: "AccessDenied" });
			},
			exists: async () => true,
			delete: async () => {},
		};

		await assert.rejects(
			fetchBodyFromStorage(storage, "msg1", bodyKey),
			/denied/,
		);
	});
});
