import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { RemitImapThreadMessageResponse } from "@remit/api-http-client/types.gen.ts";
import {
	buildRescueCandidates,
	isRescueCandidate,
	rescueCandidateReason,
} from "./rescue-candidates.js";

function thread(
	overrides: Partial<RemitImapThreadMessageResponse> &
		Pick<RemitImapThreadMessageResponse, "messageId" | "senderTrust">,
): RemitImapThreadMessageResponse {
	return {
		threadMessageId: `tm-${overrides.messageId}`,
		threadId: `t-${overrides.messageId}`,
		accountConfigId: "acc",
		mailboxId: "mb-junk",
		sentDate: 1_000_000,
		isRead: false,
		hasAttachment: false,
		hasStars: false,
		isDeleted: false,
		createdAt: 1_000_000,
		updatedAt: 1_000_000,
		fromName: "Anna de Vries",
		fromEmail: "anna@studio-noord.nl",
		subject: "Re: invoice",
		snippet: "Final files attached.",
		...overrides,
	} as RemitImapThreadMessageResponse;
}

describe("rescueCandidateReason", () => {
	test("VIP senders read as someone you know", () => {
		assert.equal(rescueCandidateReason("vip"), "A sender you know");
	});

	test("well-known senders read as previously emailed", () => {
		assert.equal(
			rescueCandidateReason("wellknown"),
			"You've emailed them before",
		);
	});

	test("anything else falls back to passed authentication", () => {
		assert.equal(rescueCandidateReason("unknown"), "Passed authentication");
	});

	test("never leaks authentication jargon", () => {
		for (const trust of ["vip", "wellknown", "unknown"] as const) {
			assert.doesNotMatch(rescueCandidateReason(trust), /DKIM|SPF|DMARC/i);
		}
	});
});

describe("isRescueCandidate", () => {
	test("includes verified senders with no DKIM mismatch", () => {
		assert.equal(
			isRescueCandidate(thread({ messageId: "m1", senderTrust: "wellknown" })),
			true,
		);
		assert.equal(
			isRescueCandidate(thread({ messageId: "m2", senderTrust: "vip" })),
			true,
		);
	});

	test("excludes unknown senders", () => {
		assert.equal(
			isRescueCandidate(thread({ messageId: "m3", senderTrust: "unknown" })),
			false,
		);
	});

	test("excludes a verified sender that failed DKIM alignment", () => {
		assert.equal(
			isRescueCandidate(
				thread({
					messageId: "m4",
					senderTrust: "vip",
					authenticity: { fromDomain: "x.nl", dkimMismatch: true },
				}),
			),
			false,
		);
	});

	test("keeps a verified sender when authenticity is absent", () => {
		assert.equal(
			isRescueCandidate(thread({ messageId: "m5", senderTrust: "wellknown" })),
			true,
		);
	});
});

describe("buildRescueCandidates", () => {
	const threads = [
		thread({ messageId: "m1", senderTrust: "wellknown" }),
		thread({ messageId: "m2", senderTrust: "vip" }),
		thread({ messageId: "m3", senderTrust: "unknown" }),
		thread({
			messageId: "m4",
			senderTrust: "vip",
			authenticity: { fromDomain: "x.nl", dkimMismatch: true },
		}),
	];

	test("returns nothing off the Spam folder", () => {
		assert.deepEqual(buildRescueCandidates(threads, false), []);
	});

	test("keeps only verified, unmismatched senders", () => {
		const candidates = buildRescueCandidates(threads, true);
		assert.deepEqual(
			candidates.map((c) => c.id),
			["m1", "m2"],
		);
	});

	test("shapes the candidate with a plain-language reason", () => {
		const [first, second] = buildRescueCandidates(threads, true);
		assert.equal(first.trustReason, "We can verify this sender");
		assert.equal(first.trustSubReason, "You've emailed them before");
		assert.equal(first.senderName, "Anna de Vries");
		assert.equal(second.trustSubReason, "A sender you know");
	});

	test("falls back to safe display strings when fields are missing", () => {
		const [candidate] = buildRescueCandidates(
			[
				thread({
					messageId: "m9",
					senderTrust: "vip",
					fromName: undefined,
					fromEmail: undefined,
					subject: undefined,
					snippet: undefined,
				}),
			],
			true,
		);
		assert.equal(candidate.senderName, "Unknown sender");
		assert.equal(candidate.senderAddress, "");
		assert.equal(candidate.subject, "(no subject)");
		assert.equal(candidate.snippet, "");
	});
});
