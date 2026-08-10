import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type {
	RemitImapAddressResponse,
	RemitImapThreadMessageResponse,
} from "@remit/api-http-client/types.gen.ts";
import {
	buildAuthenticityIntel,
	buildCategoryIntel,
	buildSenderIntel,
} from "./useIntelligenceData.js";

// Jan 2025 timestamp — far enough in the past to not be "today"
const JAN_2025_MS = new Date("2025-01-15T12:00:00Z").getTime();

function makeThread(
	overrides: Partial<RemitImapThreadMessageResponse> = {},
): RemitImapThreadMessageResponse {
	return {
		threadMessageId: "tm-1",
		threadId: "t-1",
		messageId: "m-1",
		accountConfigId: "ac-1",
		mailboxId: "mb-1",
		fromEmail: "alice@example.com",
		fromName: "Alice",
		subject: "Hello",
		senderTrust: "unknown",
		isRead: false,
		hasAttachment: false,
		hasStars: false,
		sentDate: "2025-01-15T12:00:00Z",
		snippet: "",
		...overrides,
	} as RemitImapThreadMessageResponse;
}

function makeAddress(
	overrides: Partial<RemitImapAddressResponse> = {},
): RemitImapAddressResponse {
	return {
		addressId: "addr-1",
		accountConfigId: "ac-1",
		localPart: "alice",
		domain: "example.com",
		normalizedEmail: "alice@example.com",
		createdAt: JAN_2025_MS,
		updatedAt: JAN_2025_MS,
		...overrides,
	} as RemitImapAddressResponse;
}

describe("buildCategoryIntel", () => {
	test("carries a category the client knows through unchanged", () => {
		const result = buildCategoryIntel(
			makeThread({
				category: "newsletter",
			} as Partial<RemitImapThreadMessageResponse>),
			undefined,
		);
		assert.equal(result.value, "newsletter");
	});

	test("falls back to personal when the row carries no category", () => {
		const result = buildCategoryIntel(makeThread(), undefined);
		assert.equal(result.value, "personal");
	});

	// A newer server classifying into a category this build has no tone for must
	// not leave the chip untoned — the failure this whole change is about.
	test("resolves a category the client does not know to uncategorized", () => {
		const result = buildCategoryIntel(
			makeThread({
				category: "invoice",
			} as Partial<RemitImapThreadMessageResponse>),
			undefined,
		);
		assert.equal(result.value, "uncategorized");
	});

	test("marks the category overridden when the sender carries a different one", () => {
		const thread = makeThread({
			category: "personal",
		} as Partial<RemitImapThreadMessageResponse>);
		const address = makeAddress({
			flags: { category: { value: "newsletter" } },
		} as Partial<RemitImapAddressResponse>);
		assert.equal(buildCategoryIntel(thread, address).overridden, true);
		assert.equal(buildCategoryIntel(thread, undefined).overridden, false);
	});
});

describe("buildSenderIntel", () => {
	describe("counter wiring — counters present", () => {
		test("surfaces inboundCount from address", () => {
			const thread = makeThread();
			const address = makeAddress({ inboundCount: 34 });
			const result = buildSenderIntel(thread, address);
			assert.equal(result.inboundCount, 34);
		});

		test("surfaces replyCount from address", () => {
			const thread = makeThread();
			const address = makeAddress({ inboundCount: 34, replyCount: 12 });
			const result = buildSenderIntel(thread, address);
			assert.equal(result.replyCount, 12);
		});

		test("surfaces both counters together", () => {
			const thread = makeThread();
			const address = makeAddress({ inboundCount: 34, replyCount: 12 });
			const result = buildSenderIntel(thread, address);
			assert.equal(result.inboundCount, 34);
			assert.equal(result.replyCount, 12);
		});
	});

	describe("suppression — counters absent", () => {
		test("inboundCount is undefined when address has no inboundCount", () => {
			const thread = makeThread();
			const address = makeAddress(); // no inboundCount
			const result = buildSenderIntel(thread, address);
			// Must be undefined, not 0 — so SenderCard suppresses the engagement clause
			assert.equal(result.inboundCount, undefined);
		});

		test("replyCount is undefined when address has no replyCount", () => {
			const thread = makeThread();
			const address = makeAddress({ inboundCount: 5 }); // no replyCount
			const result = buildSenderIntel(thread, address);
			assert.equal(result.replyCount, undefined);
		});

		test("both counters are undefined when address is undefined", () => {
			const thread = makeThread();
			const result = buildSenderIntel(thread, undefined);
			assert.equal(result.inboundCount, undefined);
			assert.equal(result.replyCount, undefined);
		});

		test("does not coerce absent inboundCount to 0", () => {
			// Regression guard: the old code left counters as undefined so
			// SenderCard could suppress "0 received · you've never replied".
			// Ensure undefined stays undefined, never becomes 0.
			const thread = makeThread();
			const address = makeAddress(); // inboundCount absent
			const result = buildSenderIntel(thread, address);
			assert.notEqual(result.inboundCount, 0);
		});
	});

	describe("basic sender fields", () => {
		test("uses fromName when present", () => {
			const thread = makeThread({
				fromName: "Alice Smith",
				fromEmail: "alice@example.com",
			});
			const result = buildSenderIntel(thread, undefined);
			assert.equal(result.name, "Alice Smith");
		});

		test("falls back to fromEmail when fromName is absent", () => {
			const thread = makeThread({
				fromName: undefined,
				fromEmail: "alice@example.com",
			});
			const result = buildSenderIntel(thread, undefined);
			assert.equal(result.name, "alice@example.com");
		});

		test("falls back to 'Unknown' when both name and email are absent", () => {
			const thread = makeThread({ fromName: undefined, fromEmail: undefined });
			const result = buildSenderIntel(thread, undefined);
			assert.equal(result.name, "Unknown");
		});

		test("passes senderTrust through", () => {
			const thread = makeThread({ senderTrust: "vip" });
			const result = buildSenderIntel(thread, undefined);
			assert.equal(result.trust, "vip");
		});

		test("firstSeenLabel is 'unknown' when no address", () => {
			const thread = makeThread();
			const result = buildSenderIntel(thread, undefined);
			assert.equal(result.firstSeenLabel, "unknown");
		});

		test("firstSeenLabel is formatted when address is present", () => {
			const thread = makeThread();
			const address = makeAddress({ createdAt: JAN_2025_MS });
			const result = buildSenderIntel(thread, address);
			// Should be something like "Jan 2025", not "unknown" or "today"
			assert.notEqual(result.firstSeenLabel, "unknown");
			assert.ok(result.firstSeenLabel.length > 0);
		});
	});

	describe("addressUnverified flag", () => {
		test("false for a normal address", () => {
			const result = buildSenderIntel(
				makeThread({ fromEmail: "alice@example.com" }),
				undefined,
			);
			assert.equal(result.addressUnverified, false);
		});

		test("true when the domain has no dot (placeholder junk)", () => {
			const result = buildSenderIntel(
				makeThread({ fromEmail: "missing_mailbox@missing_domain" }),
				undefined,
			);
			assert.equal(result.addressUnverified, true);
		});

		test("true when the address is missing", () => {
			const result = buildSenderIntel(
				makeThread({ fromEmail: undefined }),
				undefined,
			);
			assert.equal(result.addressUnverified, true);
		});
	});
});

describe("buildAuthenticityIntel", () => {
	test("caution when there is no authenticity signal", () => {
		const thread = makeThread({ fromEmail: "alice@example.com" });
		const result = buildAuthenticityIntel(thread, 0);
		assert.equal(result.verdict, "caution");
		assert.match(result.summary, /can't verify the sender/);
	});

	test("aligned when a signal is present and does not mismatch", () => {
		const thread = makeThread({
			fromEmail: "alice@example.com",
			authenticity: {
				fromDomain: "example.com",
				dkimDomain: "example.com",
				dkimMismatch: false,
			},
		} as Partial<RemitImapThreadMessageResponse>);
		const result = buildAuthenticityIntel(thread, 0);
		assert.equal(result.verdict, "aligned");
	});

	test("mismatch when the signing domain does not align", () => {
		const thread = makeThread({
			fromEmail: "security@your-bank.example",
			fromName: "Your Bank",
			authenticity: {
				fromDomain: "your-bank.example",
				dkimDomain: "mailer.evil.example",
				dkimMismatch: true,
			},
		} as Partial<RemitImapThreadMessageResponse>);
		const result = buildAuthenticityIntel(thread, 3);
		assert.equal(result.verdict, "mismatch");
		assert.equal(result.addressUnreadable, undefined);
		assert.equal(result.similarCount, 3);
	});

	test("no user-facing copy names the verification mechanism", () => {
		const verdicts = [
			buildAuthenticityIntel(makeThread(), 0),
			buildAuthenticityIntel(
				makeThread({ fromEmail: "x@no-signal.example" }),
				0,
			),
			buildAuthenticityIntel(
				makeThread({
					fromEmail: "a@bank.example",
					authenticity: {
						fromDomain: "bank.example",
						dkimDomain: "evil.example",
						dkimMismatch: true,
					},
				} as Partial<RemitImapThreadMessageResponse>),
				0,
			),
		];
		for (const v of verdicts) {
			assert.doesNotMatch(v.summary, /DKIM|SPF|DMARC/i);
		}
	});

	describe("a passing signature over a claim that does not hold", () => {
		// The InfoMedics invoice phish: an attacker's own free Atlassian tenant,
		// so SPF/DKIM/DMARC genuinely pass for a domain nobody recognises, and the
		// provider's own filter already called it spam. dkimDomain deliberately
		// differs from fromDomain here (the delivery host's re-signature,
		// custmx.one.com, is a different party than the sender's own
		// serviceupdatebank.atlassian.net) — the display-name check was run
		// against fromDomain, never dkimDomain, so the copy must name fromDomain.
		const infoMedics = makeThread({
			fromEmail: "jira@serviceupdatebank.atlassian.net",
			fromName: "InfoMedics",
			subject: "Vordering",
			authenticity: {
				fromDomain: "serviceupdatebank.atlassian.net",
				dkimDomain: "custmx.one.com",
				dkimMismatch: false,
				displayNameCorrespondence: "Unrelated",
				offDomainLinkDomains: ["betaal-vordering.example"],
			},
		} as Partial<RemitImapThreadMessageResponse>);

		test("is never presented as verified", () => {
			const result = buildAuthenticityIntel(infoMedics, 0);
			assert.notEqual(result.verdict, "aligned");
			assert.doesNotMatch(result.summary, /We verified/i);
		});

		// The copy must name the domain the comparison was actually run
		// against (fromDomain), never the unrelated dkimDomain — a message
		// signed by a relay or ESP infrastructure domain must not read as
		// "the name looks nothing like <that other party>".
		test("leads with the concern, naming the domain the name was actually compared to, and the link destination", () => {
			const result = buildAuthenticityIntel(infoMedics, 0);
			assert.equal(result.verdict, "caution");
			assert.match(result.summary, /^The name it shows/);
			assert.match(result.summary, /"InfoMedics"/);
			assert.match(result.summary, /serviceupdatebank\.atlassian\.net/);
			assert.doesNotMatch(result.summary, /custmx\.one\.com/);
			assert.match(result.summary, /betaal-vordering\.example/);
			assert.doesNotMatch(result.summary, /DKIM|SPF|DMARC/i);
		});

		test("a lookalike display name reads as an imitation", () => {
			const result = buildAuthenticityIntel(
				makeThread({
					fromEmail: "billing@1nfomedics.nl",
					fromName: "InfoMedics",
					authenticity: {
						fromDomain: "1nfomedics.nl",
						dkimDomain: "1nfomedics.nl",
						dkimMismatch: false,
						displayNameCorrespondence: "Lookalike",
						offDomainLinkDomains: [],
					},
				} as Partial<RemitImapThreadMessageResponse>),
				0,
			);
			assert.equal(result.verdict, "caution");
			assert.match(result.summary, /only looks like/);
		});

		test("stays verified when the comparisons agreed", () => {
			const result = buildAuthenticityIntel(
				makeThread({
					fromEmail: "notifications@notifications.github.com",
					fromName: "GitHub",
					authenticity: {
						fromDomain: "notifications.github.com",
						dkimDomain: "github.com",
						dkimMismatch: false,
						displayNameCorrespondence: "Corresponds",
						offDomainLinkDomains: [],
					},
				} as Partial<RemitImapThreadMessageResponse>),
				0,
			);
			assert.equal(result.verdict, "aligned");
		});

		test("stays verified when nothing was compared", () => {
			const result = buildAuthenticityIntel(
				makeThread({
					fromEmail: "alice@example.com",
					authenticity: {
						fromDomain: "example.com",
						dkimDomain: "example.com",
						dkimMismatch: false,
					},
				} as Partial<RemitImapThreadMessageResponse>),
				0,
			);
			assert.equal(result.verdict, "aligned");
		});

		test("a drifted link list carries no destination to name", () => {
			const result = buildAuthenticityIntel(
				makeThread({
					fromEmail: "alice@example.com",
					authenticity: {
						fromDomain: "example.com",
						dkimDomain: "example.com",
						dkimMismatch: false,
						displayNameCorrespondence: "Corresponds",
						offDomainLinkDomains: "elsewhere.example",
					},
				} as unknown as Partial<RemitImapThreadMessageResponse>),
				0,
			);
			assert.equal(result.verdict, "aligned");
		});
	});

	describe("unparseable sender drives the red tier", () => {
		test("mismatch + addressUnreadable when the domain has no dot", () => {
			const thread = makeThread({
				fromEmail: "missing_mailbox@missing_domain",
			});
			const result = buildAuthenticityIntel(thread, 0);
			assert.equal(result.verdict, "mismatch");
			assert.equal(result.addressUnreadable, true);
		});

		test("red tier even when a clean DKIM signal is present", () => {
			const thread = makeThread({
				fromEmail: "missing_mailbox@missing_domain",
				authenticity: {
					fromDomain: "missing_domain",
					dkimMismatch: false,
				},
			} as Partial<RemitImapThreadMessageResponse>);
			const result = buildAuthenticityIntel(thread, 0);
			assert.equal(result.verdict, "mismatch");
			assert.equal(result.addressUnreadable, true);
		});
	});
});
