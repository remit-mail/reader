/**
 * The one route resolver behind both compose entry points — the desktop top
 * bar's button and the mobile `ComposeFab`. When they each carried their own
 * copy the two disagreed, and the FAB opened compose state on routes that
 * mount no surface: a dead button.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { hostsComposeSurface } from "./compose-routes";

describe("hostsComposeSurface", () => {
	it("is true for a mailbox route, which mounts FullCompose", () => {
		assert.equal(hostsComposeSurface("/mail/INBOX"), true);
		assert.equal(hostsComposeSurface("/mail/abc-123"), true);
	});

	it("is false for the virtual views, which mount no surface", () => {
		assert.equal(hostsComposeSurface("/mail/outbox"), false);
		assert.equal(hostsComposeSurface("/mail/flagged"), false);
	});

	it("is false for the daily brief, which is /mail itself", () => {
		assert.equal(hostsComposeSurface("/mail"), false);
		assert.equal(hostsComposeSurface("/mail/"), false);
	});

	it("is false outside the mail shell", () => {
		assert.equal(hostsComposeSurface("/settings/accounts"), false);
		assert.equal(hostsComposeSurface("/"), false);
		assert.equal(hostsComposeSurface("/mailroom/x"), false);
	});

	it("matches whole segments, so a mailbox may be named after a view", () => {
		assert.equal(hostsComposeSurface("/mail/outbox-2024"), true);
		assert.equal(hostsComposeSurface("/mail/flagged-archive"), true);
		assert.equal(hostsComposeSurface("/mail/outboxes"), true);
	});

	it("ignores a query string or hash on the path", () => {
		assert.equal(hostsComposeSurface("/mail/INBOX?q=invoice"), true);
		assert.equal(hostsComposeSurface("/mail/outbox?q=invoice"), false);
		assert.equal(hostsComposeSurface("/mail/INBOX#top"), true);
	});
});
