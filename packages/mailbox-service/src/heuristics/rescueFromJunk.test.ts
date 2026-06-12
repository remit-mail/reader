import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { MessageItem } from "@remit/remit-electrodb-service";
import { SenderTrust } from "@remit/domain-enums";
import { shouldRescueFromJunk } from "./rescueFromJunk.js";

// NOTE: auto-rescuing untrusted newsletters/marketing based on DMARC + list
// headers is intentionally removed. DMARC-pass only proves the sender controls
// their domain — not that they are trustworthy. Real spammers authenticate
// throwaway domains (faddedsms.com is a live example). Rescue now requires an
// explicit trust signal (Vip or Wellknown). The newsletter path returns once a
// real engagement/trust signal exists (ref #370).

type SenderTrustValue = (typeof SenderTrust)[keyof typeof SenderTrust];

const baseMessage = (): Partial<MessageItem> => ({
	messageId: "msg-1",
	mailboxId: "junk-mailbox",
	uid: 1,
	sequenceNumber: 1,
	rfc822Size: 100,
	internalDate: Date.now(),
	envelopeId: "env-1",
	rootBodyPartId: "body-1",
	createdAt: Date.now(),
	updatedAt: Date.now(),
});

const withSpamAndDmarc = (overrides: Partial<MessageItem> = {}): MessageItem =>
	({
		...baseMessage(),
		providerSpam: { classified: true },
		authResult: { dmarc: "Pass" },
		...overrides,
	}) as MessageItem;

describe("shouldRescueFromJunk", () => {
	it("rescues VIP sender with dmarc=Pass + provider-spam", () => {
		const message = withSpamAndDmarc();
		assert.equal(shouldRescueFromJunk(message, SenderTrust.Vip), true);
	});

	it("rescues Wellknown sender with dmarc=Pass + provider-spam", () => {
		const message = withSpamAndDmarc();
		assert.equal(shouldRescueFromJunk(message, SenderTrust.Wellknown), true);
	});

	it("rescues VIP newsletter with dmarc=Pass + provider-spam + hasListUnsubscribe", () => {
		const message = withSpamAndDmarc({
			category: "newsletter",
			hasListUnsubscribe: true,
			authenticity: { fromDomain: "substack.com", dkimMismatch: false },
		});
		assert.equal(shouldRescueFromJunk(message, SenderTrust.Vip), true);
	});

	it("does not rescue untrusted newsletter: dmarc=Pass + provider-spam + hasListUnsubscribe (faddedsms-style)", () => {
		const message = withSpamAndDmarc({
			category: "newsletter",
			hasListUnsubscribe: true,
			authenticity: { fromDomain: "substack.com", dkimMismatch: false },
		});
		assert.equal(shouldRescueFromJunk(message, SenderTrust.Unknown), false);
	});

	it("does not rescue untrusted marketing: dmarc=Pass + providerSpam=true + listUnsub=true (faddedsms.com live case)", () => {
		const message = withSpamAndDmarc({
			category: "marketing",
			hasListUnsubscribe: true,
			authenticity: { fromDomain: "faddedsms.com", dkimMismatch: false },
		});
		assert.equal(shouldRescueFromJunk(message, SenderTrust.Unknown), false);
	});

	it("does not rescue when provider said ham (classified: false)", () => {
		const message = withSpamAndDmarc({
			providerSpam: { classified: false },
			category: "newsletter",
			hasListUnsubscribe: true,
		});
		assert.equal(shouldRescueFromJunk(message, SenderTrust.Vip), false);
	});

	it("does not rescue when providerSpam is absent", () => {
		const message: MessageItem = {
			...baseMessage(),
			authResult: { dmarc: "Pass" },
			category: "newsletter",
			hasListUnsubscribe: true,
		} as MessageItem;
		assert.equal(shouldRescueFromJunk(message, SenderTrust.Vip), false);
	});

	it("does not rescue when DMARC fails", () => {
		const message = withSpamAndDmarc({
			authResult: { dmarc: "Fail" },
			category: "newsletter",
			hasListUnsubscribe: true,
		});
		assert.equal(shouldRescueFromJunk(message, SenderTrust.Vip), false);
	});

	it("does not rescue when movedByRemit is already set", () => {
		const message = withSpamAndDmarc({
			movedByRemit: true,
			category: "newsletter",
			hasListUnsubscribe: true,
		});
		assert.equal(shouldRescueFromJunk(message, SenderTrust.Vip), false);
	});

	it("does not rescue Unknown sender even with dkimMismatch=false", () => {
		const message = withSpamAndDmarc({
			category: "marketing",
			hasListUnsubscribe: true,
			authenticity: { fromDomain: "example.com", dkimMismatch: false },
		});
		assert.equal(shouldRescueFromJunk(message, SenderTrust.Unknown), false);
	});
});
