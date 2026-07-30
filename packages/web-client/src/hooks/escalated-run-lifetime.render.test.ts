/**
 * A run outlives the selection it came from (#521). The run screen tells the
 * user "This keeps running if you close the wizard", and closing the wizard
 * drops the escalated selection on the way out — so leaving the selection and
 * ending the run have to be two things.
 *
 * These mount the real hook against the real fetch seam and count the batches
 * that actually left, so what is pinned is the run's own lifetime rather than
 * the wording of whichever screen started it. Every run is parked at a page
 * boundary before the test acts on it: that is where the run reads whether it
 * has been told to stop, and so the only place the difference shows.
 */

import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { act, createElement } from "react";
import { createDomHarness, type DomHarness } from "../test-support/dom";
import {
	type EscalationSearchQuery,
	type UseEscalatedActionsResult,
	useEscalatedActions,
} from "./useEscalatedActions";

const INBOX = "mbx-inbox";
const PAGE_SIZE = 100;
/** Three full pages and a short one — page boundaries to park a run at. */
const TOTAL = PAGE_SIZE * 3 + 12;

let harness: DomHarness | undefined;
let server: MailServer | undefined;

interface MailServer {
	/** Every message id a delete call carried, in the order they were sent. */
	deleted: () => string[];
	/** Deletes queued at the boundary rather than answered. */
	held: () => number;
	/** Answer everything held, and stop holding. */
	release: () => void;
	restore: () => void;
}

/**
 * A search that pages `TOTAL` ids at the hook's own page size, keyed by the
 * query, so a run started against one predicate is distinguishable from a run
 * that followed the list onto a later one.
 */
const searchPage = (url: URL): unknown => {
	const query = url.searchParams.get("query") ?? "";
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
 * so a run can be caught mid-flight with real progress behind it.
 */
const startMailServer = (): MailServer => {
	const original = globalThis.fetch;
	const deleted: string[] = [];
	let waiting: Array<() => void> = [];
	let holding = true;
	let served = 0;

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
			await new Promise<void>((resolve) => waiting.push(resolve));
		}
		deleted.push(...(body?.messageIds ?? []));
		return Response.json({ successCount: 0, failureCount: 0 });
	}) as typeof globalThis.fetch;

	return {
		deleted: () => deleted,
		held: () => waiting.length,
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

const mountEscalation = (
	initialQuery: EscalationSearchQuery,
): {
	hook: () => UseEscalatedActionsResult;
	setQuery: (next: EscalationSearchQuery) => void;
} => {
	let value: UseEscalatedActionsResult | undefined;
	const Probe = ({ search }: { search: EscalationSearchQuery }) => {
		value = useEscalatedActions({
			mailboxId: INBOX,
			enabled: true,
			predicateKey: JSON.stringify(search),
			searchQuery: search,
		});
		return null;
	};
	harness = createDomHarness();
	harness.renderApp(createElement(Probe, { search: initialQuery }));
	return {
		hook: () => {
			if (!value) throw new Error("hook did not render");
			return value;
		},
		setQuery: (next) => {
			harness?.renderApp(createElement(Probe, { search: next }));
		},
	};
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

const escalateTo = async (
	hook: () => UseEscalatedActionsResult,
): Promise<void> => {
	press(() => hook().escalate());
	await settle();
	assert.deepEqual(hook().phase, { kind: "escalated", total: TOTAL });
};

beforeEach(() => {
	server = startMailServer();
});

afterEach(() => {
	harness?.close();
	harness = undefined;
	server?.release();
	server?.restore();
	server = undefined;
});

describe("an escalated run the user walks away from", () => {
	it("keeps paging after the selection it came from is dropped", async () => {
		const { hook } = mountEscalation({ query: "npm" });
		await escalateTo(hook);

		const run = press(() => hook().runAction({ kind: "delete" }));
		await parkAtBoundary();
		// What closing the wizard does on the way out: the list drops the escalated
		// selection. The run is not the selection.
		press(() => hook().clear());
		press(() => server?.release());
		await settle();
		const outcome = await run;

		assert.equal(outcome.cancelled, false);
		assert.equal(outcome.done, TOTAL);
		assert.equal(server?.deleted().length, TOTAL);
	});

	it("keeps paging the predicate it was started against when the search moves on", async () => {
		const { hook, setQuery } = mountEscalation({ query: "npm" });
		await escalateTo(hook);

		const run = press(() => hook().runAction({ kind: "delete" }));
		await parkAtBoundary();
		setQuery({ query: "invoices" });
		press(() => server?.release());
		await settle();
		const outcome = await run;

		assert.equal(outcome.done, TOTAL);
		assert.deepEqual(
			(server?.deleted() ?? []).filter((id) => !id.startsWith("npm-")),
			[],
			"the run followed the query typed after it started",
		);
	});

	it("returns the phase to idle only once the run it owns has ended", async () => {
		const { hook } = mountEscalation({ query: "npm" });
		await escalateTo(hook);

		const run = press(() => hook().runAction({ kind: "delete" }));
		await parkAtBoundary();
		press(() => hook().clear());
		assert.equal(hook().isRunning, true);

		press(() => server?.release());
		await settle();
		await run;

		assert.deepEqual(hook().phase, { kind: "idle" });
		assert.equal(hook().isRunning, false);
	});
});

describe("stopping the run, which is a different press", () => {
	it("ends it at the next page boundary and says what it reached", async () => {
		const { hook } = mountEscalation({ query: "npm" });
		await escalateTo(hook);

		const run = press(() => hook().runAction({ kind: "delete" }));
		await parkAtBoundary();
		press(() => hook().stop());
		press(() => server?.release());
		await settle();
		const outcome = await run;

		assert.equal(outcome.cancelled, true);
		assert.ok(outcome.done > 0, "the batches already sent still count");
		assert.ok(outcome.done < TOTAL, "the run carried on past the stop");
		assert.equal(server?.deleted().length, outcome.done);
	});
});

describe("clearing an escalated selection with nothing running", () => {
	it("drops it back to bounded", async () => {
		const { hook } = mountEscalation({ query: "npm" });
		await escalateTo(hook);

		press(() => hook().clear());
		await settle();

		assert.deepEqual(hook().phase, { kind: "idle" });
	});
});
