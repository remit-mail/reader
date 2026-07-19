import assert from "node:assert";
import { beforeEach, describe, test } from "node:test";

type TestConfig = {
	cognito?: {
		userPoolId?: string;
		clientId?: string;
		domain?: string;
		region?: string;
	};
	appOrigin?: string;
};
type AmplifyCall = {
	Auth?: {
		Cognito?: {
			userPoolId?: string;
			userPoolClientId?: string;
			loginWith?: {
				oauth?: {
					domain?: string;
					redirectSignIn?: string[];
					redirectSignOut?: string[];
					responseType?: string;
					scopes?: string[];
				};
			};
		};
	};
};

declare global {
	// eslint-disable-next-line no-var
	var __AMPLIFY_MOCKS__: { configureCalls: AmplifyCall[] } | undefined;
	// eslint-disable-next-line no-var
	var __CACHE_BUST__: number | undefined;
}

let cacheBust = 0;

const loadModule = async (config: TestConfig) => {
	cacheBust += 1;
	globalThis.__CACHE_BUST__ = cacheBust;
	globalThis.__REMIT_CONFIG__ = config;
	globalThis.__AMPLIFY_MOCKS__ = { configureCalls: [] };
	return import(`./amplify-config.ts?v=${cacheBust}`);
};

const fullConfig: TestConfig = {
	cognito: {
		userPoolId: "us-east-1_pool",
		clientId: "client-id",
		domain: "example.auth.us-east-1.amazoncognito.com",
		region: "us-east-1",
	},
	appOrigin: "https://app.example.com",
};

describe("isCognitoConfigured", () => {
	test("returns true when userPoolId and clientId are present", async () => {
		const mod = await loadModule(fullConfig);
		assert.equal(mod.isCognitoConfigured(), true);
	});

	test("returns false when both values are missing", async () => {
		const mod = await loadModule({});
		assert.equal(mod.isCognitoConfigured(), false);
	});

	test("returns false when only userPoolId is set", async () => {
		const mod = await loadModule({ cognito: { userPoolId: "pool" } });
		assert.equal(mod.isCognitoConfigured(), false);
	});

	test("returns false when only clientId is set", async () => {
		const mod = await loadModule({ cognito: { clientId: "client" } });
		assert.equal(mod.isCognitoConfigured(), false);
	});
});

describe("configureAmplify", () => {
	let originalWarn: typeof console.warn;
	let warnings: unknown[][];

	beforeEach(() => {
		originalWarn = console.warn;
		warnings = [];
		console.warn = (...args: unknown[]) => {
			warnings.push(args);
		};
	});

	test("warns and does not call Amplify.configure when unconfigured", async () => {
		const mod = await loadModule({});
		mod.configureAmplify();
		console.warn = originalWarn;
		assert.equal(globalThis.__AMPLIFY_MOCKS__?.configureCalls.length, 0);
		assert.equal(warnings.length, 1);
		const message = String(warnings[0][0]);
		assert.ok(
			message.includes("Cognito"),
			`expected warning to mention Cognito, got: ${message}`,
		);
	});

	test("passes userPoolId and clientId to Amplify.configure", async () => {
		const mod = await loadModule(fullConfig);
		mod.configureAmplify();
		console.warn = originalWarn;
		const calls = globalThis.__AMPLIFY_MOCKS__?.configureCalls ?? [];
		assert.equal(calls.length, 1);
		const cognito = calls[0]?.Auth?.Cognito;
		assert.equal(cognito?.userPoolId, "us-east-1_pool");
		assert.equal(cognito?.userPoolClientId, "client-id");
	});

	test("wires OAuth block with appOrigin in redirect arrays when domain set", async () => {
		const mod = await loadModule(fullConfig);
		mod.configureAmplify();
		console.warn = originalWarn;
		const oauth =
			globalThis.__AMPLIFY_MOCKS__?.configureCalls[0]?.Auth?.Cognito?.loginWith
				?.oauth;
		assert.ok(oauth, "expected oauth block to be present");
		assert.equal(oauth?.domain, "example.auth.us-east-1.amazoncognito.com");
		assert.deepEqual(oauth?.redirectSignIn, ["https://app.example.com"]);
		assert.deepEqual(oauth?.redirectSignOut, ["https://app.example.com"]);
		assert.equal(oauth?.responseType, "code");
	});

	test("omits loginWith block when no domain configured", async () => {
		const mod = await loadModule({
			cognito: { userPoolId: "pool", clientId: "client" },
		});
		mod.configureAmplify();
		console.warn = originalWarn;
		const cognito =
			globalThis.__AMPLIFY_MOCKS__?.configureCalls[0]?.Auth?.Cognito;
		assert.equal(cognito?.loginWith, undefined);
	});

	test("uses empty redirect arrays when domain present but appOrigin missing", async () => {
		const mod = await loadModule({
			cognito: {
				userPoolId: "pool",
				clientId: "client",
				domain: "example.auth.us-east-1.amazoncognito.com",
			},
		});
		mod.configureAmplify();
		console.warn = originalWarn;
		const oauth =
			globalThis.__AMPLIFY_MOCKS__?.configureCalls[0]?.Auth?.Cognito?.loginWith
				?.oauth;
		assert.ok(oauth);
		assert.deepEqual(oauth?.redirectSignIn, []);
		assert.deepEqual(oauth?.redirectSignOut, []);
	});
});
