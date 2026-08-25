/**
 * Regression cover for issue #602 — the reading pane's star did not toggle and
 * never showed the open message as starred.
 *
 * Both symptoms were one cause: the control answered from the list row that
 * represented the conversation, not from the conversation. A row is a copy that
 * stops being refreshed the moment the mail no longer matches the browsed
 * predicate, so the star read unstarred however many times it had been set, and
 * every press asked the server to star a message that already was.
 *
 * Each case mounts the real toolbar over a mocked server and lets the
 * conversation's own listing disagree with the stale list row.
 */
import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { threadDetailOperationsListThreadMessagesQueryKey } from "@remit/api-http-client/@tanstack/react-query.gen.ts";
import type { RemitImapThreadMessageResponse } from "@remit/api-http-client/types.gen.ts";
import { createElement } from "react";
import { MessageToolbar } from "@/components/mail/MessageToolbar";
import { useThreadActions } from "@/hooks/useThreadActions";
import { createDomHarness, type DomHarness } from "../test-support/dom";
import { makeConfig, makeThreadMessage } from "../test-support/fixtures";
import { type HttpMock, mockFetch } from "../test-support/http";

const MESSAGE_ID = "msg-1";
const THREAD_ID = "thread-1";

let harness: DomHarness | undefined;
let http: HttpMock | undefined;

afterEach(() => {
	harness?.close();
	harness = undefined;
	http?.restore();
	http = undefined;
});

interface ServerState {
	starred: boolean;
}

const conversationKey = threadDetailOperationsListThreadMessagesQueryKey({
	path: { threadId: THREAD_ID },
});

const conversationRow = (starred: boolean) =>
	makeThreadMessage({
		messageId: MESSAGE_ID,
		threadId: THREAD_ID,
		hasStars: starred,
	});

/**
 * The message as the conversation endpoint serves it, and the list row as the
 * mailbox listing served it — which is deliberately allowed to disagree.
 */
const mountToolbar = async (options: {
	server: ServerState;
	row: Partial<RemitImapThreadMessageResponse>;
}) => {
	const { server } = options;
	http = mockFetch((call) => {
		if (call.method === "PATCH") {
			const body = call.body as { isStarred?: boolean } | undefined;
			server.starred = body?.isStarred === true;
			return {
				messageId: MESSAGE_ID,
				isRead: true,
				isStarred: server.starred,
			};
		}
		if (call.path.includes("/config")) return makeConfig([]);
		if (call.path.endsWith(`/threads/${THREAD_ID}/messages`)) {
			return { items: [conversationRow(server.starred)] };
		}
		return { items: [] };
	});

	const thread = makeThreadMessage({
		messageId: MESSAGE_ID,
		threadId: THREAD_ID,
		...options.row,
	});

	const Harness = () => {
		const actions = useThreadActions({ thread });
		return createElement(MessageToolbar, {
			hasThread: true,
			intelligenceOpen: false,
			canToggleIntelligence: false,
			onToggleIntelligence: () => undefined,
			onToggleStar: actions.toggleStar,
			isStarred: actions.isStarred,
		});
	};

	harness = createDomHarness();
	// The conversation as the server has it, in the cache before the first
	// render — the pane answers from this, not from the list row.
	harness.queryClient.setQueryData(conversationKey, {
		items: [conversationRow(server.starred)],
	});
	harness.renderApp(createElement(Harness));
	await harness.flush();
	await harness.wait(20);
	await harness.flush();
	return harness;
};

const starButton = (dom: DomHarness) => dom.byLabel("Star");

const rendersStarred = (dom: DomHarness): boolean =>
	starButton(dom).getAttribute("aria-pressed") === "true";

const starRequests = (): Array<boolean | undefined> =>
	(http?.calls ?? [])
		.filter((call) => call.method === "PATCH")
		.map(
			(call) => (call.body as { isStarred?: boolean } | undefined)?.isStarred,
		);

describe("the reading pane's star follows the open message (#602)", () => {
	it("shows the message starred when the conversation says so, though its list row does not", async () => {
		const dom = await mountToolbar({
			server: { starred: true },
			// What the mailbox listing last said about this message, from before
			// it was starred — the state the pane used to answer from (#602).
			row: { hasStars: false },
		});

		assert.equal(
			rendersStarred(dom),
			true,
			"the star answers from the conversation, not the list row",
		);
	});

	it("asks for the star to come off when a lit star is pressed", async () => {
		const server: ServerState = { starred: true };
		const dom = await mountToolbar({ server, row: { hasStars: false } });

		dom.click(starButton(dom));
		await dom.flush();
		assert.deepEqual(
			starRequests(),
			[false],
			"pressing a lit star unstars the message",
		);
	});

	it("stars, then unstars, on consecutive presses", async () => {
		const server: ServerState = { starred: false };
		const dom = await mountToolbar({ server, row: { hasStars: false } });
		assert.equal(rendersStarred(dom), false);

		dom.click(starButton(dom));
		await dom.flush();
		assert.equal(server.starred, true);
		assert.deepEqual(starRequests(), [true]);

		// The conversation now carries the star; the next press has to ask for
		// it to come off rather than asking for the same star again.
		dom.queryClient.setQueryData(conversationKey, {
			items: [conversationRow(true)],
		});
		await dom.flush();

		dom.click(starButton(dom));
		await dom.flush();
		assert.equal(server.starred, false, "the second press unstars");
		assert.deepEqual(starRequests(), [true, false]);
	});
});
