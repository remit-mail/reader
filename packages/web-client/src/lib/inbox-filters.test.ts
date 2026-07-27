import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { RemitImapThreadMessageResponse } from "@remit/api-http-client/types.gen.ts";
import { applyInboxFilters } from "./inbox-filters.js";

// Only the fields the filter reads, following the fixture idiom in
// starred-rows.test.ts.
const thread = (
	fields: Partial<RemitImapThreadMessageResponse> & { messageId: string },
): RemitImapThreadMessageResponse =>
	({ isRead: false, ...fields }) as unknown as RemitImapThreadMessageResponse;

const personal = thread({ messageId: "m1", category: "personal" });
const unclassified = thread({ messageId: "m2", category: "uncategorized" });
const preClassification = thread({ messageId: "m3" });

const ids = (threads: RemitImapThreadMessageResponse[]): string[] =>
	threads.map((t) => t.messageId);

describe("applyInboxFilters", () => {
	test("returns the loaded list when nothing narrows it", () => {
		const threads = [personal, unclassified, preClassification];
		assert.deepEqual(applyInboxFilters(threads, "all", new Set()), threads);
	});

	test("matches a thread whose category is set", () => {
		assert.deepEqual(
			ids(applyInboxFilters([personal, unclassified], "personal", new Set())),
			["m1"],
		);
	});

	test("counts a thread with no category as unclassified (#45)", () => {
		// A pre-classification thread already renders an `uncategorized` badge,
		// so the Unclassified chip has to find the row the user can see. Reading
		// the response field raw made that row vanish under its own chip.
		assert.deepEqual(
			ids(
				applyInboxFilters(
					[personal, unclassified, preClassification],
					"uncategorized",
					new Set(),
				),
			),
			["m2", "m3"],
		);
	});

	test("never lets unclassified mail answer to personal (#45)", () => {
		assert.deepEqual(
			applyInboxFilters(
				[unclassified, preClassification],
				"personal",
				new Set(),
			),
			[],
		);
	});

	test("applies attribute predicates alongside a category", () => {
		const read = thread({
			messageId: "m4",
			category: "personal",
			isRead: true,
		});
		assert.deepEqual(
			ids(applyInboxFilters([personal, read], "personal", new Set(["unread"]))),
			["m1"],
		);
	});

	test("applies attribute predicates without a category", () => {
		const read = thread({
			messageId: "m4",
			category: "newsletter",
			isRead: true,
		});
		assert.deepEqual(
			ids(applyInboxFilters([personal, read], "all", new Set(["unread"]))),
			["m1"],
		);
	});

	test("matches starred and attachment threads", () => {
		const starred = thread({ messageId: "m5", hasStars: true });
		const withAttachment = thread({ messageId: "m6", hasAttachment: true });
		const plain = thread({ messageId: "m7" });
		const threads = [starred, withAttachment, plain];
		assert.deepEqual(
			ids(applyInboxFilters(threads, "all", new Set(["flagged"]))),
			["m5"],
		);
		assert.deepEqual(
			ids(applyInboxFilters(threads, "all", new Set(["attachment"]))),
			["m6"],
		);
	});

	test("ignores an attribute id with no predicate behind it", () => {
		const threads = [personal, unclassified];
		assert.deepEqual(
			applyInboxFilters(threads, "all", new Set(["nonsense"])),
			threads,
		);
	});
});
