/**
 * "Still arriving" is a claim about the server, so it is read from the sync
 * phase the IMAP worker writes — never guessed from an empty list. What the
 * tests pin is when the hook is allowed to speak at all: it stays unresolved
 * until every account has answered, an unreachable account counts as answered
 * rather than holding the list in limbo, and a phase it does not recognise is
 * not syncing.
 */

import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import type {
	RemitImapAccountSyncStatusResponse,
	RemitImapSyncPhase,
} from "@remit/api-http-client/types.gen.ts";
import { createElement } from "react";
import { createDomHarness, type DomHarness } from "../test-support/dom";
import { type HttpMock, httpError, mockFetch } from "../test-support/http";
import {
	ANSWER_DEADLINE_MS,
	type InitialSyncProgress,
	isSyncingPhase,
	POLL_MS,
	useInitialSyncProgress,
} from "./useInitialSyncProgress";

let harness: DomHarness | undefined;
let http: HttpMock | undefined;
let restoreFetch: (() => void) | undefined;

afterEach(() => {
	harness?.close();
	harness = undefined;
	http?.restore();
	http = undefined;
	restoreFetch?.();
	restoreFetch = undefined;
});

interface MailboxProgress {
	synced: number;
	total: number;
}

const status = (
	accountId: string,
	syncPhase: RemitImapSyncPhase | undefined,
	mailboxes: MailboxProgress[] = [],
): RemitImapAccountSyncStatusResponse => ({
	accountId,
	...(syncPhase ? { syncPhase } : {}),
	mailboxes: mailboxes.map((mailbox, index) => ({
		mailboxId: `mbx-${accountId}-${index}`,
		fullPath: index === 0 ? "INBOX" : `Folder ${index}`,
		phase: "syncing",
		messagesSynced: mailbox.synced,
		messagesTotal: mailbox.total,
	})),
});

function Probe({
	accountIds,
	enabled,
}: {
	accountIds: string[];
	enabled: boolean;
}) {
	const progress = useInitialSyncProgress(accountIds, enabled);
	return createElement("div", null, JSON.stringify(progress));
}

/** The account id in `/accounts/{id}/sync/status`. */
const accountOf = (path: string): string => path.split("/")[2] ?? "";

const progress = (dom: DomHarness): InitialSyncProgress =>
	JSON.parse(dom.text());

const UNKNOWN: InitialSyncProgress = {
	syncing: false,
	resolved: false,
	synced: 0,
	total: 0,
};

/** How long the hook gets to answer a request that is already in hand. */
const RESOLVE_CEILING_MS = 2000;
/** How long the hook is watched for an answer, or a request, it must not give. */
const QUIET_WINDOW_MS = 500;
const STEP_MS = 10;

/**
 * Let real time pass until the hook itself says `done`, or the ceiling runs out.
 *
 * Every wait in this file is a question put to the hook rather than a count of
 * turns or a sleep the answer is assumed to fit inside: the poll and the answer
 * deadline run on real timers, so a loaded machine changes how much work lands
 * per turn, and the ceiling is what keeps a hook that never answers a failure
 * instead of a hang.
 */
const settleUntil = async (
	dom: DomHarness,
	done: () => boolean,
	ceilingMs: number,
): Promise<void> => {
	const deadline = Date.now() + ceilingMs;
	for (;;) {
		await dom.flush();
		if (done() || Date.now() >= deadline) return;
		await dom.wait(STEP_MS);
	}
};

const mount = (
	accountIds: string[],
	answer: (accountId: string) => unknown,
	enabled = true,
): DomHarness => {
	http = mockFetch((call) => answer(accountOf(call.path)));
	harness = createDomHarness();
	harness.renderApp(createElement(Probe, { accountIds, enabled }));
	return harness;
};

const mountResolved = async (
	accountIds: string[],
	answer: (accountId: string) => unknown,
): Promise<DomHarness> => {
	const dom = mount(accountIds, answer);
	await settleUntil(dom, () => progress(dom).resolved, RESOLVE_CEILING_MS);
	return dom;
};

/** `acc-2` never answers at all: its request is left hanging for good. */
const mountSilentAccount = (
	answerOfAccountOne: RemitImapAccountSyncStatusResponse,
): DomHarness => {
	const original = globalThis.fetch;
	restoreFetch = () => {
		globalThis.fetch = original;
	};
	globalThis.fetch = ((input: RequestInfo | URL) => {
		const url = input instanceof Request ? input.url : String(input);
		if (url.includes("acc-2")) return new Promise<Response>(() => {});
		return Promise.resolve(
			new Response(JSON.stringify(answerOfAccountOne), {
				status: 200,
				headers: { "content-type": "application/json" },
			}),
		);
	}) as typeof globalThis.fetch;
	harness = createDomHarness();
	harness.renderApp(
		createElement(Probe, { accountIds: ["acc-1", "acc-2"], enabled: true }),
	);
	return harness;
};

describe("isSyncingPhase", () => {
	it("is true only for the phases a running sync round writes", () => {
		assert.equal(isSyncingPhase("discovering_mailboxes"), true);
		assert.equal(isSyncingPhase("syncing_inbox"), true);
		assert.equal(isSyncingPhase("syncing_others"), true);
	});

	it("is false for idle, complete, and error", () => {
		assert.equal(isSyncingPhase("idle"), false);
		assert.equal(isSyncingPhase("complete"), false);
		assert.equal(isSyncingPhase("error"), false);
	});

	it("is false for an account row written before the phase existed", () => {
		// "Not complete" would read this as syncing forever.
		assert.equal(isSyncingPhase(undefined), false);
	});
});

describe("useInitialSyncProgress", () => {
	it("reports syncing with the counts of the accounts still syncing", async () => {
		const dom = await mountResolved(["acc-1"], (accountId) =>
			status(accountId, "syncing_inbox", [
				{ synced: 40, total: 100 },
				{ synced: 10, total: 60 },
			]),
		);
		assert.deepEqual(progress(dom), {
			syncing: true,
			resolved: true,
			synced: 50,
			total: 160,
		});
	});

	it("leaves out the counts of an account that has finished", async () => {
		const dom = await mountResolved(["acc-1", "acc-2"], (accountId) =>
			accountId === "acc-1"
				? status(accountId, "syncing_inbox", [{ synced: 40, total: 100 }])
				: status(accountId, "complete", [{ synced: 900, total: 900 }]),
		);
		assert.deepEqual(progress(dom), {
			syncing: true,
			resolved: true,
			synced: 40,
			total: 100,
		});
	});

	it("resolves to not-syncing once every account is done", async () => {
		const dom = await mountResolved(["acc-1", "acc-2"], (accountId) =>
			status(accountId, "complete", [{ synced: 900, total: 900 }]),
		);
		assert.deepEqual(progress(dom), {
			syncing: false,
			resolved: true,
			synced: 0,
			total: 0,
		});
	});

	it("counts an unreachable account as answered rather than holding the list in limbo", async () => {
		const dom = await mountResolved(["acc-1", "acc-2"], (accountId) =>
			accountId === "acc-1"
				? status(accountId, "syncing_inbox", [{ synced: 5, total: 50 }])
				: httpError(503),
		);
		const state = progress(dom);
		assert.equal(state.resolved, true);
		assert.equal(state.syncing, true);
		assert.equal(state.synced, 5);
	});

	it("knows nothing until every account has answered", async () => {
		// One account answers, the other never does — the hook must not report on
		// the half it has.
		const dom = mountSilentAccount(
			status("acc-1", "syncing_inbox", [{ synced: 5, total: 50 }]),
		);

		await settleUntil(dom, () => progress(dom).resolved, QUIET_WINDOW_MS);

		assert.deepEqual(progress(dom), UNKNOWN);
	});

	it("answers immediately, and never syncing, for no accounts at all", async () => {
		const dom = await mountResolved([], () => ({}));
		assert.deepEqual(progress(dom), {
			syncing: false,
			resolved: true,
			synced: 0,
			total: 0,
		});
		assert.deepEqual(http?.calls ?? [], []);
	});

	it("stops asking once every account has answered and none is syncing", async () => {
		// The caught-up user's answer cannot change by being asked again.
		const dom = await mountResolved(["acc-1", "acc-2"], (accountId) =>
			status(accountId, "complete"),
		);
		const asked = http?.calls.length ?? 0;
		assert.equal(asked, 2);

		await settleUntil(
			dom,
			() => (http?.calls.length ?? 0) > asked,
			POLL_MS + QUIET_WINDOW_MS,
		);

		assert.equal(http?.calls.length, asked);
		assert.equal(progress(dom).resolved, true);
	});

	it("keeps asking while an account is still syncing", async () => {
		const dom = await mountResolved(["acc-1"], (accountId) =>
			status(accountId, "syncing_inbox", [{ synced: 5, total: 50 }]),
		);

		await settleUntil(dom, () => (http?.calls.length ?? 0) > 1, POLL_MS * 3);

		assert.ok(
			(http?.calls.length ?? 0) > 1,
			"progress has to keep arriving while the sync runs",
		);
	});

	it("answers without an account that never responds", async () => {
		const dom = mountSilentAccount(status("acc-1", "complete"));

		await settleUntil(dom, () => progress(dom).resolved, QUIET_WINDOW_MS);
		assert.equal(progress(dom).resolved, false);

		await settleUntil(
			dom,
			() => progress(dom).resolved,
			ANSWER_DEADLINE_MS * 2,
		);

		assert.deepEqual(progress(dom), {
			syncing: false,
			resolved: true,
			synced: 0,
			total: 0,
		});
	});

	it("asks nothing and claims nothing while disabled", async () => {
		const dom = mount(["acc-1"], () => status("acc-1", "syncing_inbox"), false);

		await settleUntil(dom, () => progress(dom).resolved, QUIET_WINDOW_MS);

		assert.deepEqual(progress(dom), UNKNOWN);
		assert.deepEqual(http?.calls ?? [], []);
	});
});
