import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ThreadMessageResponse } from "@remit/api-openapi-types";
import {
	MessageCategory,
	MessageStatus,
	MessageSyncStatus,
	SenderTrust,
	StarColor,
} from "@remit/domain-enums";
import {
	filterByOffRowCriteria,
	hasOffRowCriteria,
} from "./filterThreadCriteria.js";

const row = (
	overrides: Partial<ThreadMessageResponse>,
): ThreadMessageResponse => ({
	threadMessageId: "tm",
	threadId: "t",
	messageId: "m",
	accountConfigId: "acc",
	mailboxId: "mb",
	subject: "s",
	fromEmail: "a@example.com",
	fromName: "A",
	sentDate: 0,
	isRead: false,
	hasAttachment: false,
	hasStars: false,
	star: StarColor.None,
	isDeleted: false,
	snippet: "",
	category: MessageCategory.uncategorized,
	createdAt: 0,
	updatedAt: 0,
	senderTrust: SenderTrust.Unknown,
	muted: false,
	status: MessageStatus.active,
	syncStatus: MessageSyncStatus.pending,
	...overrides,
});

describe("hasOffRowCriteria", () => {
	it("is false for an empty criteria object", () => {
		assert.equal(hasOffRowCriteria({}), false);
	});

	it("is false for empty arrays", () => {
		assert.equal(hasOffRowCriteria({ senderTrust: [] }), false);
	});

	it("is true when any criterion is set", () => {
		assert.equal(hasOffRowCriteria({ senderTrust: [SenderTrust.Vip] }), true);
		assert.equal(hasOffRowCriteria({ dkimMismatch: false }), true);
	});
});

describe("filterByOffRowCriteria", () => {
	it("returns rows untouched when no criteria are active", () => {
		const rows = [row({}), row({})];
		assert.equal(filterByOffRowCriteria(rows, {}).length, 2);
	});

	it("filters by senderTrust any-of", () => {
		const rows = [
			row({ senderTrust: SenderTrust.Vip }),
			row({ senderTrust: SenderTrust.Wellknown }),
			row({ senderTrust: SenderTrust.Unknown }),
		];
		const result = filterByOffRowCriteria(rows, {
			senderTrust: [SenderTrust.Vip, SenderTrust.Wellknown],
		});
		assert.equal(result.length, 2);
		assert.ok(result.every((r) => r.senderTrust !== SenderTrust.Unknown));
	});

	it("leaves category alone — it is a SQL predicate, not an off-row criterion", () => {
		const rows = [
			row({ category: MessageCategory.newsletter }),
			row({ category: MessageCategory.personal }),
		];
		assert.equal(filterByOffRowCriteria(rows, {}).length, 2);
	});

	it("filters by dkimMismatch and never matches rows lacking an authenticity signal", () => {
		const rows = [
			row({ authenticity: { fromDomain: "x", dkimMismatch: false } }),
			row({ authenticity: { fromDomain: "y", dkimMismatch: true } }),
			row({ authenticity: undefined }),
		];
		const aligned = filterByOffRowCriteria(rows, { dkimMismatch: false });
		assert.equal(aligned.length, 1);
		assert.equal(aligned[0].authenticity?.dkimMismatch, false);

		const mismatched = filterByOffRowCriteria(rows, { dkimMismatch: true });
		assert.equal(mismatched.length, 1);
		assert.equal(mismatched[0].authenticity?.dkimMismatch, true);
	});

	it("ANDs criteria together (Rescue shape: trust set + dkim aligned)", () => {
		const rows = [
			row({
				senderTrust: SenderTrust.Vip,
				authenticity: { fromDomain: "x", dkimMismatch: false },
			}),
			row({
				senderTrust: SenderTrust.Vip,
				authenticity: { fromDomain: "y", dkimMismatch: true },
			}),
			row({
				senderTrust: SenderTrust.Unknown,
				authenticity: { fromDomain: "z", dkimMismatch: false },
			}),
		];
		const result = filterByOffRowCriteria(rows, {
			senderTrust: [SenderTrust.Vip, SenderTrust.Wellknown],
			dkimMismatch: false,
		});
		assert.equal(result.length, 1);
		assert.equal(result[0].senderTrust, SenderTrust.Vip);
		assert.equal(result[0].authenticity?.dkimMismatch, false);
	});
});
