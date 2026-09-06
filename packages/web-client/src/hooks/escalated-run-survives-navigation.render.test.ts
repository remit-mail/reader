/**
 * A run survives leaving the mailbox (#112).
 *
 * `escalated-run-lifetime.render.test.ts` pins the run outliving the selection
 * and the wizard. This is the movement past both: the user leaves the mailbox
 * altogether, which unmounts the list and every screen the run was reported on.
 * Held in the surface that started it, the progress, the count and the
 * `AbortController` all went with the route — returning showed an idle header
 * over mail that was still being deleted, Stop reached nothing, and an ending
 * that landed after the move was dropped in silence.
 *
 * The run is mounted through the real hook against the real fetch seam, and the
 * screen is unmounted and mounted again underneath the app's own providers —
 * which is what a route change does to it.
 */

import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { act, createElement } from "react";
import type { BulkRunOutcome, EscalatedAction } from "../lib/bulk-actions";
import { createDomHarness, type DomHarness } from "../test-support/dom";
import {
	type EscalationSearchQuery,
	type UseEscalatedActionsResult,
	useEscalatedActions,
} from "./useEscalatedActions";

const INBOX = "mbx-inbox";
const ELSEWHERE = "mbx-archive";
const PAGE_SIZE = 100;
/** Three full pages and a short one — page boundaries to park a run at. */
const TOTAL = PAGE_SIZE * 3 + 12;

let harness: DomHarness | undefined;
let server: MailServer | undefined;

interface MailServer {
	/** Every message id a delete call carried, in the order they were sent. */
	deleted: () => string[];
	/** Requests queued at the boundary rather than answered. */
	held: () => number;
	/** Requests the client cancelled while they were held. */
	aborted: () => number;
	/** Answer what is held now, and go on holding the batch after it. */
	answerHeld: () => void;
	/** Answer everything held, and stop holding. */
	release: () => void;
	restore: () => void;
}

const searchPage = (url: URL): unknown => {
	const query = url.searchParams.get("query") ?? "";
	if (url.searchParams.get("results") === "false") return { count: TOTAL };
	const served = Number(url.searchParams.get("continuationToken") ?? "0");
	const size = Math.min(PAGE_SIZE, Math.max(TOTAL - served, 0));
	return {
		items: Array.from({ length: size }, (_, i) => ({
			messageId: `${query}-${served + i}`,
		})),
		continuationToken:
			served + size < TOTAL ? String(served + size) : undefined,
	};
};

/**
 * Answers the search and the bulk delete, holding every delete after the first
 * so a run can be caught mid-flight with real progress behind it. A held
 * request honours its own abort signal, the way the platform's `fetch` does.
 */
const startMailServer = (): MailServer => {
	const original = globalThis.fetch;
	const deleted: string[] = [];
	let waiting: Array<() => void> = [];
	let holding = true;
	let served = 0;
	let cancelled = 0;

	const hold = (signal: AbortSignal | undefined): Promise<void> =>
		new Promise<void>((resolve, reject) => {
			const fail = () => {
				cancelled += 1;
				waiting = waiting.filter((held) => held !== resolve);
				reject(signal?.reason);
			};
			if (signal?.aborted) {
				fail();
				return;
			}
			signal?.addEventListener("abort", fail, { once: true });
			waiting.push(resolve);
		});

	globalThis.fetch = (async (input: RequestInfo | URL): Promise<Response> => {
		const request = input instanceof Request ? input : undefined;
		const raw = request ? await request.clone().text() : undefined;
		const url = new URL(request ? request.url : String(input), "http://x");

		if (url.pathname.endsWith("/threads/search")) {
			return Response.json(searchPage(url));
		}

		const body = raw
			? (JSON.parse(raw) as { messageIds: string[] })
			: undefined;
		served += 1;
		if (holding && served > 1) {
			await hold(request?.signal);
		}
		deleted.push(...(body?.messageIds ?? []));
		return Response.json({ successCount: 0, failureCount: 0 });
	}) as typeof globalThis.fetch;

	return {
		deleted: () => deleted,
		held: () => waiting.length,
		aborted: () => cancelled,
		answerHeld: () => {
			const queued = waiting;
			waiting = [];
			for (const resolve of queued) resolve();
		},
		release: () => {
			holding = false;
			const queued = waiting;
			waiting = [];
			for (const resolve of queued) resolve();
		},
		restore: () => {
			globalThis.fetch = original;
		},
	};
};

/** Endings the run's owner stated once no screen was left to state them. */
let endings: Array<{
	kind: EscalatedAction["kind"];
	matched: number;
	outcome: BulkRunOutcome;
}> = [];

const SEARCH: EscalationSearchQuery = { query: "npm" };

/**
 * The mailbox screen, mounted and unmounted the way a route change does it.
 * The providers above it stay mounted throughout — they are the app shell, not
 * the route.
 */
const mailboxScreen = (mailboxId: string) => {
	const Probe = () => {
		value = useEscalatedActions({
			mailboxId,
			enabled: true,
			predicateKey: `${mailboxId}|npm`,
			searchQuery: SEARCH,
			reportEnding: (kind, matched, outcome) => {
				endings.push({ kind, matched, outcome });
			},
		});
		return null;
	};
	return createElement(Probe);
};

let value: UseEscalatedActionsResult | undefined;

const hook = (): UseEscalatedActionsResult => {
	if (!value) throw new Error("no mailbox screen is mounted");
	return value;
};

/** Leave the mailbox: the screen goes, the app shell stays. */
const leaveMailbox = (): void => {
	value = undefined;
	harness?.renderApp(createElement("div", null, "somewhere else"));
};

const openMailbox = (mailboxId = INBOX): void => {
	harness?.renderApp(mailboxScreen(mailboxId));
};

/** A press: the state it sets belongs to the same commit React would batch. */
const press = <T>(action: () => T): T => {
	let result: T | undefined;
	act(() => {
		result = action();
	});
	return result as T;
};

/** Enough turns for a sequential page-and-apply run to reach its end. */
const settle = async (): Promise<void> => {
	if (!harness) throw new Error("nothing mounted");
	for (let round = 0; round < 40; round += 1) await harness.flush();
};

/** Park the run at the page boundary the second batch is waiting on. */
const parkAtBoundary = async (): Promise<void> => {
	if (!harness || !server) throw new Error("nothing mounted");
	for (let round = 0; round < 20; round += 1) {
		if (server.held() > 0) return;
		await harness.flush();
	}
	throw new Error("the run never reached a page boundary");
};

/**
 * Escalate to the whole match and start deleting it, parked at the page
 * boundary the second batch is waiting on. The run is handed back wrapped: a
 * bare promise would be unwrapped by the caller's own `await`, which would wait
 * out the very run the test is about to walk away from.
 */
const startRun = async (): Promise<{ run: Promise<BulkRunOutcome> }> => {
	press(() => hook().escalate());
	await settle();
	assert.deepEqual(hook().phase, { kind: "escalated", total: TOTAL });
	const run = press(() => hook().runAction({ kind: "delete" }));
	await parkAtBoundary();
	return { run };
};

beforeEach(() => {
	server = startMailServer();
	endings = [];
	value = undefined;
	harness = createDomHarness();
});

afterEach(() => {
	harness?.close();
	harness = undefined;
	server?.release();
	server?.restore();
	server = undefined;
	value = undefined;
});

describe("a run the user leaves the mailbox during", () => {
	it("is still reporting live progress when they come back", async () => {
		openMailbox();
		const { run } = await startRun();
		const doneBeforeLeaving = hook().progress?.done ?? 0;
		assert.ok(doneBeforeLeaving > 0, "the run had covered a page");

		leaveMailbox();
		// A page lands while no screen is mounted at all: the run is paging on its
		// own, which is the whole point of it having an owner above the route.
		press(() => server?.answerHeld());
		await parkAtBoundary();
		openMailbox();

		assert.equal(hook().isRunning, true, "the run came back with the mailbox");
		assert.deepEqual(hook().runningAction, { kind: "delete" });
		assert.equal(hook().progress?.total, TOTAL);
		assert.ok(
			(hook().progress?.done ?? 0) > doneBeforeLeaving,
			"progress kept counting while nothing was showing it",
		);
		// The selection did not survive, and must not: it is the screen's, and the
		// user has left it. The run is what the bar is now about.
		assert.deepEqual(hook().phase, { kind: "idle" });

		press(() => server?.release());
		await settle();
		await run;
	});

	it("is stoppable from the mailbox they came back to", async () => {
		openMailbox();
		const { run } = await startRun();

		leaveMailbox();
		openMailbox();
		const sentBeforeStop = server?.deleted().length ?? 0;
		press(() => hook().stop());
		press(() => server?.release());
		await settle();
		const outcome = await run;

		assert.equal(server?.aborted(), 1, "the delete in flight was cancelled");
		assert.equal(
			server?.deleted().length,
			sentBeforeStop,
			"no further ids reached the server",
		);
		assert.equal(outcome.cancelled, true);
		assert.equal(
			outcome.error,
			undefined,
			"a stop the user pressed is not a failure to report",
		);
		assert.equal(hook().isRunning, false);
	});

	it("states how it ended even though nothing was left showing it", async () => {
		openMailbox();
		const { run } = await startRun();

		leaveMailbox();
		press(() => server?.release());
		await settle();
		const outcome = await run;

		assert.equal(outcome.done, TOTAL);
		assert.deepEqual(endings, [
			{ kind: "delete", matched: TOTAL, outcome },
			// One ending, said once: a run that finishes with nobody watching is
			// never announced twice and never dropped.
		]);
	});
});

describe("another mailbox, while a run is going", () => {
	it("shows nothing of a run that is not its own", async () => {
		openMailbox();
		const { run } = await startRun();

		leaveMailbox();
		openMailbox(ELSEWHERE);

		assert.equal(hook().isRunning, false, "the run belongs to the inbox");
		assert.equal(hook().progress, undefined);

		press(() => server?.release());
		await settle();
		await run;
	});
});
