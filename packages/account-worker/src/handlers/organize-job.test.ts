import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { RemitClient } from "@remit/backend/client";
import type { OrganizeMatchDeps } from "@remit/backend/organize";
import type { Logger } from "@remit/logger-lambda";
import type { OrganizeJobEvent } from "../events.js";
import { processOrganizeJob } from "./organize-job.js";

const noopLog = {
	info: () => {},
	warn: () => {},
	error: () => {},
	debug: () => {},
	fatal: () => {},
	trace: () => {},
	child: () => noopLog,
} as unknown as Logger;

interface Update {
	state: string;
	errorMessage?: string;
	matchedCount?: number;
	appliedCount?: number;
	failedCount?: number;
}

const event: OrganizeJobEvent = {
	type: "OrganizeJob",
	accountConfigId: "cfg-1",
	organizeJobId: "job-1",
};

const jobClient = (
	updates: Update[],
	literalClauses: Array<{ field: string; value: string }>,
): RemitClient =>
	({
		organizeJobRequest: {
			get: async () => ({
				organizeJobId: "job-1",
				accountConfigId: "cfg-1",
				anchorMessageId: "None",
				matchOperator: "And",
				literalClauses,
				similarityThreshold: 0.75,
				actionLabelId: "lbl-1",
				actionMailboxId: "None",
			}),
			update: async (_id: string, patch: Update) => {
				updates.push(patch);
			},
		},
	}) as unknown as RemitClient;

/**
 * Matcher deps whose corpus read is a landmine: reaching it at all means the
 * predicate was not refused up front, and the thrown error stands in for the
 * infrastructure-class failure a retry exists for.
 */
const explodingMatchDeps = (): OrganizeMatchDeps =>
	({
		semantic: () => {
			throw new Error("the vector pipeline must not be reached");
		},
		listAccountFilterMessages: async () => {
			throw new Error("SQLITE_BUSY");
		},
		filterAnchors: {
			listByAccountConfig: async () => [],
			put: async () => {
				throw new Error("unreachable");
			},
		},
	}) as unknown as OrganizeMatchDeps;

describe("processOrganizeJob (reader #463)", () => {
	it("fails the job on a refused rule and acknowledges the record", async () => {
		const updates: Update[] = [];

		await processOrganizeJob(event, noopLog, {
			client: jobClient(updates, [{ field: "HasWords", value: "invoice" }]),
			matchDeps: explodingMatchDeps(),
		});

		assert.deepEqual(
			updates.map((u) => u.state),
			["Running", "Failed"],
		);
		const failed = updates[1];
		assert.match(String(failed?.errorMessage), /HasWords/);
		assert.equal(failed?.matchedCount, 0);
		assert.equal(failed?.appliedCount, 0);
		assert.equal(failed?.failedCount, 0);
	});

	it("fails the job and propagates an infrastructure failure so the record retries", async () => {
		const updates: Update[] = [];

		await assert.rejects(
			processOrganizeJob(event, noopLog, {
				client: jobClient(updates, [
					{ field: "Subject", value: "reservation" },
				]),
				matchDeps: explodingMatchDeps(),
			}),
			/SQLITE_BUSY/,
			"an SQS/DDB-class failure must stay loud so partial batch failure redelivers it",
		);

		assert.deepEqual(
			updates.map((u) => u.state),
			["Running", "Failed"],
		);
		assert.equal(updates[1]?.errorMessage, "SQLITE_BUSY");
	});
});
