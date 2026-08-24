/**
 * Issue #924: the send watch decided its next tick from the polled status
 * alone. A 5xx carries no status, so nothing matched, the interval stayed at two
 * seconds, and every failed tick reached the query cache and escalated again —
 * one overlay for the user, a fresh fatal event with a fresh correlation id for
 * telemetry, for the whole minute the cap allowed.
 *
 * A poll the server refuses is over. It escalates once, the watch comes down,
 * and the outbox list is invalidated so the row's real state is what the user
 * reads next.
 */

import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { outboxOperationsListOutboxMessagesQueryKey } from "@remit/api-http-client/@tanstack/react-query.gen.ts";
import { QueryCache, QueryClient } from "@tanstack/react-query";
import { createElement, useEffect } from "react";
import { __resetFatalError, subscribeFatalError } from "../../lib/fatal-error";
import { handleQueryCacheError } from "../../lib/query-error-handler";
import { createDomHarness, type DomHarness } from "../../test-support/dom";
import { type HttpMock, httpError, mockFetch } from "../../test-support/http";
import { ComposeProvider, useCompose } from "./ComposeProvider";

const OUTBOX_MESSAGE_ID = "ob-924";
const POLL_INTERVAL_MS = 2000;

let harness: DomHarness | undefined;
let http: HttpMock | undefined;
let fatals = 0;
let unsubscribe: (() => void) | undefined;

afterEach(() => {
	harness?.close();
	harness = undefined;
	http?.restore();
	http = undefined;
	unsubscribe?.();
	unsubscribe = undefined;
	fatals = 0;
	__resetFatalError();
});

const polls = (): number =>
	(http?.calls ?? []).filter(
		(call) => call.method === "GET" && call.path.endsWith(OUTBOX_MESSAGE_ID),
	).length;

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

const mount = async (pollStatus: number): Promise<void> => {
	http = mockFetch(async (call) => {
		if (call.path.endsWith(OUTBOX_MESSAGE_ID)) {
			return httpError(pollStatus, "the outbox is having a moment");
		}
		return { messages: [] };
	});

	unsubscribe = subscribeFatalError(() => {
		fatals += 1;
	});

	const queryClient = new QueryClient({
		queryCache: new QueryCache({ onError: handleQueryCacheError }),
		// The watch sets its own retry policy; a zero delay only spares the test
		// the backoff it would otherwise sit through.
		defaultOptions: { queries: { retryDelay: 0 }, mutations: { retry: false } },
	});

	harness = createDomHarness({ queryClient });
	queryClient.setQueryData(outboxOperationsListOutboxMessagesQueryKey(), {
		messages: [],
	});
	harness.renderApp(
		createElement(ComposeProvider, null, createElement(Sender)),
	);
	await harness.flush();
};

describe("a send watch the server refuses (#924)", () => {
	it("escalates once and stops polling", async () => {
		await mount(500);
		await harness?.wait(POLL_INTERVAL_MS * 3);

		assert.equal(fatals, 1, "the refusal escalated exactly once");
		assert.equal(
			polls(),
			2,
			"the read was attempted once and retried once, then the watch came down",
		);
	});

	it("invalidates the outbox list so the row's real state is on screen", async () => {
		await mount(500);
		await harness?.wait(POLL_INTERVAL_MS);

		assert.ok(outboxListIsStale(), "the outbox list was marked for a refetch");
	});

	it("leaves the settled 404 alone — one stop, no escalation", async () => {
		await mount(404);
		await harness?.wait(POLL_INTERVAL_MS * 2);

		assert.equal(fatals, 0, "the deleted row is the confirmation, not a fault");
		assert.equal(polls(), 1, "a 404 is not retried and not polled again");
	});
});
