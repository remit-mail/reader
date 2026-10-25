import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { loadMsOAuth } from "./msoauth.js";

describe("loadMsOAuth", () => {
	it("hands back the configured client credentials", async () => {
		const config = {
			mode: "Enabled" as const,
			redirectUri: "https://mail.example.com/cb",
			overrides: {},
			credentials: async () => ({
				clientId: "client-id",
				clientSecret: "client-secret",
			}),
		};

		assert.deepEqual(await loadMsOAuth(config), {
			config,
			credentials: { clientId: "client-id", clientSecret: "client-secret" },
		});
	});

	it("says an instance has no Microsoft app registered", async () => {
		await assert.rejects(
			loadMsOAuth({ mode: "Disabled" }),
			/No Microsoft OAuth credentials are configured on this instance/,
		);
	});
});
