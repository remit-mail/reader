import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { backfillSearchText } from "./search-text-backfill.js";

const eml = (body: string): Buffer =>
	Buffer.from(
		`From: Ada <ada@example.test>\r\nSubject: Note\r\nContent-Type: text/plain\r\n\r\n${body}\r\n`,
	);

const notFound = Object.assign(new Error("gone"), { code: "ENOENT" });

const harness = (
	stored: Record<string, Buffer | Error>,
	pages: Array<Array<{ messageId: string; bodyStorageKey: string }>>,
) => {
	const texts = new Map<string, string>();
	const synced: string[][] = [];
	const cursors: string[] = [];
	const deps = {
		messageService: {
			listMissingSearchText: async (after: string) => {
				cursors.push(after);
				return pages.shift() ?? [];
			},
			setSearchText: async (messageId: string, text: string) => {
				texts.set(messageId, text);
			},
			syncSearch: async (messageIds: string[]) => {
				synced.push(messageIds);
			},
		},
		storageService: {
			retrieve: async (uri: string) => {
				const body = stored[uri];
				if (body instanceof Error) throw body;
				return body;
			},
		},
	};
	const warnings: string[] = [];
	const log = {
		warn: (fields: Record<string, unknown>) => {
			warnings.push(String(fields.messageId));
		},
	};
	return { deps, log, texts, synced, cursors, warnings };
};

describe("backfillSearchText", () => {
	it("records each stored body's text, indexes the page, and moves the cursor on", async () => {
		const h = harness(
			{ "s://a": eml("first body"), "s://b": eml("second body") },
			[
				[{ messageId: "a", bodyStorageKey: "s://a" }],
				[{ messageId: "b", bodyStorageKey: "s://b" }],
			],
		);

		const result = await backfillSearchText(h.deps, h.log);

		assert.deepEqual(result, { indexed: 2, skipped: 0 });
		assert.equal(h.texts.get("a"), "first body");
		assert.equal(h.texts.get("b"), "second body");
		assert.deepEqual(h.synced, [["a"], ["b"]]);
		assert.deepEqual(h.cursors, ["", "a", "b"]);
	});

	it("skips a body that is gone and leaves it for the next pass", async () => {
		const h = harness({ "s://a": notFound, "s://b": eml("kept") }, [
			[
				{ messageId: "a", bodyStorageKey: "s://a" },
				{ messageId: "b", bodyStorageKey: "s://b" },
			],
		]);

		const result = await backfillSearchText(h.deps, h.log);

		assert.deepEqual(result, { indexed: 1, skipped: 1 });
		assert.equal(h.texts.has("a"), false);
		assert.deepEqual(h.synced, [["b"]]);
		assert.deepEqual(h.warnings, ["a"]);
	});

	it("lets any other storage failure through", async () => {
		const h = harness({ "s://a": new Error("storage is down") }, [
			[{ messageId: "a", bodyStorageKey: "s://a" }],
		]);

		await assert.rejects(backfillSearchText(h.deps, h.log), /storage is down/);
	});
});
