import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	createDeterministicEmbeddingService,
	createMemoryVectorStore,
	createSearchService,
	type EnvelopeChunkInput,
	type IndexEmailParams,
	type SearchService,
} from "@remit/search-service";
import type {
	ParsedBody,
	StorageService,
	StoreParsedBodyParams,
} from "@remit/storage-service";
import {
	extractAccountIdFromBodyKey,
	fetchBodyFromStorage,
	isStorageNotFoundError,
	type SearchWipeLogger,
	wipeSearchVectors,
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

describe("extractAccountIdFromBodyKey", () => {
	it("extracts accountId from an s3:// URI", () => {
		assert.equal(
			extractAccountIdFromBodyKey(
				"s3://remit-storage-dev/accounts/acc-abc/messages/msg-1/body.eml",
			),
			"acc-abc",
		);
	});

	it("returns null when the URI shape doesn't match", () => {
		assert.equal(
			extractAccountIdFromBodyKey("s3://bucket/some/other/path.bin"),
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
				storageKey: `accounts/${params.accountId}/messages/${params.messageId}/parsed.json.gz`,
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
	const bodyKey = "s3://remit-storage-dev/accounts/acc1/messages/msg1/body.eml";

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

interface CapturedWarn {
	calls: Array<{ obj: Record<string, unknown>; msg: string }>;
}

const buildCapturingLogger = (): {
	logger: SearchWipeLogger;
} & CapturedWarn => {
	const calls: CapturedWarn["calls"] = [];
	return {
		calls,
		logger: {
			warn: (obj, msg) => {
				calls.push({ obj, msg });
			},
		},
	};
};

const aliceEnvelope: EnvelopeChunkInput = {
	from: { name: "Alice", email: "alice@example.com" },
	to: [{ name: "Bob", email: "bob@example.com" }],
	cc: [],
	bcc: [],
	subject: "Q2 plan review",
	attachments: [],
};

const aliceIndexParams: IndexEmailParams = {
	envelope: aliceEnvelope,
	parsedBody: {
		text: "Reviewing the Q2 plan ahead of the kickoff with the leadership team next week.",
		html: null,
	},
	metadata: {
		messageId: "msg-alice-1",
		threadId: "thread-alice",
		accountConfigId: "acct-alice",
		mailboxIds: ["mb-inbox-alice"],
		sentDate: 1_700_000_000,
		isRead: false,
		hasAttachment: false,
		hasStars: false,
		fromEmail: "alice@example.com",
	},
};

describe("wipeSearchVectors", () => {
	it("removes a previously-indexed message so search no longer returns it", async () => {
		const store = createMemoryVectorStore();
		const embedder = createDeterministicEmbeddingService({ dimensions: 128 });
		const search = createSearchService({ store, embedder });
		const { logger } = buildCapturingLogger();

		await search.index(aliceIndexParams);

		const before = await search.search({
			query: "alice",
			accountConfigId: "acct-alice",
		});
		assert.ok(
			before.some((r) => r.messageId === "msg-alice-1"),
			"sanity: message must be findable before wipe",
		);

		await wipeSearchVectors(search, ["msg-alice-1"], logger);

		const after = await search.search({
			query: "alice",
			accountConfigId: "acct-alice",
		});
		assert.equal(
			after.some((r) => r.messageId === "msg-alice-1"),
			false,
			"message must not appear after wipe",
		);
	});

	it("logs a warning and does not throw when SearchService.delete fails", async () => {
		const failure = new Error("vector store unavailable");
		const search: SearchService = {
			index: async () => {},
			search: async () => [],
			delete: async () => {
				throw failure;
			},
		};
		const { logger, calls } = buildCapturingLogger();

		await wipeSearchVectors(search, ["msg-bob-1"], logger);

		assert.equal(calls.length, 1, "exactly one warning per failing message");
		assert.equal(calls[0].obj.messageId, "msg-bob-1");
		assert.match(String(calls[0].obj.error), /vector store unavailable/);
		assert.match(calls[0].msg, /Failed to wipe search vectors/);
	});

	it("continues wiping remaining messages when one delete fails", async () => {
		const store = createMemoryVectorStore();
		const embedder = createDeterministicEmbeddingService({ dimensions: 128 });
		const real = createSearchService({ store, embedder });

		await real.index({
			...aliceIndexParams,
			metadata: { ...aliceIndexParams.metadata, messageId: "msg-carol-1" },
		});
		await real.index({
			...aliceIndexParams,
			metadata: { ...aliceIndexParams.metadata, messageId: "msg-dave-1" },
		});

		const search: SearchService = {
			index: real.index.bind(real),
			search: real.search.bind(real),
			delete: async (messageId) => {
				if (messageId === "msg-carol-1") {
					throw new Error("transient failure for carol");
				}
				await real.delete(messageId);
			},
		};
		const { logger, calls } = buildCapturingLogger();

		await wipeSearchVectors(search, ["msg-carol-1", "msg-dave-1"], logger);

		assert.equal(calls.length, 1);
		assert.equal(calls[0].obj.messageId, "msg-carol-1");

		const after = await real.search({
			query: "alice",
			accountConfigId: "acct-alice",
		});
		assert.equal(
			after.some((r) => r.messageId === "msg-dave-1"),
			false,
			"dave's vectors must still be wiped despite carol's failure",
		);
	});

	it("is a no-op for an empty messageId list", async () => {
		const search: SearchService = {
			index: async () => {
				throw new Error("unexpected");
			},
			search: async () => {
				throw new Error("unexpected");
			},
			delete: async () => {
				throw new Error("unexpected");
			},
		};
		const { logger, calls } = buildCapturingLogger();

		await wipeSearchVectors(search, [], logger);

		assert.equal(calls.length, 0);
	});
});
