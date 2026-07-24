import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	commitButtonLabel,
	commitDisabledReason,
	formatSenderList,
	scopeActionCount,
	senderFallbackSummary,
} from "./organize-copy";
import type { OrganizeDraft } from "./organize-model";

const draft = (overrides: Partial<OrganizeDraft> = {}): OrganizeDraft => ({
	matchOperator: "And",
	literalClauses: [],
	...overrides,
});

describe("commitDisabledReason", () => {
	it("blocks with a labeling explanation when no folder is chosen", () => {
		const reason = commitDisabledReason({
			draft: draft(),
			scope: "just-these",
			name: "",
			pickedDate: "",
		});
		assert.match(reason ?? "", /Pick a folder/);
	});

	it("requires a name for a standing filter", () => {
		const reason = commitDisabledReason({
			draft: draft({ moveMailboxId: "mbx-1" }),
			scope: "standing",
			name: "  ",
			pickedDate: "",
		});
		assert.match(reason ?? "", /Name this filter/);
	});

	it("requires a date for a temporary filter", () => {
		const reason = commitDisabledReason({
			draft: draft({ moveMailboxId: "mbx-1" }),
			scope: "temporary",
			name: "Trip",
			pickedDate: "",
		});
		assert.match(reason ?? "", /Pick the date/);
	});

	it("is undefined when a move target is set for a one-time scope", () => {
		assert.equal(
			commitDisabledReason({
				draft: draft({ moveMailboxId: "mbx-1" }),
				scope: "all-like-these",
				name: "",
				pickedDate: "",
			}),
			undefined,
		);
	});

	it("is undefined for a fully-specified temporary filter", () => {
		assert.equal(
			commitDisabledReason({
				draft: draft({ moveMailboxId: "mbx-1" }),
				scope: "temporary",
				name: "Trip",
				pickedDate: "2026-07-16",
			}),
			undefined,
		);
	});
});

describe("commitButtonLabel", () => {
	it("pluralizes the one-time labels", () => {
		assert.equal(commitButtonLabel("just-these", 1), "Move 1 message");
		assert.equal(
			commitButtonLabel("all-like-these", 48),
			"Organize 48 messages",
		);
	});

	it("uses standing copy for the persisted scopes", () => {
		assert.equal(commitButtonLabel("standing", 48), "Always do this");
		assert.equal(commitButtonLabel("temporary", 48), "Do this until then");
	});
});

describe("scopeActionCount", () => {
	it("uses the selection for just-these and the match set otherwise", () => {
		assert.equal(scopeActionCount("just-these", 3, 48), 3);
		assert.equal(scopeActionCount("all-like-these", 3, 48), 48);
		assert.equal(scopeActionCount("standing", 3, 48), 48);
	});
});

describe("formatSenderList", () => {
	it("names a single sender bare", () => {
		assert.equal(formatSenderList(["npm@github.com"]), "npm@github.com");
	});

	it("joins a couple with 'and'", () => {
		assert.equal(
			formatSenderList(["a@x.com", "b@y.com"]),
			"a@x.com and b@y.com",
		);
	});

	it("lists up to three in full", () => {
		assert.equal(
			formatSenderList(["a@x.com", "b@y.com", "c@z.com"]),
			"a@x.com, b@y.com and c@z.com",
		);
	});

	it("truncates past three, summing the rest", () => {
		assert.equal(
			formatSenderList(["a@x.com", "b@y.com", "c@z.com", "d@w.com"]),
			"a@x.com, b@y.com, c@z.com and 1 other",
		);
		assert.equal(
			formatSenderList(["a@x.com", "b@y.com", "c@z.com", "d@w.com", "e@v.com"]),
			"a@x.com, b@y.com, c@z.com and 2 others",
		);
	});
});

describe("senderFallbackSummary", () => {
	it("states it is matching all mail from the senders, never 'similar'", () => {
		const summary = senderFallbackSummary(["npm@github.com"]);
		assert.match(summary, /isn't available on this server/);
		assert.match(summary, /matching all mail from npm@github\.com instead/);
	});

	it("names the shared domain when the senders collapse to one FromDomain", () => {
		const summary = senderFallbackSummary(["npm@github.com", "ci@github.com"]);
		assert.match(
			summary,
			/matching all mail from anyone at github\.com instead/,
		);
	});
});
