import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { gzipSync } from "node:zlib";
import {
	parseContentStorageKey,
	type ServeContentDeps,
	serveContent,
} from "./content-handler.js";

const PART_KEY = "accounts/cfg-1/acc-1/messages/msg-1/parts/1.2";

const baseDeps = (
	over: Partial<ServeContentDeps> = {},
): { deps: ServeContentDeps; cues: Array<Record<string, unknown>> } => {
	const cues: Array<Record<string, unknown>> = [];
	const deps: ServeContentDeps = {
		readObject: async () => null,
		lookupMessage: async () => ({ mailboxId: "mbx-1", uid: 42 }),
		requestBodySync: async (input) => {
			cues.push(input);
		},
		...over,
	};
	return { deps, cues };
};

describe("parseContentStorageKey", () => {
	it("extracts account + message ids from a part key", () => {
		assert.deepEqual(parseContentStorageKey(PART_KEY), {
			accountConfigId: "cfg-1",
			accountId: "acc-1",
			messageId: "msg-1",
		});
	});

	it("returns null for a non-matching key", () => {
		assert.equal(parseContentStorageKey("nope/whatever"), null);
	});
});

describe("serveContent", () => {
	it("returns 200 with decompressed bytes when the object is present", async () => {
		const { deps, cues } = baseDeps({
			readObject: async () => gzipSync(Buffer.from("hello body")),
		});

		const result = await serveContent(deps, {
			fullPath: "/x/parts/1.2",
			storageKey: PART_KEY,
		});

		assert.equal(result.status, 200);
		assert.equal(result.headers["content-type"], "application/octet-stream");
		assert.equal(result.body.toString(), "hello body");
		assert.equal(cues.length, 0);
	});

	it("returns 202 + Retry-After and re-arms the cue when the object is missing", async () => {
		const { deps, cues } = baseDeps({ readObject: async () => null });

		const result = await serveContent(deps, {
			fullPath: "/x/parts/1.2",
			storageKey: PART_KEY,
		});

		assert.equal(result.status, 202);
		assert.equal(result.headers["Retry-After"], "1");
		assert.equal(cues.length, 1, "cue re-armed exactly once");
		assert.deepEqual(cues[0], {
			accountId: "acc-1",
			mailboxId: "mbx-1",
			messageId: "msg-1",
			uid: 42,
		});
	});

	it("still answers 202 (no cue) when the message row is gone", async () => {
		const { deps, cues } = baseDeps({
			readObject: async () => null,
			lookupMessage: async () => null,
		});

		const result = await serveContent(deps, {
			fullPath: "/x/parts/1.2",
			storageKey: PART_KEY,
		});

		assert.equal(result.status, 202);
		assert.equal(cues.length, 0);
	});

	it("propagates a non-missing read error so the route 500s", async () => {
		const { deps } = baseDeps({
			readObject: async () => {
				throw new Error("EACCES");
			},
		});

		await assert.rejects(
			() =>
				serveContent(deps, { fullPath: "/x/parts/1.2", storageKey: PART_KEY }),
			/EACCES/,
		);
	});
});
