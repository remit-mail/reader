/**
 * Issue #1067: subscribing to a calendar by its secret .ics address.
 *
 * Driven through the real OpenAPI document, so what is asserted is the routing,
 * the status code, the headers and the bytes a subscribed Apple Calendar or
 * Thunderbird receives — including that the feed answers with no session while
 * the management sub-resource refuses without one. The store is the SQLite
 * composition a self-host deployment boots, over the committed migrations.
 */

import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import type { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import {
	_resetForTest,
	type RemitClient,
	setClient,
} from "../service/data-client.js";
import { createCalendarSqliteClient } from "./calendar-sqlite-fixture.js";

let handler: (
	event: APIGatewayProxyEvent,
	context: unknown,
) => Promise<APIGatewayProxyResult>;
let client: RemitClient;
let cleanup: () => void;
let mintedAccounts = 0;

interface Requested {
	method: string;
	path: string;
	sub?: string;
	body?: Record<string, unknown>;
	headers?: Record<string, string>;
}

const request = async ({
	method,
	path,
	sub,
	body,
	headers,
}: Requested): Promise<APIGatewayProxyResult> => {
	const event = {
		httpMethod: method,
		path,
		headers: headers ?? {},
		queryStringParameters: null,
		body: body === undefined ? null : JSON.stringify(body),
		requestContext: sub ? { authorizer: { claims: { sub } } } : {},
	} as unknown as APIGatewayProxyEvent;

	return handler(event, { awsRequestId: `req-${path}`, functionName: "test" });
};

const json = (response: APIGatewayProxyResult): Record<string, unknown> =>
	JSON.parse(response.body) as Record<string, unknown>;

const headerOf = (
	response: APIGatewayProxyResult,
	name: string,
): string | undefined => {
	for (const [key, value] of Object.entries(response.headers ?? {})) {
		if (key.toLowerCase() === name) return String(value);
	}
	return undefined;
};

/** One caller, their calendar, and an event in it. */
class Subscriber {
	readonly sub: string;

	constructor() {
		mintedAccounts += 1;
		this.sub = `calendar-feed-sub-${mintedAccounts}`;
	}

	async calendar(displayName = "Work"): Promise<string> {
		const created = await request({
			method: "POST",
			path: "/calendars",
			sub: this.sub,
			body: { urlSegment: `work-${mintedAccounts}`, displayName },
		});
		assert.equal(created.statusCode, 200, created.body);
		return json(created).calendarId as string;
	}

	async event(calendarId: string, summary: string, recurrenceRule = "") {
		const created = await request({
			method: "POST",
			path: "/calendar-events",
			sub: this.sub,
			body: {
				calendarId,
				summary,
				start: "2026-09-07T09:00:00+00:00",
				end: "2026-09-07T10:00:00+00:00",
				recurrenceRule,
			},
		});
		assert.equal(created.statusCode, 200, created.body);
		return json(created);
	}

	async mintFeed(calendarId: string): Promise<string> {
		const minted = await request({
			method: "PUT",
			path: `/calendars/${calendarId}/feed`,
			sub: this.sub,
		});
		assert.equal(minted.statusCode, 200, minted.body);
		return json(minted).feedToken as string;
	}
}

const fetchFeed = (
	feedToken: string,
	headers?: Record<string, string>,
): Promise<APIGatewayProxyResult> =>
	request({
		method: "GET",
		path: `/feeds/calendar/${feedToken}.ics`,
		headers,
	});

before(async () => {
	_resetForTest();
	// The self-host gate, so the feed's exemption from it is exercised rather
	// than assumed. Set before the module loads: it reads the flag per request,
	// but the boot-time bypass assertion reads NODE_ENV at import.
	process.env.DATA_BACKEND = "sqlite";
	({ client, cleanup } = await createCalendarSqliteClient());
	setClient(client);
	({ handler } = (await import("../index.js")) as unknown as {
		handler: typeof handler;
	});
});

after(() => {
	_resetForTest();
	cleanup();
});

describe("the feed a subscriber polls", () => {
	it("serves the calendar as iCalendar text with no session at all", async () => {
		const owner = new Subscriber();
		const calendarId = await owner.calendar("Team");
		await owner.event(calendarId, "Stand-up");
		const feedToken = await owner.mintFeed(calendarId);

		const feed = await fetchFeed(feedToken);

		assert.equal(feed.statusCode, 200, feed.body);
		assert.equal(
			headerOf(feed, "content-type"),
			"text/calendar; charset=utf-8",
		);
		assert.match(feed.body, /^BEGIN:VCALENDAR/);
		assert.match(feed.body, /END:VCALENDAR\r\n$/);
		assert.match(feed.body, /X-WR-CALNAME:Team/);
		assert.match(feed.body, /SUMMARY:Stand-up/);
		assert.ok(headerOf(feed, "etag"), "a poller needs a tag to send back");
		assert.ok(headerOf(feed, "last-modified"));
	});

	it("carries a recurring event as its master and rule, not as occurrences", async () => {
		const owner = new Subscriber();
		const calendarId = await owner.calendar();
		await owner.event(calendarId, "Weekly", "FREQ=WEEKLY;COUNT=5");
		const feedToken = await owner.mintFeed(calendarId);

		const feed = await fetchFeed(feedToken);

		assert.equal(feed.body.match(/BEGIN:VEVENT/g)?.length, 1);
		assert.match(feed.body, /RRULE:FREQ=WEEKLY;COUNT=5/);
		assert.equal(
			feed.body.includes("RECURRENCE-ID"),
			false,
			"expanding the series would end it at whatever horizon this server chose",
		);
	});

	it("answers 304 to the tag it just served, and re-serves a changed calendar", async () => {
		const owner = new Subscriber();
		const calendarId = await owner.calendar();
		await owner.event(calendarId, "Stand-up");
		const feedToken = await owner.mintFeed(calendarId);
		const first = await fetchFeed(feedToken);
		const etag = headerOf(first, "etag") as string;

		const unchanged = await fetchFeed(feedToken, { "If-None-Match": etag });

		assert.equal(unchanged.statusCode, 304);
		assert.equal(unchanged.body, "");
		assert.equal(headerOf(unchanged, "etag"), etag);

		await owner.event(calendarId, "Retro");
		const changed = await fetchFeed(feedToken, { "If-None-Match": etag });

		assert.equal(changed.statusCode, 200);
		assert.match(changed.body, /SUMMARY:Retro/);
		assert.match(changed.body, /SUMMARY:Stand-up/);
		assert.equal(changed.body.match(/BEGIN:VEVENT/g)?.length, 2);
		assert.notEqual(headerOf(changed, "etag"), etag);
	});

	it("answers the same plain 404 to an unknown and to a malformed token", async () => {
		const owner = new Subscriber();
		const calendarId = await owner.calendar();
		await owner.mintFeed(calendarId);

		const unknown = await fetchFeed("z".repeat(43));
		const malformed = await fetchFeed("not-a-token");

		assert.equal(unknown.statusCode, 404);
		assert.equal(malformed.statusCode, 404);
		assert.equal(
			headerOf(unknown, "content-type"),
			"text/plain; charset=utf-8",
		);
		assert.equal(unknown.body, malformed.body);
		assert.equal(
			unknown.body.includes("calendar"),
			true,
			"the body says nothing about which of the two it was",
		);
	});
});

describe("the feed a person manages", () => {
	it("hands out the token once and rotates the address on a second write", async () => {
		const owner = new Subscriber();
		const calendarId = await owner.calendar();
		await owner.event(calendarId, "Stand-up");
		const first = await owner.mintFeed(calendarId);

		const second = await owner.mintFeed(calendarId);

		assert.notEqual(second, first);
		assert.equal((await fetchFeed(first)).statusCode, 404);
		assert.equal((await fetchFeed(second)).statusCode, 200);

		const state = await request({
			method: "GET",
			path: `/calendars/${calendarId}/feed`,
			sub: owner.sub,
		});
		assert.equal(state.statusCode, 200);
		assert.equal(json(state).feedToken, undefined);
		assert.ok((json(state).rotatedAt as number) > 0);
	});

	it("stops the address resolving when it is revoked", async () => {
		const owner = new Subscriber();
		const calendarId = await owner.calendar();
		const feedToken = await owner.mintFeed(calendarId);

		const revoked = await request({
			method: "DELETE",
			path: `/calendars/${calendarId}/feed`,
			sub: owner.sub,
		});

		assert.equal(revoked.statusCode, 204);
		assert.equal((await fetchFeed(feedToken)).statusCode, 404);
		assert.equal(
			(
				await request({
					method: "DELETE",
					path: `/calendars/${calendarId}/feed`,
					sub: owner.sub,
				})
			).statusCode,
			404,
			"revoking a feed that is not there is not something to confirm",
		);
	});

	it("takes the address with the calendar it belonged to", async () => {
		const owner = new Subscriber();
		const calendarId = await owner.calendar();
		const feedToken = await owner.mintFeed(calendarId);

		const removed = await request({
			method: "DELETE",
			path: `/calendars/${calendarId}`,
			sub: owner.sub,
		});

		assert.equal(removed.statusCode, 204);
		assert.equal((await fetchFeed(feedToken)).statusCode, 404);
	});

	it("is absent for a calendar the caller does not own", async () => {
		const owner = new Subscriber();
		const stranger = new Subscriber();
		const calendarId = await owner.calendar();
		await owner.mintFeed(calendarId);

		for (const method of ["GET", "PUT", "DELETE"]) {
			const response = await request({
				method,
				path: `/calendars/${calendarId}/feed`,
				sub: stranger.sub,
			});
			assert.equal(response.statusCode, 404, `${method} ${response.body}`);
		}
	});

	it("refuses to mint or revoke without a session", async () => {
		const owner = new Subscriber();
		const calendarId = await owner.calendar();

		for (const method of ["GET", "PUT", "DELETE"]) {
			const response = await request({
				method,
				path: `/calendars/${calendarId}/feed`,
			});
			assert.equal(response.statusCode, 401, `${method} ${response.body}`);
		}
	});
});
