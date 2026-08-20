/**
 * What every intelligence-surface spec needs to poke one: the message the
 * reading pane reads its headers from, the settle the router and the query
 * client both need, and the drawer as the DOM names it.
 *
 * The thread row itself is each spec's own, because the DKIM mismatch that
 * raises the authenticity banner also raises the rail wherever the rail fits.
 */

import type { DomHarness } from "@/test-support/dom";

export const THREAD_ID = "thread-1";
export const MESSAGE_ID = "msg-1";

/** What the reading pane reads each message's own headers and body from. */
export const describedMessage = {
	messageId: MESSAGE_ID,
	envelope: {
		from: [
			{
				addressId: "addr-1",
				name: "Mondial Relay",
				email: "delivery.notice@gmail.example",
			},
		],
		to: [],
		cc: [],
		bcc: [],
	},
	bodyParts: [],
};

/** Let the router commit, the queries land, and the render that follows run. */
export const settle = async (mounted: DomHarness): Promise<void> => {
	await mounted.flush();
	await mounted.wait(20);
	await mounted.flush();
};

/** The intelligence drawer, by the role and label it publishes. */
export const intelligenceDrawer = (mounted: DomHarness): HTMLElement | null =>
	mounted.query('[role="dialog"][aria-label="Message details"]');
