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
import {
	act,
	createElement,
	type FunctionComponent,
	useEffect,
	useRef,
} from "react";
import type {
	BulkRunOutcome,
	BulkRunStart,
	EscalatedAction,
} from "../lib/bulk-actions";
import { ranOutcome } from "../test-support/bulk-run";
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

interface ScreenSpec {
	mailboxId: string;
	/** The mailbox in the user's words, which a refusal names. */
	label?: string;
	/**
	 * The screen states the ending of a run it starts, the way the wizard's run
	 * screen does — so the owner holds that run's banner back while it is up.
	 */
	reportsInPlace?: boolean;
}

interface MountedScreen {
	hook: UseEscalatedActionsResult;
	/** Passed to the run this screen starts, when it reports in place. */
	claimEnding: ((release: () => void) => void) | undefined;
}

const screens = new Map<string, MountedScreen>();
/**
 * One component type per screen, so re-rendering the same set of mailboxes is a
 * re-render rather than a remount — a fresh type would unmount the screen the
 * test is holding a run open on.
 */
const probes = new Map<string, FunctionComponent>();

/**
 * The mailbox screen, mounted and unmounted the way a route change does it.
 * The providers above it stay mounted throughout — they are the app shell, not
 * the route.
 */
const mailboxScreen = ({ mailboxId, label, reportsInPlace }: ScreenSpec) => {
	const key = `${mailboxId}|${reportsInPlace ? "in-place" : "bannered"}`;
	const held = probes.get(key);
	if (held) return createElement(held, { key });
	const Probe = () => {
		const release = useRef<(() => void) | undefined>(undefined);
		useEffect(
			() => () => {
				release.current?.();
				release.current = undefined;
				screens.delete(mailboxId);
			},
			[],
		);
		const hook = useEscalatedActions({
			mailboxId,
			mailboxLabel: label,
			enabled: true,
			predicateKey: `${mailboxId}|npm`,
			searchQuery: SEARCH,
			reportEnding: (kind, matched, outcome) => {
				endings.push({ kind, matched, outcome });
			},
		});
		screens.set(mailboxId, {
			hook,
			claimEnding: reportsInPlace
				? (next) => {
						release.current?.();
						release.current = next;
					}
				: undefined,
		});
		return null;
	};
	probes.set(key, Probe);
	return createElement(Probe, { key });
};

const screen = (mailboxId = INBOX): MountedScreen => {
	const mounted = screens.get(mailboxId);
	if (!mounted) throw new Error(`no screen is mounted for ${mailboxId}`);
	return mounted;
};

const hook = (mailboxId = INBOX): UseEscalatedActionsResult =>
	screen(mailboxId).hook;

/** Leave the mailbox: the screen goes, the app shell stays. */
const leaveMailbox = (): void => {
	harness?.renderApp(createElement("div", null, "somewhere else"));
};

const openMailbox = (...specs: ScreenSpec[]): void => {
	const mounted = specs.length > 0 ? specs : [{ mailboxId: INBOX }];
	harness?.renderApp(createElement("div", null, ...mounted.map(mailboxScreen)));
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
const startRun = async (
	mailboxId = INBOX,
): Promise<{ run: Promise<BulkRunStart> }> => {
	press(() => hook(mailboxId).escalate());
	await settle();
	assert.deepEqual(hook(mailboxId).phase, { kind: "escalated", total: TOTAL });
	const run = press(() =>
		hook(mailboxId).runAction(
			{ kind: "delete" },
			undefined,
			screen(mailboxId).claimEnding,
		),
	);
	await parkAtBoundary();
	return { run };
};

beforeEach(() => {
	server = startMailServer();
	endings = [];
	screens.clear();
	probes.clear();
	harness = createDomHarness();
});

afterEach(() => {
	harness?.close();
	harness = undefined;
	server?.release();
	server?.restore();
	server = undefined;
	screens.clear();
	probes.clear();
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
		const outcome = ranOutcome(await run);

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
		const outcome = ranOutcome(await run);

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
		openMailbox({ mailboxId: ELSEWHERE });

		assert.equal(
			hook(ELSEWHERE).isRunning,
			false,
			"the run belongs to the inbox",
		);
		assert.equal(hook(ELSEWHERE).progress, undefined);

		press(() => server?.release());
		await settle();
		await run;
	});

	// The Stop on a "Select all N matching" count used to reach the provider
	// unconditionally, so cancelling a count in one mailbox ended a delete going
	// in another — with no banner, because a stop is not a failure.
	it("cancels its own count without touching the run", async () => {
		openMailbox({ mailboxId: INBOX }, { mailboxId: ELSEWHERE });
		const { run } = await startRun();

		press(() => hook(ELSEWHERE).escalate());
		await settle();
		press(() => hook(ELSEWHERE).stop());
		await settle();

		assert.equal(server?.aborted(), 0, "no delete was cancelled");
		assert.equal(hook(INBOX).isRunning, true, "the inbox run is still going");

		press(() => server?.release());
		await settle();
		const outcome = ranOutcome(await run);

		assert.equal(outcome.cancelled, false);
		assert.equal(outcome.done, TOTAL, "the run covered the whole match");
	});

	it("is refused a run of its own while the first one is going", async () => {
		openMailbox({ mailboxId: INBOX, label: "Inbox" }, { mailboxId: ELSEWHERE });
		const { run } = await startRun();
		const sentBeforeSecond = server?.deleted().length ?? 0;

		press(() => hook(ELSEWHERE).escalate());
		await settle();
		const second = await press(() =>
			hook(ELSEWHERE).runAction({ kind: "delete" }),
		);

		assert.equal(second.kind, "refused");
		if (second.kind === "refused") {
			assert.ok(
				second.reason.includes("Inbox"),
				`the refusal names the run in flight: ${second.reason}`,
			);
			assert.ok(second.reason.includes(String(TOTAL)));
		}
		assert.equal(
			server?.deleted().length,
			sentBeforeSecond,
			"the refused commit sent nothing",
		);
		// The selection it was refused for stands, so stopping the other run is
		// enough to answer it.
		assert.deepEqual(hook(ELSEWHERE).phase, {
			kind: "escalated",
			total: TOTAL,
		});

		// The first run is untouched by the refusal, and still the one Stop ends.
		assert.equal(hook(INBOX).isRunning, true);
		press(() => hook(INBOX).stop());
		press(() => server?.release());
		await settle();
		const outcome = ranOutcome(await run);

		assert.equal(outcome.cancelled, true);
		assert.equal(hook(INBOX).isRunning, false);
	});
});

describe("the claim a screen showing an ending in place holds", () => {
	// An organize or filter commit reports in place too, and used to take a claim
	// over any ending at all — so the delete still paging in another mailbox
	// finished in silence.
	it("does not swallow the ending of the run that is going", async () => {
		openMailbox(
			{ mailboxId: INBOX, reportsInPlace: true },
			{ mailboxId: ELSEWHERE, reportsInPlace: true },
		);
		const { run } = await startRun();

		// The run's own screen goes; the one showing an organize commit stays.
		openMailbox({ mailboxId: ELSEWHERE, reportsInPlace: true });
		press(() => server?.release());
		await settle();
		const outcome = ranOutcome(await run);

		assert.equal(outcome.done, TOTAL);
		assert.deepEqual(endings, [{ kind: "delete", matched: TOTAL, outcome }]);
	});

	it("holds the ending back while the screen showing it is up", async () => {
		openMailbox({ mailboxId: INBOX, reportsInPlace: true });
		const { run } = await startRun();

		press(() => server?.release());
		await settle();
		await run;

		assert.deepEqual(endings, [], "the screen states it in place");
	});
});

describe("a run the session ends under", () => {
	// The whole app tree, this provider included, comes down with the session at
	// the auth gate. Nothing there ended the run, so it went on deleting mail for
	// an account nobody was signed in to any more.
	it("stops when the app is torn down", async () => {
		openMailbox();
		const { run } = await startRun();
		const sentBeforeSignOut = server?.deleted().length ?? 0;

		harness?.unmount();
		press(() => server?.release());
		await settle();
		const outcome = ranOutcome(await run);

		assert.equal(server?.aborted(), 1, "the delete in flight was cancelled");
		assert.equal(
			server?.deleted().length,
			sentBeforeSignOut,
			"no further ids reached the server",
		);
		assert.equal(outcome.cancelled, true);
	});
});
