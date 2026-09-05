/**
 * Issue #1040: the send watch counted `sent` as its answer and came down on it.
 *
 * `sent` is the window between SMTP handing the message over and the APPEND
 * either filing it — row deleted, 404 — or settling it `unfiled`. It is a few
 * tens of milliseconds wide and the watch's first read lands inside it perhaps
 * one send in twenty, which is where the e2e flake came from. What the user got
 * when it did land there is worse than a flake: the watch stopped, invalidated
 * the outbox list over a row the list does not render, and never asked again —
 * so a message that went out unfiled was on no screen at all, which is the very
 * state #824 exists to prevent.
 */

import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { outboxOperationsListOutboxMessagesQueryKey } from "@remit/api-http-client/@tanstack/react-query.gen.ts";
import { createElement, useEffect } from "react";
import { createDomHarness, type DomHarness } from "../../test-support/dom";
import { type HttpMock, mockFetch } from "../../test-support/http";
import { ComposeProvider, useCompose } from "./ComposeProvider";

const OUTBOX_MESSAGE_ID = "ob-1040";
const POLL_INTERVAL_MS = 2000;

const UNFILED_REASON =
	"Sent, but not filed: this account has no folder appointed to the Sent role.";

let harness: DomHarness | undefined;
let http: HttpMock | undefined;
let status = "sent";

afterEach(() => {
	harness?.close();
	harness = undefined;
	http?.restore();
	http = undefined;
	status = "sent";
});

const polls = (): number => (http?.to(OUTBOX_MESSAGE_ID) ?? []).length;

const outboxListIsStale = (): boolean =>
	harness?.queryClient
		.getQueryCache()
		.find({ queryKey: outboxOperationsListOutboxMessagesQueryKey() })?.state
		.isInvalidated === true;

const Sender = () => {
	const { startSendPolling } = useCompose();

	useEffect(() => {
		startSendPolling(OUTBOX_MESSAGE_ID);
	}, [startSendPolling]);

	return null;
};

const mount = async (): Promise<void> => {
	http = mockFetch((call) => {
		if (call.path.endsWith(OUTBOX_MESSAGE_ID)) {
			return {
				outboxMessageId: OUTBOX_MESSAGE_ID,
				status,
				lastError: status === "unfiled" ? UNFILED_REASON : undefined,
			};
		}
		return { messages: [] };
	});

	harness = createDomHarness();
	harness.queryClient.setQueryData(
		outboxOperationsListOutboxMessagesQueryKey(),
		{ messages: [] },
	);
	harness.renderApp(
		createElement(ComposeProvider, null, createElement(Sender)),
	);
	await harness.flush();
};

const reachedPolls = async (count: number): Promise<void> => {
	await harness?.waitFor(
		() => polls() >= count,
		`the watch to have read the row ${count} times`,
		POLL_INTERVAL_MS * count + POLL_INTERVAL_MS,
	);
};

describe("a send whose filing is still owed (#1040)", () => {
	it("keeps asking while the row reads sent", async () => {
		await mount();
		await reachedPolls(1);

		assert.ok(
			!outboxListIsStale(),
			"nothing was settled, so nothing refetched",
		);

		await reachedPolls(3);
		assert.ok(
			!outboxListIsStale(),
			"`sent` is not an answer the watch stops on",
		);
	});

	it("stops on the unfiled row, and only then refetches the list", async () => {
		await mount();
		await reachedPolls(2);

		status = "unfiled";
		await harness?.waitFor(
			() => outboxListIsStale(),
			"the watch to settle on the unfiled row and invalidate the list",
			POLL_INTERVAL_MS * 3,
		);

		const settled = polls();
		await harness?.wait(POLL_INTERVAL_MS * 2);
		assert.equal(polls(), settled, "the settled row ended the watch");
	});
});
