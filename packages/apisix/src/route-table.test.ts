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

const OIDC_PLUGIN = "      openid-connect:\n        bearer_only: true";

const routeBlock = (config: string, uri: string): string =>
	config
		.split(/^ {2}- id: /m)
		.find((block) => block.includes(`uri: '${uri}'`)) ?? "";

test("the exempted callback is the Microsoft OAuth callback, GET only", () => {
	assert.deepEqual([...PUBLIC_ROUTES], [{ method: "GET", path: CALLBACK }]);
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

test("only the callback path is exempt", () => {
	const routes = buildRoutes([CALLBACK, NEIGHBOUR]);

	assert.deepEqual(
		routes.map((route) => route.authenticated),
		[false, true],
	);
});

test("an exemption the spec no longer declares fails the generator", () => {
	assert.throws(() => assertPublicRoutesExist([NEIGHBOUR]), /callback/);
	assertPublicRoutesExist([CALLBACK, NEIGHBOUR]);
});
