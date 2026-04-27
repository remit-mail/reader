import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	buildListThreadMessagesOptions,
	buildListThreadsOptions,
	buildSearchThreadsOptions,
} from "./thread.js";

// Regression coverage for #212. These helpers wrap the option construction
// for the three thread-listing handlers so the `excludeDeleted: true`
// default — the central piece of the #212 backend fix — is testable
// without booting DynamoDB. The defaults must stay:
//
//   * `order: "desc"` when the caller does not specify one
//   * `excludeDeleted: true` regardless of caller input
//
// The service-level option remains opt-in (`excludeDeleted` defaults to
// `false` on `ThreadMessageService.listByMailbox`) so a future Trash /
// All-Mail UI can read soft-deleted rows when it explicitly asks for them.
// The handlers — which serve the inbox listing — must always exclude.

describe("buildListThreadsOptions (#212)", () => {
	it("forces excludeDeleted: true regardless of input", () => {
		const opts = buildListThreadsOptions({});
		assert.equal(opts.excludeDeleted, true);
	});

	it("defaults order to 'desc'", () => {
		const opts = buildListThreadsOptions({});
		assert.equal(opts.order, "desc");
	});

	it("respects an explicit order parameter", () => {
		const opts = buildListThreadsOptions({ order: "asc" });
		assert.equal(opts.order, "asc");
		assert.equal(opts.excludeDeleted, true);
	});

	it("forwards continuationToken", () => {
		const opts = buildListThreadsOptions({ continuationToken: "alice-token" });
		assert.equal(opts.continuationToken, "alice-token");
	});

	it("includes ThreadMessage attributes for projected reads", () => {
		const opts = buildListThreadsOptions({});
		assert.ok(Array.isArray(opts.attributes));
		assert.ok(
			opts.attributes.includes("isDeleted"),
			"isDeleted must be projected so the optional client-side filter works",
		);
	});
});

describe("buildSearchThreadsOptions (#212)", () => {
	it("forces excludeDeleted: true so search hits never surface deleted rows", () => {
		assert.equal(buildSearchThreadsOptions({}).excludeDeleted, true);
		assert.equal(
			buildSearchThreadsOptions({ order: "asc" }).excludeDeleted,
			true,
		);
	});

	it("defaults order to 'desc'", () => {
		assert.equal(buildSearchThreadsOptions({}).order, "desc");
	});
});

describe("buildListThreadMessagesOptions (#212)", () => {
	it("forces excludeDeleted: true so deleted messages never appear inside a thread view", () => {
		assert.equal(buildListThreadMessagesOptions({}).excludeDeleted, true);
	});

	it("defaults order to 'desc'", () => {
		assert.equal(buildListThreadMessagesOptions({}).order, "desc");
	});

	it("forwards mailboxId for thread-by-mailbox dedup", () => {
		const opts = buildListThreadMessagesOptions({ mailboxId: "alice-mb-aaa" });
		assert.equal(opts.mailboxId, "alice-mb-aaa");
	});
});
