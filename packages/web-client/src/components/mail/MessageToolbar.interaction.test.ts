/**
 * The inline notice under the toolbar belongs to the press that produced it and
 * to nothing after it (#818). It came out of #803 as a stored sentence with no
 * reset, and #807 took away the render gate that had been hiding it, so one
 * refused press labelled every later message on the pane.
 */

import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { createElement } from "react";
import { createDomHarness, type DomHarness } from "../../test-support/dom";
import { MessageToolbar, type MessageToolbarProps } from "./MessageToolbar";

let harness: DomHarness | undefined;

afterEach(() => {
	harness?.close();
	harness = undefined;
});

const mount = (props: Partial<MessageToolbarProps>): DomHarness => {
	const mounted = harness ?? createDomHarness();
	harness = mounted;
	mounted.renderApp(
		createElement(MessageToolbar, {
			hasThread: true,
			intelligenceOpen: false,
			canToggleIntelligence: false,
			onToggleIntelligence: () => undefined,
			...props,
		}),
	);
	return mounted;
};

const notice = (mounted: DomHarness): string | null =>
	mounted.query('[role="status"]')?.textContent ?? null;

const press = async (mounted: DomHarness, label: string): Promise<void> => {
	mounted.click(mounted.byLabel(label));
	await mounted.flush();
};

describe("the toolbar notice clears when its reason goes (#818)", () => {
	it("takes the notice down when another message opens", async () => {
		const mounted = mount({ messageId: "message-1" });

		await press(mounted, "Reply");
		assert.match(
			notice(mounted) ?? "",
			/hasn't loaded yet/,
			"a press with no handler behind it must explain itself",
		);

		mount({ messageId: "message-2" });
		await mounted.flush();

		assert.equal(
			notice(mounted),
			null,
			"the sentence belongs to the message it was pressed on, not the next one",
		);
	});

	it("takes the notice down once the verb it named can act", async () => {
		const mounted = mount({ messageId: "message-1" });

		await press(mounted, "Reply");
		assert.match(notice(mounted) ?? "", /hasn't loaded yet/);

		mount({ messageId: "message-1", onReply: () => undefined });
		await mounted.flush();

		assert.equal(notice(mounted), null);
	});
});

describe("a loading action is not an unavailable one (#818)", () => {
	it("does not tell the reader to open a message that is already open", async () => {
		const mounted = mount({
			messageId: "message-1",
			onReply: () => undefined,
			onDelete: () => undefined,
			onToggleStar: () => undefined,
			moveContext: undefined,
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

	it("still says why with nothing open at all", async () => {
		const mounted = mount({ hasThread: false });

		await press(mounted, "Move to mailbox");

		assert.match(notice(mounted) ?? "", /Open a message first/);
	});
});
