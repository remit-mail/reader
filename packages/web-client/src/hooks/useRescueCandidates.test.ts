/**
 * useRescueCandidates — exercises the real hook.
 *
 * Strategy: pre-seed a QueryClient cache with a mocked
 * threadOperationsSearchThreads response (same key the hook generates), then
 * render the hook synchronously via renderToString + QueryClientProvider. The
 * hook reads from the cache, so the queryFn never fires; mapping drift in the
 * hook source will break these assertions.
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { threadOperationsSearchThreadsQueryKey } from "@remit/api-http-client/@tanstack/react-query.gen.ts";
import type {
	RemitImapSenderTrust,
	RemitImapThreadMessageResponse,
	RemitImapThreadSearchResponse,
} from "@remit/api-http-client/types.gen.ts";
import type { RescueCandidate } from "@remit/ui";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { useRescueCandidates } from "./useRescueCandidates.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const JUNK_MAILBOX_ID = "mb-junk";

/** Query options the hook passes — must stay in sync with useRescueCandidates.ts */
const HOOK_QUERY_OPTIONS = {
	path: { mailboxId: JUNK_MAILBOX_ID },
	query: {
		senderTrust: ["vip", "wellknown"] as RemitImapSenderTrust[],
		dkimMismatch: false,
		results: true,
		limit: 500,
	},
};

function makeThread(
	overrides: Partial<RemitImapThreadMessageResponse> &
		Pick<RemitImapThreadMessageResponse, "messageId" | "senderTrust">,
): RemitImapThreadMessageResponse {
	return {
		threadMessageId: `tm-${overrides.messageId}`,
		threadId: `t-${overrides.messageId}`,
		accountConfigId: "acc",
		mailboxId: JUNK_MAILBOX_ID,
		sentDate: 1_000_000,
		isRead: false,
		hasAttachment: false,
		hasStars: false,
		isDeleted: false,
		createdAt: 1_000_000,
		updatedAt: 1_000_000,
		fromName: "Anna de Vries",
		fromEmail: "anna@example.nl",
		subject: "Re: invoice",
		snippet: "See attached.",
		...overrides,
	} as RemitImapThreadMessageResponse;
}

/**
 * Pre-seeds a QueryClient with `response` under the key the hook generates,
 * renders the hook synchronously inside a QueryClientProvider, and returns
 * whatever the hook returned.
 */
function renderHookWithResponse(response: RemitImapThreadSearchResponse): {
	candidates: RescueCandidate[];
} {
	const client = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	client.setQueryData(
		threadOperationsSearchThreadsQueryKey(HOOK_QUERY_OPTIONS),
		response,
	);

	let captured: { candidates: RescueCandidate[] } = { candidates: [] };

	function Capture() {
		captured = useRescueCandidates(JUNK_MAILBOX_ID);
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

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("useRescueCandidates: empty / disabled states", () => {
	test("returns empty candidates when the response has no items", () => {
		const { candidates } = renderHookWithResponse({ items: [] });
		assert.deepEqual(candidates, []);
	});

	test("returns empty candidates and does not fire when junkMailboxId is undefined", () => {
		const client = new QueryClient({
			defaultOptions: { queries: { retry: false } },
		});

		// Prove the query was never seeded — so if enabled fired, it would hang
		let captured: { candidates: RescueCandidate[] } = { candidates: [] };

		function Capture() {
			captured = useRescueCandidates(undefined);
			return null;
		}

		renderToString(
			createElement(
				QueryClientProvider,
				{ client },
				createElement(Capture),
			) as never,
		);

		assert.deepEqual(captured.candidates, []);
	});
});

describe("useRescueCandidates: candidate mapping from real hook output", () => {
	const vipThread = makeThread({ messageId: "m1", senderTrust: "vip" });
	const wellknownThread = makeThread({
		messageId: "m2",
		senderTrust: "wellknown",
	});

	test("maps messageId to candidate id", () => {
		const { candidates } = renderHookWithResponse({ items: [vipThread] });
		assert.equal(candidates[0].id, "m1");
	});

	test("maps fromName as senderName", () => {
		const { candidates } = renderHookWithResponse({ items: [vipThread] });
		assert.equal(candidates[0].senderName, "Anna de Vries");
	});

	test("falls back to fromEmail when fromName is absent", () => {
		const thread = makeThread({
			messageId: "m3",
			senderTrust: "vip",
			fromName: undefined,
		});
		const { candidates } = renderHookWithResponse({ items: [thread] });
		assert.equal(candidates[0].senderName, "anna@example.nl");
	});

	test("falls back to 'Unknown sender' when both name and email are absent", () => {
		const thread = makeThread({
			messageId: "m4",
			senderTrust: "vip",
			fromName: undefined,
			fromEmail: undefined,
		});
		const { candidates } = renderHookWithResponse({ items: [thread] });
		assert.equal(candidates[0].senderName, "Unknown sender");
		assert.equal(candidates[0].senderAddress, "");
	});

	test("falls back to '(no subject)' when subject is absent", () => {
		const thread = makeThread({
			messageId: "m5",
			senderTrust: "vip",
			subject: undefined,
		});
		const { candidates } = renderHookWithResponse({ items: [thread] });
		assert.equal(candidates[0].subject, "(no subject)");
	});

	test("sets vip trustSubReason via rescueCandidateReason", () => {
		const { candidates } = renderHookWithResponse({ items: [vipThread] });
		assert.equal(candidates[0].trustSubReason, "A sender you know");
	});

	test("sets wellknown trustSubReason via rescueCandidateReason", () => {
		const { candidates } = renderHookWithResponse({
			items: [wellknownThread],
		});
		assert.equal(candidates[0].trustSubReason, "You've emailed them before");
	});

	test("sets the constant trustReason headline", () => {
		const { candidates } = renderHookWithResponse({ items: [vipThread] });
		assert.equal(candidates[0].trustReason, "We can verify this sender");
	});

	test("preserves senderTrust on the candidate", () => {
		const { candidates } = renderHookWithResponse({
			items: [vipThread, wellknownThread],
		});
		assert.equal(candidates[0].senderTrust, "vip");
		assert.equal(candidates[1].senderTrust, "wellknown");
	});

	test("maps all response items to candidates in order", () => {
		const { candidates } = renderHookWithResponse({
			items: [vipThread, wellknownThread],
		});
		assert.equal(candidates.length, 2);
		assert.equal(candidates[0].id, "m1");
		assert.equal(candidates[1].id, "m2");
	});
});
