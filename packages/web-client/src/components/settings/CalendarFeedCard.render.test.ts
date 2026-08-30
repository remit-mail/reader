import assert from "node:assert/strict";
import { describe, it } from "node:test";
import React, { createElement } from "react";
import { renderToString } from "react-dom/server";
import type { CalendarFeedState } from "@/hooks/calendar/useCalendarFeed";
import { CalendarFeedCard } from "./CalendarFeedCard";

// The node test loader transpiles remit-ui's `.tsx` with the classic JSX
// runtime, which references a global `React`. Vite uses the automatic runtime,
// so this shim only exists for the SSR test harness.
(globalThis as { React?: typeof React }).React = React;

const CREATED = Date.parse("2026-05-04T09:12:00Z");
const ROTATED = Date.parse("2026-08-19T16:40:00Z");
const ADDRESS = "webcal://mail.example.com/feeds/calendar/token-here.ics";

const render = (
	state: CalendarFeedState,
	overrides: {
		mintedUrl?: string;
		isBusy?: boolean;
		actionError?: unknown;
	} = {},
) =>
	renderToString(
		createElement(CalendarFeedCard, {
			calendarName: "Work",
			state,
			mintedUrl: overrides.mintedUrl ?? "",
			isBusy: overrides.isBusy ?? false,
			actionError: overrides.actionError,
			onMint: () => undefined,
			onRevoke: () => undefined,
			onDismissMinted: () => undefined,
			onRetry: () => undefined,
		}) as never,
	);

describe("CalendarFeedCard", () => {
	it("names the calendar in every state", () => {
		assert.match(render({ status: "loading" }), /Work/);
	});

	it("offers to create an address when the calendar is not shared", () => {
		const html = render({ status: "absent" });
		assert.match(html, /Create subscription address/);
		assert.doesNotMatch(html, /Stop sharing/);
	});

	it("says the address is the credential before one exists", () => {
		assert.match(
			render({ status: "absent" }),
			/the address is the credential/i,
		);
	});

	it("shows when a shared address was created, and offers both takebacks", () => {
		const html = render({
			status: "active",
			createdAt: CREATED,
			rotatedAt: 0,
		});
		assert.match(html, /shared/);
		assert.match(html, /Address created/);
		assert.doesNotMatch(html, /last replaced/);
		assert.match(html, /Replace address/);
		assert.match(html, /Stop sharing/);
	});

	it("names the last replacement once the address has been rotated", () => {
		const html = render({
			status: "active",
			createdAt: CREATED,
			rotatedAt: ROTATED,
		});
		assert.match(html, /last replaced/);
	});

	/**
	 * The whole point of the state: a shared calendar shows no address, because
	 * only a hash of it is stored. A card that could re-display it would mean the
	 * server had kept the secret.
	 */
	it("never shows an address for a feed it merely knows exists", () => {
		const html = render({
			status: "active",
			createdAt: CREATED,
			rotatedAt: 0,
		});
		assert.doesNotMatch(html, /webcal:\/\//);
	});

	it("shows a minted address once, with a copy control and both warnings", () => {
		const html = render(
			{ status: "active", createdAt: CREATED, rotatedAt: 0 },
			{ mintedUrl: ADDRESS },
		);
		assert.match(html, /webcal:\/\/mail\.example\.com/);
		assert.match(html, /Copy address/);
		assert.match(html, /shown once and cannot be read back/);
		assert.match(html, /Anyone holding this address can read every event/);
	});

	it("states a refused write where the control is, rather than going quiet", () => {
		const html = render(
			{ status: "absent" },
			{ actionError: new Error("Calendar not found") },
		);
		assert.match(html, /was not changed/);
		assert.match(html, /Calendar not found/);
	});

	/**
	 * A read the server refused is not "not shared". Drawing the create button
	 * for it would tell the reader their calendar is private while it may be
	 * subscribed to right now.
	 */
	it("keeps a failed read distinct from a calendar that is not shared", () => {
		const html = render({
			status: "unreadable",
			error: new Error("Service unavailable"),
		});
		assert.match(html, /Couldn.{0,6}t read whether Work is shared/);
		assert.match(html, /Service unavailable/);
		assert.doesNotMatch(html, /Create subscription address/);
	});

	it("disables the create control while a write is in flight", () => {
		const html = render({ status: "absent" }, { isBusy: true });
		assert.match(html, /disabled/);
		assert.match(html, /Creating…/);
	});

	/**
	 * The mint's invalidate() re-reads the feed, and that read passes back
	 * through "loading" before it settles as "active". A skeleton drawn over
	 * the address already on screen carries a name that is a substring of the
	 * address input's own label, so the two collide under one accessible name.
	 */
	it("does not draw the loading skeleton over an address just minted", () => {
		const html = render({ status: "loading" }, { mintedUrl: ADDRESS });
		assert.match(html, /webcal:\/\/mail\.example\.com/);
		assert.doesNotMatch(html, /Loading the subscription address/);
	});

	it("does not draw a read failure over an address just minted", () => {
		const html = render(
			{ status: "unreadable", error: new Error("Service unavailable") },
			{ mintedUrl: ADDRESS },
		);
		assert.match(html, /webcal:\/\/mail\.example\.com/);
		assert.doesNotMatch(html, /Couldn.{0,6}t read whether/);
	});
});
