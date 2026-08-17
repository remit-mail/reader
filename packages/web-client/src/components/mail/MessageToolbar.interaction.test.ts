/**
 * The inline notice under the toolbar belongs to the press that produced it and
 * to nothing after it (#818). It came out of #803 as a stored sentence with no
 * reset, and #807 took away the render gate that had been hiding it, so one
 * refused press labelled every later message on the pane.
 *
 * Two invariants hold underneath: no press ends in silence, and no sentence
 * outlives the reason it was written for.
 */

import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { mailboxOperationsListMailboxesQueryKey } from "@remit/api-http-client/@tanstack/react-query.gen.ts";
import { createElement } from "react";
import { createDomHarness, type DomHarness } from "../../test-support/dom";
import { makeMailbox } from "../../test-support/fixtures";
import { MessageToolbar, type MessageToolbarProps } from "./MessageToolbar";

let harness: DomHarness | undefined;

afterEach(() => {
	harness?.close();
	harness = undefined;
});

const VERBS = [
	"Reply",
	"Reply all",
	"Forward",
	"Move to Trash",
	"Move to mailbox",
	"Star",
];

const show = (
	mounted: DomHarness,
	props: Partial<MessageToolbarProps>,
): void => {
	mounted.renderApp(
		createElement(MessageToolbar, {
			hasThread: true,
			intelligenceOpen: false,
			canToggleIntelligence: false,
			onToggleIntelligence: () => undefined,
			...props,
		}),
	);
};

/** A fresh pane. */
const mount = (props: Partial<MessageToolbarProps>): DomHarness => {
	harness?.close();
	harness = createDomHarness();
	show(harness, props);
	return harness;
};

/** The same pane, re-rendered — state survives, as it does under a navigation
 *  the router answers without remounting. */
const update = (props: Partial<MessageToolbarProps>): void => {
	if (!harness) throw new Error("nothing mounted");
	show(harness, props);
};

const notice = (mounted: DomHarness): string | null =>
	mounted.query('[role="status"]')?.textContent ?? null;

const press = async (mounted: DomHarness, label: string): Promise<void> => {
	mounted.click(mounted.byLabel(label));
	await mounted.flush();
};

describe("no toolbar press ends in silence (#818)", () => {
	for (const label of VERBS) {
		it(`${label} explains itself with nothing open, handler or no handler`, async () => {
			let acted = 0;
			const act = () => {
				acted += 1;
			};
			const mounted = mount({
				hasThread: false,
				messageId: undefined,
				onReply: act,
				onReplyAll: act,
				onForward: act,
				onDelete: act,
				onToggleStar: act,
			});

			await press(mounted, label);

			assert.ok(
				notice(mounted),
				`${label} did nothing and said nothing — the worst outcome`,
			);
			assert.equal(acted, 0, `${label} acted with no message open`);
		});
	}
});

describe("the toolbar notice clears when its reason goes (#818)", () => {
	it("takes the notice down when another message opens", async () => {
		const mounted = mount({ messageId: "message-1" });

		await press(mounted, "Reply");
		assert.match(
			notice(mounted) ?? "",
			/hasn't loaded yet/,
			"a press with no handler behind it must explain itself",
		);

		update({ messageId: "message-2" });
		await mounted.flush();

		assert.equal(
			notice(mounted),
			null,
			"the sentence belongs to the message it was pressed on, not the next one",
		);
	});

	it("invites the press again once the verb it named can act", async () => {
		const mounted = mount({ messageId: "message-1" });

		await press(mounted, "Reply");
		assert.match(notice(mounted) ?? "", /hasn't loaded yet/);

		update({ messageId: "message-1", onReply: () => undefined });
		await mounted.flush();

		assert.match(
			notice(mounted) ?? "",
			/Reply is ready — press it again/,
			"the press was never acted on; dropping the notice drops it silently",
		);
	});

	it("lets a verb that acts take down an earlier verb's complaint", async () => {
		let starred = 0;
		const mounted = mount({
			messageId: "message-1",
			onToggleStar: () => {
				starred += 1;
			},
		});

		await press(mounted, "Reply");
		assert.match(notice(mounted) ?? "", /hasn't loaded yet/);

		await press(mounted, "Star");

		assert.equal(starred, 1);
		assert.equal(
			notice(mounted),
			null,
			"a star that worked must not sit under a sentence saying nothing loaded",
		);
	});
});

describe("a loading action is not an unavailable one (#818)", () => {
	const openMessage: Partial<MessageToolbarProps> = {
		messageId: "message-1",
		onReply: () => undefined,
		onDelete: () => undefined,
		onToggleStar: () => undefined,
	};

	it("does not tell the reader to open a message that is already open", async () => {
		const mounted = mount({
			...openMessage,
			moveContext: undefined,
			moveContextLoading: true,
		});

		await press(mounted, "Move to mailbox");

		const said = notice(mounted);
		assert.ok(said, "a Move press must never be swallowed in silence");
		assert.doesNotMatch(
			said,
			/Open a message first/,
			"the message is on screen — the mailbox list is what has not arrived",
		);
		assert.match(said, /mailbox list hasn't loaded yet/);
	});

	it("does not promise a lookup that already settled with nothing", async () => {
		const mounted = mount({
			...openMessage,
			moveContext: undefined,
			moveContextLoading: false,
		});

		await press(mounted, "Move to mailbox");

		const said = notice(mounted);
		assert.ok(said);
		assert.doesNotMatch(
			said,
			/hasn't loaded yet/,
			"nothing is in flight — waiting will never make this one arrive",
		);
		assert.match(said, /reload to try again/, "a dead end needs a next step");
	});

	it("still says why with nothing open at all", async () => {
		const mounted = mount({ hasThread: false });

		await press(mounted, "Move to mailbox");

		assert.match(notice(mounted) ?? "", /Open a message first/);
	});

	it("carries a Move pressed during the lookup through to the picker", async () => {
		const mounted = mount({
			...openMessage,
			moveContext: undefined,
			moveContextLoading: true,
		});
		mounted.queryClient.setQueryData(
			mailboxOperationsListMailboxesQueryKey({ path: { accountId: "acc-1" } }),
			{ items: [makeMailbox({ mailboxId: "mbx-work", fullPath: "Work" })] },
		);

		await press(mounted, "Move to mailbox");

		update({
			...openMessage,
			moveContextLoading: false,
			moveContext: {
				accountId: "acc-1",
				currentMailboxId: "mbx-inbox",
				onMove: () => undefined,
			},
		});
		await mounted.flush();

		assert.equal(
			mounted.byLabel("Move to mailbox").getAttribute("aria-expanded"),
			"true",
			"the press asked for the picker; the context arriving must not lose it",
		);
		assert.equal(
			notice(mounted),
			null,
			"the press was honoured, so there is nothing left to repeat",
		);
	});
});
