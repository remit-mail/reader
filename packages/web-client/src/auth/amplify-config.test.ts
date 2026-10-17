import assert from "node:assert";
import { describe, test } from "node:test";

type TestConfig = {
	cognito?: {
		userPoolId?: string;
		clientId?: string;
		domain?: string;
		region?: string;
	};
	appOrigin?: string;
};
let cacheBust = 0;

const loadModule = async (config: TestConfig) => {
	cacheBust += 1;
	globalThis.__REMIT_CONFIG__ = config;
	return import(`./amplify-config.ts?v=${cacheBust}`);
};

const fullConfig: TestConfig = {
	cognito: {
		userPoolId: "us-east-1_pool",
		clientId: "client-id",
		domain: "example.auth.us-east-1.amazoncognito.com",
		region: "us-east-1",
	},
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
