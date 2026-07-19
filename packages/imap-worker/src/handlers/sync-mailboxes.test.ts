import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { MAILBOX_FRESHNESS_MS, mailboxNeedsSync } from "./sync-mailboxes.js";

const NOW = 1_700_000_000_000;

const askedForByName = { explicitRequest: true } as const;
const sideEffect = {} as const;

describe("mailboxNeedsSync", () => {
	// Issue #37: the gate this replaces applied to every trigger, so a refresh
	// that landed just after a side-effect sync did nothing at all. A sync
	// asked for by name (POST /sync) is never gated, however recently one ran.
	it("syncs a mailbox synced a moment ago when the sync was asked for by name", () => {
		const mailbox = { lastMessageSyncAt: NOW - 1_000 };

		assert.equal(mailboxNeedsSync(mailbox, askedForByName, NOW), true);
	});

	// Without this, `GET /config` — which fires a trigger per account on every
	// call — re-enumerates every folder an account owns on every page load.
	it("skips a freshly-synced mailbox for a side-effect trigger", () => {
		const mailbox = { lastMessageSyncAt: NOW - 1_000 };

		assert.equal(mailboxNeedsSync(mailbox, sideEffect, NOW), false);
	});

	it("syncs a stale mailbox for a side-effect trigger", () => {
		const mailbox = { lastMessageSyncAt: NOW - MAILBOX_FRESHNESS_MS - 1 };

		assert.equal(mailboxNeedsSync(mailbox, sideEffect, NOW), true);
	});

	it("syncs exactly at the freshness threshold", () => {
		const mailbox = { lastMessageSyncAt: NOW - MAILBOX_FRESHNESS_MS };

		assert.equal(mailboxNeedsSync(mailbox, sideEffect, NOW), true);
	});

	it("always syncs a mailbox that has never synced", () => {
		assert.equal(mailboxNeedsSync({}, sideEffect, NOW), true);
		assert.equal(
			mailboxNeedsSync({ lastMessageSyncAt: 0 }, sideEffect, NOW),
			true,
		);
	});
});
