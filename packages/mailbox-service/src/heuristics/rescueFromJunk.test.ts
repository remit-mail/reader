import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { MessageItem } from "@remit/remit-electrodb-service";
import { SenderTrust } from "@remit/domain-enums";
import { shouldRescueFromJunk } from "./rescueFromJunk.js";

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
	it("rescues Substack newsletter: dmarc=Pass + provider-spam + hasListUnsubscribe + no dkimMismatch", () => {
		const message = withSpamAndDmarc({
			category: "newsletter",
			hasListUnsubscribe: true,
			authenticity: { fromDomain: "substack.com", dkimMismatch: false },
		});
		assert.equal(shouldRescueFromJunk(message, SenderTrust.Unknown), true);
	});

	it("does not rescue when provider said ham (classified: false)", () => {
		const message = withSpamAndDmarc({
			providerSpam: { classified: false },
			category: "newsletter",
			hasListUnsubscribe: true,
		});
		assert.equal(shouldRescueFromJunk(message, SenderTrust.Unknown), false);
	});

	it("does not rescue when providerSpam is absent", () => {
		const message: MessageItem = {
			...baseMessage(),
			authResult: { dmarc: "Pass" },
			category: "newsletter",
			hasListUnsubscribe: true,
		} as MessageItem;
		assert.equal(shouldRescueFromJunk(message, SenderTrust.Unknown), false);
	});

	it("does not rescue when DMARC fails", () => {
		const message = withSpamAndDmarc({
			authResult: { dmarc: "Fail" },
			category: "newsletter",
			hasListUnsubscribe: true,
		});
		assert.equal(shouldRescueFromJunk(message, SenderTrust.Unknown), false);
	});

	it("does not rescue when movedByRemit is already set", () => {
		const message = withSpamAndDmarc({
			movedByRemit: true,
			category: "newsletter",
			hasListUnsubscribe: true,
		});
		assert.equal(shouldRescueFromJunk(message, SenderTrust.Unknown), false);
	});

	it("rescues VIP sender with dmarc=Pass + provider-spam", () => {
		const message = withSpamAndDmarc();
		assert.equal(shouldRescueFromJunk(message, SenderTrust.Vip), true);
	});

	it("does not rescue marketing with dkimMismatch=true", () => {
		const message = withSpamAndDmarc({
			category: "marketing",
			hasListUnsubscribe: true,
			authenticity: { fromDomain: "example.com", dkimMismatch: true },
		});
		assert.equal(shouldRescueFromJunk(message, SenderTrust.Unknown), false);
	});

	it("does not rescue newsletter without hasListUnsubscribe", () => {
		const message = withSpamAndDmarc({
			category: "newsletter",
			hasListUnsubscribe: false,
			authenticity: { fromDomain: "example.com", dkimMismatch: false },
		});
		assert.equal(shouldRescueFromJunk(message, SenderTrust.Unknown), false);
	});
});
