/**
 * Regression: the /mail shell must mount the MAILBOX pane (MessageList →
 * SwipeableMessageRow → `a[href*=selectedMessageId]`) on /mail/$mailboxId,
 * NOT the brief pane. The first slotted-shell cut keyed brief detection off
 * the parent /mail layout's matched pathname ("/mail"), which is present on
 * EVERY child route — so every mailbox rendered the unified DailyBrief and
 * the message-row anchors disappeared (e2e sync-flow + smoke both failed on
 * `a[href*='selectedMessageId']`). These tests pin detection to each leaf
 * route's own routeId so that can't regress.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	isBriefRoute,
	isFlaggedRoute,
	isMailboxRoute,
	isOutboxRoute,
	type MailRouteMatch,
} from "./mail-route.js";

/** Matches as TanStack Router reports them: parent /mail layout + the leaf. */
const briefMatches: MailRouteMatch[] = [
	{ routeId: "__root__" },
	{ routeId: "/mail" },
	{ routeId: "/mail/" },
];
const mailboxMatches: MailRouteMatch[] = [
	{ routeId: "__root__" },
	{ routeId: "/mail" },
	{ routeId: "/mail/$mailboxId" },
];
const outboxMatches: MailRouteMatch[] = [
	{ routeId: "__root__" },
	{ routeId: "/mail" },
	{ routeId: "/mail/outbox" },
];
const flaggedMatches: MailRouteMatch[] = [
	{ routeId: "__root__" },
	{ routeId: "/mail" },
	{ routeId: "/mail/flagged" },
];

describe("mail route pane detection", () => {
	it("classifies the brief index route as brief only", () => {
		assert.equal(isBriefRoute(briefMatches), true);
		assert.equal(isMailboxRoute(briefMatches), false);
		assert.equal(isOutboxRoute(briefMatches), false);
	});

	it("classifies a mailbox route as mailbox, NOT brief (the regression)", () => {
		// The bug: the parent /mail layout match made isBriefRoute true here,
		// routing the mailbox through the brief pane and dropping message rows.
		assert.equal(isBriefRoute(mailboxMatches), false);
		assert.equal(isMailboxRoute(mailboxMatches), true);
		assert.equal(isOutboxRoute(mailboxMatches), false);
	});

	it("classifies the outbox route as outbox only", () => {
		assert.equal(isBriefRoute(outboxMatches), false);
		assert.equal(isMailboxRoute(outboxMatches), false);
		assert.equal(isOutboxRoute(outboxMatches), true);
	});

	it("classifies the flagged route as flagged only", () => {
		assert.equal(isFlaggedRoute(flaggedMatches), true);
		assert.equal(isBriefRoute(flaggedMatches), false);
		assert.equal(isMailboxRoute(flaggedMatches), false);
		assert.equal(isOutboxRoute(flaggedMatches), false);
	});

	it("never treats the parent /mail layout match as the brief route", () => {
		// Every child route carries the parent /mail layout match. Brief
		// detection must ignore it entirely.
		const parentOnly: MailRouteMatch[] = [
			{ routeId: "__root__" },
			{ routeId: "/mail" },
		];
		assert.equal(isBriefRoute(parentOnly), false);
	});
});
