import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type {
	RemitImapSenderTrust,
	RemitImapThreadMessageResponse,
} from "@remit/api-http-client/types.gen.ts";
import {
	assembleRescueCandidates,
	buildRescueCandidate,
	buildRescueCandidates,
	deriveSenderTrustFromFlags,
	isRescuableTrust,
	isRescueCandidate,
	type RescueSearchHit,
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

describe("isRescuableTrust", () => {
	test("only VIP and well-known senders qualify", () => {
		assert.equal(isRescuableTrust("vip"), true);
		assert.equal(isRescuableTrust("wellknown"), true);
		assert.equal(isRescuableTrust("unknown"), false);
	});
});

describe("deriveSenderTrustFromFlags", () => {
	test("VIP flag wins", () => {
		assert.equal(
			deriveSenderTrustFromFlags({ vip: { value: true, setAt: 1 } }),
			"vip",
		);
	});

	test("well-known flag maps to wellknown", () => {
		assert.equal(
			deriveSenderTrustFromFlags({ wellknown: { value: true, setAt: 1 } }),
			"wellknown",
		);
	});

	test("absent or false flags fall back to unknown", () => {
		assert.equal(deriveSenderTrustFromFlags(undefined), "unknown");
		assert.equal(
			deriveSenderTrustFromFlags({ vip: { value: false, setAt: 1 } }),
			"unknown",
		);
	});
});

describe("assembleRescueCandidates", () => {
	const hits: RescueSearchHit[] = [
		{
			messageId: "loaded-vip",
			fromName: "Anna",
			fromEmail: "anna@studio-noord.nl",
			subject: "Re: invoice",
		},
		{
			messageId: "unloaded-wellknown",
			fromName: "Bob",
			fromEmail: "bob@known.nl",
			subject: "Quote",
		},
		{
			messageId: "unloaded-unknown",
			fromName: "Eve",
			fromEmail: "eve@spam.nl",
			subject: "You won",
		},
	];

	test("resolves trust from loaded threads and address lookups, keeping only verified senders", () => {
		const loaded = new Map<string, RemitImapThreadMessageResponse>([
			["loaded-vip", thread({ messageId: "loaded-vip", senderTrust: "vip" })],
		]);
		const trustByEmail = new Map<string, RemitImapSenderTrust>([
			["bob@known.nl", "wellknown"],
			["eve@spam.nl", "unknown"],
		]);

		const candidates = assembleRescueCandidates(hits, loaded, trustByEmail);

		assert.deepEqual(
			candidates.map((c) => c.id),
			["loaded-vip", "unloaded-wellknown"],
		);
		const vip = candidates.find((c) => c.id === "loaded-vip");
		assert.equal(vip?.senderTrust, "vip");
		assert.equal(vip?.snippet, "Final files attached.");
		const wellknown = candidates.find((c) => c.id === "unloaded-wellknown");
		assert.equal(wellknown?.senderTrust, "wellknown");
		assert.equal(wellknown?.senderAddress, "bob@known.nl");
	});

	test("treats senders with no resolved trust as unknown and drops them", () => {
		const candidates = assembleRescueCandidates(hits, new Map(), new Map());
		assert.deepEqual(candidates, []);
	});
});

describe("buildRescueCandidate", () => {
	test("shapes a search hit into a candidate with a plain-language reason", () => {
		const candidate = buildRescueCandidate({
			messageId: "s1",
			senderName: "Anna de Vries",
			senderAddress: "anna@studio-noord.nl",
			subject: "Re: invoice",
			snippet: "",
			senderTrust: "wellknown",
		});
		assert.equal(candidate.id, "s1");
		assert.equal(candidate.trustReason, "We can verify this sender");
		assert.equal(candidate.trustSubReason, "You've emailed them before");
		assert.equal(candidate.senderAddress, "anna@studio-noord.nl");
	});
});
