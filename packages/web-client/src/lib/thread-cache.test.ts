import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { RemitImapThreadMessageResponse } from "@remit/api-http-client/types.gen.ts";
import {
	isInfiniteThreadData,
	patchThreadListCache,
	type ThreadListCache,
} from "./thread-cache";

const message = (messageId: string): RemitImapThreadMessageResponse =>
	({ messageId }) as RemitImapThreadMessageResponse;

const drop = (id: string) => (items: RemitImapThreadMessageResponse[]) =>
	items.filter((item) => item.messageId !== id);

describe("isInfiniteThreadData", () => {
	it("recognises only the paged shape", () => {
		assert.equal(isInfiniteThreadData({ pages: [], pageParams: [] }), true);
		assert.equal(isInfiniteThreadData({ items: [] }), false);
		assert.equal(isInfiniteThreadData(undefined), false);
		assert.equal(isInfiniteThreadData(null), false);
	});
});

describe("patchThreadListCache", () => {
	it("patches every page of an infinite query", () => {
		const cache: ThreadListCache = {
			pages: [
				{ items: [message("a"), message("b")] },
				{ items: [message("c")] },
			],
			pageParams: [undefined, "next"],
		};

		const patched = patchThreadListCache(cache, drop("b"));

		assert.deepEqual(patched, {
			pages: [{ items: [message("a")] }, { items: [message("c")] }],
			pageParams: [undefined, "next"],
		});
	});

	it("patches a single-shot page, which shares the query-key prefix", () => {
		// The rescue-candidate search caches this shape under the same prefix the
		// mailbox list uses. An updater that assumed `pages` threw here, failing
		// the whole mutation before it ever reached the server (issues #51, #55).
		const cache: ThreadListCache = {
			items: [message("a"), message("b")],
			continuationToken: "t",
		};

		const patched = patchThreadListCache(cache, drop("a"));

		assert.deepEqual(patched, {
			items: [message("b")],
			continuationToken: "t",
		});
	});

	it("leaves an unrecognised entry alone instead of throwing", () => {
		const cache = { total: 3 } as unknown as ThreadListCache;
		assert.equal(patchThreadListCache(cache, drop("a")), cache);
		assert.equal(patchThreadListCache(undefined, drop("a")), undefined);
	});
});
