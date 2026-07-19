import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { MAILBOX_FRESHNESS_MS, mailboxNeedsSync } from "./sync-mailboxes.js";

const NOW = 1_700_000_000_000;

const userRequested = { requestedByUser: true } as const;
const background = {} as const;

describe("mailboxNeedsSync", () => {
	// Issue #37: the gate this replaces applied to every trigger, so a refresh
	// that landed just after a background sync did nothing at all. A sync a
	// person asked for is never gated, however recently one ran.
	it("syncs a mailbox synced a moment ago when the user asked for it", () => {
		const mailbox = { lastMessageSyncAt: NOW - 1_000 };

		assert.equal(mailboxNeedsSync(mailbox, userRequested, NOW), true);
	});

	// Without this, `GET /config` — which fires a trigger per account on every
	// call — re-enumerates every folder an account owns on every page load.
	it("skips a freshly-synced mailbox for a background trigger", () => {
		const mailbox = { lastMessageSyncAt: NOW - 1_000 };

		assert.equal(mailboxNeedsSync(mailbox, background, NOW), false);
	});

	it("syncs a stale mailbox for a background trigger", () => {
		const mailbox = { lastMessageSyncAt: NOW - MAILBOX_FRESHNESS_MS - 1 };

		assert.equal(mailboxNeedsSync(mailbox, background, NOW), true);
	});

	it("syncs exactly at the freshness threshold", () => {
		const mailbox = { lastMessageSyncAt: NOW - MAILBOX_FRESHNESS_MS };

		assert.equal(mailboxNeedsSync(mailbox, background, NOW), true);
	});

	it("always syncs a mailbox that has never synced", () => {
		assert.equal(mailboxNeedsSync({}, background, NOW), true);
		assert.equal(
			mailboxNeedsSync({ lastMessageSyncAt: 0 }, background, NOW),
			true,
		);
	});
});
