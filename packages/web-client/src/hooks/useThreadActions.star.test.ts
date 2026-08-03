/**
 * Regression cover for issue #602 — the reading pane's star did not toggle and
 * never showed the open message as starred.
 *
 * Both symptoms were one cause: the control answered from the list row that
 * represented the conversation, not from the conversation. A row is a copy that
 * stops being refreshed the moment the mail no longer matches the browsed
 * predicate, so the star read `none` however many times it had been set, and
 * every press asked the server to star a message that already was.
 *
 * The cases below drive the real toolbar over a mocked server: what the control
 * renders, and what the second press asks for.
 */
import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import type { RemitImapThreadMessageResponse } from "@remit/api-http-client/types.gen.ts";
import { createElement } from "react";
import { MessageToolbar } from "@/components/mail/MessageToolbar";
import { useThreadActions } from "@/hooks/useThreadActions";
import { isStarred } from "@/lib/star";
import { createDomHarness, type DomHarness } from "../test-support/dom";
import { makeThreadMessage } from "../test-support/fixtures";
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
		if (call.path.endsWith(`/threads/${THREAD_ID}/messages`)) {
			return {
				items: [
					makeThreadMessage({
						messageId: MESSAGE_ID,
						threadId: THREAD_ID,
						hasStars: server.starred,
						star: server.starred ? "yellow" : "none",
					}),
				],
			};
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
			isStarred: isStarred(actions.star),
		});
	};

	harness = createDomHarness();
	harness.renderApp(createElement(Harness));
	await harness.flush();
	// The conversation is a real request through the mocked fetch; let it land
	// before anything is asserted about what the toolbar shows.
	await harness.wait(0);
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
	it("stars, then unstars, on consecutive presses", async () => {
		const server: ServerState = { starred: false };
		const dom = await mountToolbar({
			server,
			row: { hasStars: false, star: "none" },
		});
		assert.equal(rendersStarred(dom), false);

		dom.click(starButton(dom));
		await dom.flush();
		assert.equal(
			rendersStarred(dom),
			true,
			"the star shows the message starred",
		);
		assert.equal(server.starred, true);

		dom.click(starButton(dom));
		await dom.flush();
		assert.equal(rendersStarred(dom), false);
		assert.equal(server.starred, false, "the second press unstars the message");
		assert.deepEqual(starRequests(), [true, false]);
	});

	it("shows the message starred when the list row it was opened from is stale", async () => {
		const server: ServerState = { starred: true };
		const dom = await mountToolbar({
			server,
			// What the mailbox listing last said about this message, from before it
			// was starred — the state the pane used to answer from.
			row: { hasStars: false, star: "none" },
		});

		assert.equal(rendersStarred(dom), true);

		dom.click(starButton(dom));
		await dom.flush();
		assert.deepEqual(
			starRequests(),
			[false],
			"pressing a lit star asks for the star to come off",
		);
		assert.equal(server.starred, false);
		assert.equal(rendersStarred(dom), false);
	});
});
