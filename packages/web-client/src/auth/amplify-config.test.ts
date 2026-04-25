import assert from "node:assert";
import { beforeEach, describe, test } from "node:test";

type ViteEnvShape = Record<string, string | undefined>;
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
	var __VITE_ENV__: ViteEnvShape | undefined;
	// eslint-disable-next-line no-var
	var __AMPLIFY_MOCKS__: { configureCalls: AmplifyCall[] } | undefined;
	// eslint-disable-next-line no-var
	var __CACHE_BUST__: number | undefined;
}

let cacheBust = 0;

const loadModule = async (env: ViteEnvShape) => {
	cacheBust += 1;
	globalThis.__CACHE_BUST__ = cacheBust;
	globalThis.__VITE_ENV__ = env;
	globalThis.__AMPLIFY_MOCKS__ = { configureCalls: [] };
	return import(`./amplify-config.ts?v=${cacheBust}`);
};

const fullEnv: ViteEnvShape = {
	VITE_COGNITO_USER_POOL_ID: "us-east-1_pool",
	VITE_COGNITO_CLIENT_ID: "client-id",
	VITE_COGNITO_DOMAIN: "example.auth.us-east-1.amazoncognito.com",
	VITE_COGNITO_REGION: "us-east-1",
	VITE_APP_ORIGIN: "https://app.example.com",
};

describe("isCognitoConfigured", () => {
	test("returns true when userPoolId and clientId are present", async () => {
		const mod = await loadModule(fullEnv);
		assert.equal(mod.isCognitoConfigured(), true);
	});

	test("returns false when both env vars are missing", async () => {
		const mod = await loadModule({});
		assert.equal(mod.isCognitoConfigured(), false);
	});

	test("returns false when only userPoolId is set", async () => {
		const mod = await loadModule({ VITE_COGNITO_USER_POOL_ID: "pool" });
		assert.equal(mod.isCognitoConfigured(), false);
	});

	test("returns false when only clientId is set", async () => {
		const mod = await loadModule({ VITE_COGNITO_CLIENT_ID: "client" });
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
			message.includes("VITE_COGNITO_USER_POOL_ID"),
			`expected warning to mention env var, got: ${message}`,
		);
	});

	test("passes userPoolId and clientId to Amplify.configure", async () => {
		const mod = await loadModule(fullEnv);
		mod.configureAmplify();
		console.warn = originalWarn;
		const calls = globalThis.__AMPLIFY_MOCKS__?.configureCalls ?? [];
		assert.equal(calls.length, 1);
		const cognito = calls[0]?.Auth?.Cognito;
		assert.equal(cognito?.userPoolId, "us-east-1_pool");
		assert.equal(cognito?.userPoolClientId, "client-id");
	});

	test("wires OAuth block with appOrigin in redirect arrays when domain set", async () => {
		const mod = await loadModule(fullEnv);
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
			VITE_COGNITO_USER_POOL_ID: "pool",
			VITE_COGNITO_CLIENT_ID: "client",
		});
		mod.configureAmplify();
		console.warn = originalWarn;
		const cognito =
			globalThis.__AMPLIFY_MOCKS__?.configureCalls[0]?.Auth?.Cognito;
		assert.equal(cognito?.loginWith, undefined);
	});

	test("uses empty redirect arrays when domain present but appOrigin missing", async () => {
		const mod = await loadModule({
			VITE_COGNITO_USER_POOL_ID: "pool",
			VITE_COGNITO_CLIENT_ID: "client",
			VITE_COGNITO_DOMAIN: "example.auth.us-east-1.amazoncognito.com",
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
