/**
 * How a switched-off service reads wherever its account or its stored rows are
 * (#1179). Every surface says the same thing, and the notice over stored rows
 * says what stayed before it says what stopped.
 */
import "@remit/test-dom";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import {
	AccountServiceOffBadge,
	AccountServiceOffNotice,
} from "./account-service-status.js";

describe("AccountServiceOffBadge", () => {
	it("labels a mail-disabled account", () => {
		assert.match(
			renderToString(
				createElement(AccountServiceOffBadge, { service: "Mail" }),
			),
			/mail sync off/,
		);
	});

	it("labels a calendar-disabled account", () => {
		assert.match(
			renderToString(
				createElement(AccountServiceOffBadge, { service: "Calendar" }),
			),
			/calendar sync off/,
		);
	});
});

describe("AccountServiceOffNotice", () => {
	it("says the stored mail is there before it says sync stopped", () => {
		const html = renderToString(
			createElement(AccountServiceOffNotice, { service: "Mail" }),
		);
		assert.match(html, /Everything already synced is here to read/);
		assert.ok(
			html.indexOf("here to read") < html.indexOf("nothing new arrives"),
		);
	});

	it("keeps a paused calendar's events on the calendar", () => {
		assert.match(
			renderToString(
				createElement(AccountServiceOffNotice, { service: "Calendar" }),
			),
			/Its events stay on your calendar/,
		);
	});

	it("states the account rather than raising an alarm", () => {
		assert.match(
			renderToString(
				createElement(AccountServiceOffNotice, { service: "Mail" }),
			),
			/role="status"/,
		);
	});

	it("offers the way back on only when it is given one", () => {
		assert.doesNotMatch(
			renderToString(
				createElement(AccountServiceOffNotice, { service: "Mail" }),
			),
			/Turn mail back on/,
		);
		assert.match(
			renderToString(
				createElement(AccountServiceOffNotice, {
					service: "Mail",
					onEnable: () => {},
				}),
			),
			/Turn mail back on/,
		);
	});
});
