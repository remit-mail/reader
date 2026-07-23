/**
 * The mutation hooks behind delete, move, star and mark-read all make the same
 * promise: the list changes the moment the user acts, every listing that shows
 * the row changes with it — including the unified one the daily brief reads
 * (#140, #149) — and a server refusal puts the row back and says so.
 *
 * These mount the real hooks against a real QueryClient, so the optimistic
 * patch, the rollback and the banner are exercised together rather than as
 * three separate pure helpers.
 */

import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import {
	threadOperationsListThreadsQueryKey,
	unifiedThreadOperationsListAllThreadsQueryKey,
} from "@remit/api-http-client/@tanstack/react-query.gen.ts";
import type { RemitImapThreadMessageResponse } from "@remit/api-http-client/types.gen.ts";
import { createElement } from "react";
import { createDomHarness, type DomHarness } from "../test-support/dom";
import { makeThreadMessage } from "../test-support/fixtures";
import { type HttpMock, httpError, mockFetch } from "../test-support/http";
import { useDeleteMessages } from "./useDeleteMessages";
import { useToggleReadFor } from "./useMarkAsRead";
import { useMoveMessages } from "./useMoveMessages";
import { useToggleStar } from "./useToggleStar";

const INBOX = "mbx-inbox";
const SENT = "mbx-sent";
const ARCHIVE = "mbx-archive";

const inboxRow = makeThreadMessage({ messageId: "msg-1", mailboxId: INBOX });
const sentRow = makeThreadMessage({
	messageId: "msg-2",
	mailboxId: SENT,
	threadMessageId: "tm-2",
});

let harness: DomHarness | undefined;
let http: HttpMock;

const inboxKey = threadOperationsListThreadsQueryKey({
	path: { mailboxId: INBOX },
});
const sentKey = threadOperationsListThreadsQueryKey({
	path: { mailboxId: SENT },
});
const briefKey = unifiedThreadOperationsListAllThreadsQueryKey();

const seed = (dom: DomHarness): void => {
	dom.queryClient.setQueryData(inboxKey, { items: [inboxRow] });
	dom.queryClient.setQueryData(sentKey, { items: [sentRow] });
	dom.queryClient.setQueryData(briefKey, { items: [inboxRow, sentRow] });
};

const rows = (
	dom: DomHarness,
	key: readonly unknown[],
): RemitImapThreadMessageResponse[] =>
	(
		dom.queryClient.getQueryData(key) as
			| { items: RemitImapThreadMessageResponse[] }
			| undefined
	)?.items ?? [];

const ids = (dom: DomHarness, key: readonly unknown[]): string[] =>
	rows(dom, key).map((row) => row.messageId);

/** Mount a hook and hand its return value back to the test. */
const mountHook = <T>(useHook: () => T): { current: () => T } => {
	let value: T | undefined;
	const Probe = () => {
		value = useHook();
		return null;
	};
	harness = createDomHarness();
	seed(harness);
	harness.renderApp(createElement(Probe));
	return {
		current: () => {
			if (value === undefined) throw new Error("hook did not render");
			return value;
		},
	};
};

const dom = (): DomHarness => {
	if (!harness) throw new Error("nothing mounted");
	return harness;
};

beforeEach(() => {
	http = mockFetch(() => ({}));
});

afterEach(() => {
	harness?.close();
	harness = undefined;
	http.restore();
});

describe("deleting from a listing", () => {
	it("removes the row from its mailbox and from the brief at once", async () => {
		const hook = mountHook(() => useDeleteMessages({ mailboxId: INBOX }));

		hook.current().deleteMessages(["msg-1"]);
		await dom().flush();

		assert.deepEqual(ids(dom(), inboxKey), []);
		assert.deepEqual(ids(dom(), briefKey), ["msg-2"]);
	});

	it("tells the caller the row is gone so it can leave the open thread", async () => {
		const removed: string[][] = [];
		const hook = mountHook(() =>
			useDeleteMessages({
				mailboxId: INBOX,
				onAfterOptimisticRemove: (messageIds) => removed.push(messageIds),
			}),
		);

		hook.current().deleteMessages(["msg-1"]);
		await dom().flush();

		assert.deepEqual(removed, [["msg-1"]]);
	});

	it("patches the mailbox the message is really in, not the one being browsed", async () => {
		const hook = mountHook(() =>
			useDeleteMessages({ mailboxId: INBOX, messages: [inboxRow, sentRow] }),
		);

		hook.current().deleteMessages(["msg-2"]);
		await dom().flush();

		assert.deepEqual(ids(dom(), sentKey), []);
		assert.deepEqual(ids(dom(), inboxKey), ["msg-1"]);
	});

	it("does nothing at all for an empty selection", async () => {
		const hook = mountHook(() => useDeleteMessages({ mailboxId: INBOX }));

		hook.current().deleteMessages([]);
		await dom().flush();

		assert.deepEqual(http.calls, []);
		assert.deepEqual(ids(dom(), inboxKey), ["msg-1"]);
	});

	it("puts the row back and says so when the server refuses", async () => {
		http.restore();
		http = mockFetch(() => httpError(409, "mailbox is locked"));
		const hook = mountHook(() => useDeleteMessages({ mailboxId: INBOX }));

		hook.current().deleteMessages(["msg-1"]);
		await dom().flush();

		assert.deepEqual(ids(dom(), inboxKey), ["msg-1"]);
		assert.deepEqual(ids(dom(), briefKey), ["msg-1", "msg-2"]);
		assert.match(dom().text(), /Couldn't delete this message/);
	});

	it("counts the messages in the failure it reports", async () => {
		http.restore();
		http = mockFetch(() => httpError(409));
		const hook = mountHook(() => useDeleteMessages({ mailboxId: INBOX }));

		hook.current().deleteMessages(["msg-1", "msg-2"]);
		await dom().flush();

		assert.match(dom().text(), /Couldn't delete 2 messages/);
	});
});

describe("moving between folders", () => {
	it("takes the row out of the source listing straight away", async () => {
		const hook = mountHook(() => useMoveMessages({ mailboxId: INBOX }));

		hook.current().moveMessages(["msg-1"], ARCHIVE);
		await dom().flush();

		assert.deepEqual(ids(dom(), inboxKey), []);
		const [moved] = http.calls;
		assert.equal(moved?.body?.destinationMailboxId, ARCHIVE);
	});

	it("restores the source listing when the move fails", async () => {
		http.restore();
		http = mockFetch(() => httpError(409));
		const hook = mountHook(() => useMoveMessages({ mailboxId: INBOX }));

		hook.current().moveMessages(["msg-1"], ARCHIVE);
		await dom().flush();

		assert.deepEqual(ids(dom(), inboxKey), ["msg-1"]);
		assert.match(dom().text(), /Couldn't move/);
	});
});

describe("starring a message", () => {
	it("stars the row in the mailbox it lives in, not the browsed one (#46)", async () => {
		const hook = mountHook(() =>
			useToggleStar({
				threadId: "thread-1",
				mailboxId: INBOX,
				messages: [inboxRow, sentRow],
			}),
		);

		hook.current().toggleStar("msg-2", false);
		await dom().flush();

		assert.equal(rows(dom(), sentKey)[0].hasStars, true);
		assert.equal(rows(dom(), inboxKey)[0].hasStars, false);
	});

	it("unstars a starred message", async () => {
		const hook = mountHook(() =>
			useToggleStar({ threadId: "thread-1", mailboxId: INBOX }),
		);

		hook.current().toggleStar("msg-1", false);
		await dom().flush();
		assert.equal(rows(dom(), inboxKey)[0].hasStars, true);

		hook.current().toggleStar("msg-1", true);
		await dom().flush();
		assert.equal(rows(dom(), inboxKey)[0].hasStars, false);
	});

	it("rolls the star back and names the direction that failed", async () => {
		http.restore();
		http = mockFetch(() => httpError(409));
		const hook = mountHook(() =>
			useToggleStar({ threadId: "thread-1", mailboxId: INBOX }),
		);

		hook.current().toggleStar("msg-1", false);
		await dom().flush();

		assert.equal(rows(dom(), inboxKey)[0].hasStars, false);
		assert.match(dom().text(), /Couldn't star message/);
	});
});

describe("marking a selection read", () => {
	it("sends the ids and the direction the caller asked for", async () => {
		const hook = mountHook(() => useToggleReadFor({ mailboxId: INBOX }));

		hook.current().toggleReadFor(["msg-1"], true);
		await dom().flush();

		const [call] = http.calls;
		assert.equal(call?.path, "/messages/flags");
		assert.deepEqual(call?.body?.messageIds, ["msg-1"]);
		assert.equal(call?.body?.isRead, true);
	});

	it("stays quiet for an empty selection", async () => {
		const hook = mountHook(() => useToggleReadFor({ mailboxId: INBOX }));

		hook.current().toggleReadFor([], true);
		await dom().flush();

		assert.deepEqual(http.calls, []);
	});

	it("says which way it failed — read, not unread", async () => {
		http.restore();
		http = mockFetch(() => httpError(409));
		const hook = mountHook(() => useToggleReadFor({ mailboxId: INBOX }));

		hook.current().toggleReadFor(["msg-1"], false);
		await dom().flush();

		assert.match(dom().text(), /Couldn't mark as unread/);
	});
});
