/**
 * useOrganizeJob — the back-apply job seam. It reports three failures that are
 * not the same fact (#526, #552): a create that never returned a job id, that
 * same create over a pass that already ran, and a status poll that could not be
 * read over a job the server is already running. Looking at that job again is a
 * separate move from starting one.
 */

import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { act, createElement } from "react";
import type { OrganizeDraft } from "../lib/organize/organize-model";
import { createDomHarness, type DomHarness } from "../test-support/dom";
import { type HttpMock, mockFetch } from "../test-support/http";
import { useOrganizeJob } from "./useOrganizeJob";

/**
 * A poll that could not be read reaches this screen only as a transport failure:
 * `shouldEscalate` puts every answered non-2xx on the full-screen fatal page, so
 * a status that is merely unreadable is a `fetch` that never landed.
 */
const dropped = (): never => {
	throw new TypeError("fetch failed");
};

const ACCOUNT = "acc-1";
const JOB = "job-1";

const DRAFT: OrganizeDraft = {
	matchOperator: "Or",
	literalClauses: [{ field: "From", value: "noreply@example.com" }],
	moveMailboxId: "mbx-1",
};

let harness: DomHarness | undefined;
let http: HttpMock | undefined;
let job: ReturnType<typeof useOrganizeJob> | undefined;

afterEach(() => {
	harness?.close();
	harness = undefined;
	http?.restore();
	http = undefined;
	job = undefined;
});

function Probe() {
	job = useOrganizeJob(ACCOUNT);
	return null;
}

const current = (): ReturnType<typeof useOrganizeJob> => {
	if (!job) throw new Error("useOrganizeJob is not mounted");
	return job;
};

// A request round-trip needs a macrotask, not just a drained microtask queue.
const settle = async (): Promise<void> => {
	await harness?.wait(1);
	await harness?.flush();
};

/** Start a job the server accepts, then answer every status poll with `status`. */
const startJob = async (status: () => unknown): Promise<void> => {
	http = mockFetch((call) => {
		if (call.method === "POST") {
			return { organizeJobId: JOB, state: "Pending" };
		}
		return status();
	});
	harness = createDomHarness();
	harness.renderApp(createElement(Probe));
	await act(async () => {
		current().start(DRAFT);
	});
	await settle();
};

const COMPLETED_PASS = {
	organizeJobId: JOB,
	state: "Complete",
	matchedCount: 1284,
	appliedCount: 1200,
	failedCount: 84,
};

/** Run one pass to a finish, then answer the next create with `restart`. */
const restartAfterPass = async (restart: () => unknown): Promise<void> => {
	let created = false;
	http = mockFetch((call) => {
		if (call.method !== "POST") return COMPLETED_PASS;
		if (created) return restart();
		created = true;
		return { organizeJobId: JOB, state: "Pending" };
	});
	harness = createDomHarness();
	harness.renderApp(createElement(Probe));
	await act(async () => {
		current().start(DRAFT);
	});
	await settle();
	assert.equal(current().isDone, true, "the first pass never finished");
	await act(async () => {
		current().start(DRAFT);
	});
	await settle();
};

const posts = (): number =>
	(http?.calls ?? []).filter((call) => call.method === "POST").length;

const statusPolls = (): number => (http?.to(`/organize/${JOB}`) ?? []).length;

describe("useOrganizeJob status reporting", () => {
	it("reports a status poll it could not read as unreadable, over a job still running", async () => {
		await startJob(dropped);
		assert.equal(current().failure?.kind, "statusUnreadable");
		assert.equal(current().isRunning, true);
		assert.equal(current().isDone, false);
	});

	it("reports a create that never returned a job id as a start failure", async () => {
		http = mockFetch(dropped);
		harness = createDomHarness();
		harness.renderApp(createElement(Probe));
		await act(async () => {
			current().start(DRAFT);
		});
		await settle();
		assert.equal(current().failure?.kind, "startFailed");
		assert.equal(current().isRunning, false);
	});

	it("re-polls the job it already has instead of starting a second one", async () => {
		let readable = false;
		await startJob(() =>
			readable
				? {
						organizeJobId: JOB,
						state: "Running",
						matchedCount: 1284,
						appliedCount: 40,
						failedCount: 0,
					}
				: dropped(),
		);
		assert.equal(current().failure?.kind, "statusUnreadable");
		const pollsBefore = statusPolls();

		readable = true;
		await act(async () => {
			current().refreshStatus();
		});
		await settle();

		assert.equal(posts(), 1);
		assert.ok(statusPolls() > pollsBefore, "the existing job was polled again");
		assert.equal(current().failure, undefined);
		assert.equal(current().progress.matchedCount, 1284);
	});

	it("reads a create that failed over a finished pass as a restart, with that pass's counts", async () => {
		await restartAfterPass(dropped);
		assert.equal(current().failure?.kind, "restartFailed");
		assert.equal(current().progress.matchedCount, 1284);
		assert.equal(current().progress.appliedCount, 1200);
		assert.equal(current().progress.failedCount, 84);
		assert.equal(current().isDone, true);
	});

	it("reports a restart that is under way as its own pass, not the one before it", async () => {
		await restartAfterPass(() => new Promise<never>(() => {}));
		assert.equal(current().isStarting, true);
		assert.equal(current().isDone, false);
		assert.equal(current().failure, undefined);
		assert.equal(current().progress.matchedCount, 0);
	});

	it("stops reporting a job as running once it reaches a terminal state", async () => {
		await startJob(() => ({
			organizeJobId: JOB,
			state: "Complete",
			matchedCount: 1284,
			appliedCount: 1284,
			failedCount: 0,
		}));
		assert.equal(current().isDone, true);
		assert.equal(current().failure, undefined);
	});
});
