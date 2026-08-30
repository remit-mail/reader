import assert from "node:assert/strict";
import { test } from "node:test";
import {
	assertPublicRoutesExist,
	buildRoutes,
	PUBLIC_ROUTES,
	renderConfig,
} from "./route-table.js";

const CALLBACK = "/accounts/oauth/microsoft/callback";
const NEIGHBOUR = "/accounts/oauth/microsoft/start";
const FEED = "/feeds/calendar/{feedToken}.ics";

const OIDC_PLUGIN = "      openid-connect:\n        bearer_only: true";

const routeBlock = (config: string, uri: string): string =>
	config
		.split(/^ {2}- id: /m)
		.find((block) => block.includes(`uri: '${uri}'`)) ?? "";

test("the exempt paths are the OAuth callback and the calendar feed, GET only", () => {
	assert.deepEqual(
		PUBLIC_ROUTES.map((route) => [route.method, route.path]),
		[
			["GET", CALLBACK],
			["GET", FEED],
		],
	);
});

test("the feed exemption is pinned to the shape of a token, not to the prefix", () => {
	const config = renderConfig({
		routes: buildRoutes([FEED]),
		oidcPlugin: OIDC_PLUGIN,
		backendHost: "backend",
		backendPort: 5436,
	});

	const block = routeBlock(config, "/feeds/calendar/*");
	const condition = block.match(/^ {6}- (\[.+\])$/m)?.[1];
	assert.ok(
		condition,
		"the wildcard route needs a vars condition or it is the prefix that is public",
	);

	const [field, operator, pattern] = JSON.parse(condition) as string[];
	assert.equal(field, "uri");
	assert.equal(operator, "~~");

	// The exemption must cover exactly the addresses that are handed out: 43
	// base64url characters, and the suffix as a literal rather than a regex dot.
	const uri = new RegExp(pattern as string);
	assert.ok(uri.test(`/feeds/calendar/${"a".repeat(43)}.ics`));
	assert.equal(uri.test(`/feeds/calendar/${"a".repeat(42)}.ics`), false);
	assert.equal(uri.test(`/feeds/calendar/${"a".repeat(44)}.ics`), false);
	assert.equal(uri.test(`/feeds/calendar/${"a".repeat(43)}Xics`), false);
	assert.equal(
		uri.test(`/feeds/calendar/${"a".repeat(43)}.ics/../../config`),
		false,
	);
	assert.equal(uri.test("/feeds/calendar/anything-else"), false);
});

test("a route with no exemption carries no vars condition", () => {
	const config = renderConfig({
		routes: buildRoutes([NEIGHBOUR, "/accounts/{accountId}"]),
		oidcPlugin: OIDC_PLUGIN,
		backendHost: "backend",
		backendPort: 5436,
	});

	assert.equal(config.includes("vars:"), false);
});

test("a token segment carrying the .ics suffix routes as a trailing wildcard", () => {
	// radixtree has no spelling for a parameter followed by literal text inside
	// one segment, and a route it cannot express is a subscription that 404s at
	// the edge.
	const config = renderConfig({
		routes: buildRoutes([FEED]),
		oidcPlugin: OIDC_PLUGIN,
		backendHost: "backend",
		backendPort: 5436,
	});

	const block = routeBlock(config, "/feeds/calendar/*");
	assert.match(block, /methods:\n {6}- GET/);
	assert.equal(block.includes("openid-connect"), false);
});

test("a mixed segment anywhere but last fails the generator", () => {
	assert.throws(
		() => buildRoutes(["/feeds/{feedToken}.ics/events"]),
		/no route form/,
	);
});

test("the callback route carries no oidc plugin and its neighbour does", () => {
	const config = renderConfig({
		routes: buildRoutes([CALLBACK, NEIGHBOUR, "/accounts/{accountId}"]),
		oidcPlugin: OIDC_PLUGIN,
		backendHost: "backend",
		backendPort: 5436,
	});

	assert.equal(routeBlock(config, CALLBACK).includes("openid-connect"), false);
	assert.match(routeBlock(config, CALLBACK), /methods:\n {6}- GET/);
	assert.match(routeBlock(config, NEIGHBOUR), /openid-connect/);
	assert.match(routeBlock(config, "/accounts/:accountId"), /openid-connect/);
});

test("only a listed path is exempt", () => {
	const routes = buildRoutes([CALLBACK, NEIGHBOUR, FEED]);

	assert.deepEqual(
		routes.map((route) => route.authenticated),
		[false, true, false],
	);
});

test("an exemption the spec no longer declares fails the generator", () => {
	assert.throws(() => assertPublicRoutesExist([NEIGHBOUR, FEED]), /callback/);
	assert.throws(() => assertPublicRoutesExist([CALLBACK, NEIGHBOUR]), /feeds/);
	assertPublicRoutesExist([CALLBACK, NEIGHBOUR, FEED]);
});
