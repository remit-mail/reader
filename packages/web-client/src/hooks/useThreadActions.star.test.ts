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
	/** Defaults to the reading pane's case: this thread is the one on screen. */
	isOpen?: boolean;
}) => {
	const { server, isOpen = true } = options;
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
		const actions = useThreadActions({ thread, isOpen });
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

const conversationRequests = (): number =>
	http?.to(`/threads/${THREAD_ID}/messages`).length ?? 0;

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

		// Nothing is put into the cache by hand here: the settle-invalidate has
		// to re-read the conversation, which the mock now serves starred. Seeding
		// it would make the second press pass even if the refresh never happened.
		await dom.wait(20);
		await dom.flush();
		assert.equal(
			rendersStarred(dom),
			true,
			"the star lights from the refreshed conversation",
		);

		dom.click(starButton(dom));
		await dom.flush();
		assert.equal(server.starred, false, "the second press unstars");
		assert.deepEqual(starRequests(), [true, false]);
	});

	it("asks for no conversation for a thread the pane has not opened", async () => {
		// The triage cursor moves a row at a time. A conversation pulled for the
		// row under the cursor would be a request per keystroke, so a target that
		// is not the open thread answers from its own listing row.
		const dom = await mountToolbar({
			server: { starred: false },
			row: { hasStars: true },
			isOpen: false,
		});

		assert.equal(conversationRequests(), 0);
		assert.equal(
			rendersStarred(dom),
			true,
			"the cursor target answers from the row it came from",
		);
	});
});
