/**
 * useStarredThreads — regression cover for issue #70.
 *
 * The Starred pane rendered its rows from `GET /threads?starred=true` but
 * resolved the open thread from the unfiltered (INBOX-scoped) listing. Rows for
 * starred mail filed outside INBOX therefore had nothing to resolve to and
 * opened no reading pane.
 *
 * Strategy follows useRescueCandidates.test.ts: pre-seed a QueryClient under the
 * key the hook generates and render it synchronously, so the queryFn never
 * fires. The last two cases are the ones that fail if the wrong listing comes
 * back — the unfiltered key is seeded alongside and must not be read.
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { unifiedThreadOperationsListAllThreadsQueryKey } from "@remit/api-http-client/@tanstack/react-query.gen.ts";
import type { RemitImapThreadMessageResponse } from "@remit/api-http-client/types.gen.ts";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import {
	starredThreadsQueryKey,
	useStarredThreads,
} from "./useStarredThreads.js";

interface Page {
	items: RemitImapThreadMessageResponse[];
	continuationToken?: string;
}

function makeThread(
	messageId: string,
	overrides: Partial<RemitImapThreadMessageResponse> = {},
): RemitImapThreadMessageResponse {
	return {
		messageId,
		threadMessageId: `tm-${messageId}`,
		threadId: `t-${messageId}`,
		accountConfigId: "acc",
		mailboxId: "mb-inbox",
		sentDate: 1_000_000,
		isRead: false,
		hasAttachment: false,
		hasStars: true,
		isDeleted: false,
		createdAt: 1_000_000,
		updatedAt: 1_000_000,
		fromName: "Anna de Vries",
		fromEmail: "anna@example.nl",
		subject: `subject ${messageId}`,
		snippet: "…",
		senderTrust: "vip",
		...overrides,
	} as RemitImapThreadMessageResponse;
}

/**
 * Renders the hook against a cache holding `starredPages` under the starred key
 * and `unfilteredItems` under the unfiltered one, so a hook reading the wrong
 * listing returns the wrong threads instead of returning nothing.
 */
function renderHook(
	starredPages: Page[],
	unfilteredItems: RemitImapThreadMessageResponse[] = [],
): RemitImapThreadMessageResponse[] {
	const client = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	client.setQueryData(starredThreadsQueryKey(), {
		pages: starredPages,
		pageParams: starredPages.map((_, index) =>
			index === 0 ? undefined : `page-${index}`,
		),
	});
	client.setQueryData(unifiedThreadOperationsListAllThreadsQueryKey(), {
		items: unfilteredItems,
	});

	let captured: RemitImapThreadMessageResponse[] = [];

	function Capture() {
		captured = useStarredThreads().threads;
		return null;
	}

	renderToString(
		createElement(
			QueryClientProvider,
			{ client },
			createElement(Capture),
		) as never,
	);

	return captured;
}

describe("starredThreadsQueryKey", () => {
	test("asks for the starred listing, newest first", () => {
		const [params] = starredThreadsQueryKey() as [
			{ query?: { starred?: boolean; order?: string } },
		];
		assert.equal(params.query?.starred, true);
		assert.equal(params.query?.order, "desc");
	});
});

describe("useStarredThreads", () => {
	test("returns no threads when the listing is empty", () => {
		assert.deepEqual(renderHook([{ items: [] }]), []);
	});

	test("flattens every loaded page, in page order", () => {
		const threads = renderHook([
			{ items: [makeThread("m1"), makeThread("m2")], continuationToken: "p2" },
			{ items: [makeThread("m3")] },
		]);
		assert.deepEqual(
			threads.map((thread) => thread.messageId),
			["m1", "m2", "m3"],
		);
	});

	test("returns a starred thread that lives outside INBOX", () => {
		// The case issue #70 could not open: starred, filed in Sent, and absent
		// from the unfiltered listing the pane used to resolve against.
		const sent = makeThread("m-sent", { mailboxId: "mb-sent" });
		const threads = renderHook([{ items: [sent] }], [makeThread("m-inbox")]);
		assert.deepEqual(
			threads.map((thread) => thread.messageId),
			["m-sent"],
		);
		assert.equal(
			threads.find((thread) => thread.messageId === "m-sent")?.mailboxId,
			"mb-sent",
		);
	});

	test("does not read the unfiltered INBOX listing", () => {
		const threads = renderHook([{ items: [] }], [makeThread("m-inbox")]);
		assert.deepEqual(threads, []);
	});
});
