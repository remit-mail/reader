import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import {
	__resetRouteBreadcrumbs,
	getRecentRoutes,
	recordRoute,
} from "./route-breadcrumbs";

beforeEach(() => {
	__resetRouteBreadcrumbs();
});

describe("recordRoute", () => {
	it("captures the pathname with a timestamp", () => {
		recordRoute("/mail/inbox");
		const [entry] = getRecentRoutes();
		assert.equal(entry.path, "/mail/inbox");
		assert.ok(entry.timestamp);
	});

	it("strips a query string — never the user's search text", () => {
		recordRoute("/mail/search?q=confidential");
		const [entry] = getRecentRoutes();
		assert.equal(entry.path, "/mail/search");
		assert.ok(!JSON.stringify(entry).includes("confidential"));
	});

	it("collapses a repeated navigation to the same path", () => {
		recordRoute("/mail/inbox");
		recordRoute("/mail/inbox");
		assert.equal(getRecentRoutes().length, 1);
	});

	it("keeps only the last eight navigations", () => {
		for (let i = 0; i < 12; i++) recordRoute(`/mail/${i}`);
		const entries = getRecentRoutes();
		assert.equal(entries.length, 8);
		assert.equal(entries[0].path, "/mail/4");
		assert.equal(entries[7].path, "/mail/11");
	});
});
