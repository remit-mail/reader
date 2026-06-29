import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";

import {
	createMailOAuthService,
	microsoftProviderConfig,
	RefreshTokenError,
} from "../index.js";
import type { OAuthProviderConfig } from "../types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeConfig(
	overrides?: Partial<OAuthProviderConfig>,
): OAuthProviderConfig {
	return microsoftProviderConfig({
		clientId: "test-client-id",
		clientSecret: "test-client-secret",
		overrides: {
			tokenEndpoint: "https://example.com/token",
			authorizationEndpoint: "https://example.com/authorize",
			...overrides,
		},
	});
}

function nowSecs(): number {
	return Math.floor(Date.now() / 1000);
}

/** Build a fake fetch that returns the given JSON body with the given HTTP status. */
function makeFetch(status: number, body: unknown): typeof globalThis.fetch {
	return async (_url, _init) => {
		return {
			ok: status >= 200 && status < 300,
			status,
			json: async () => body,
		} as Response;
	};
}

/** Counts how many times fetch was called. */
function countingFetch(
	status: number,
	body: unknown,
): { fetch: typeof globalThis.fetch; count: () => number } {
	let n = 0;
	return {
		fetch: async (url, init) => {
			n++;
			return makeFetch(status, body)(url, init);
		},
		count: () => n,
	};
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe("mail-oauth-service", () => {
	let originalFetch: typeof globalThis.fetch;

	before(() => {
		originalFetch = globalThis.fetch;
	});

	after(() => {
		globalThis.fetch = originalFetch;
	});

	// 1. Happy refresh
	test("refresh: 200 response produces correct TokenSet", async () => {
		const expiresIn = 3600;
		globalThis.fetch = makeFetch(200, {
			access_token: "new-access-token",
			expires_in: expiresIn,
		});

		const svc = createMailOAuthService(makeConfig());
		const before = nowSecs();
		const result = await svc.refresh("some-refresh-token");
		const after = nowSecs();

		assert.equal(result.accessToken, "new-access-token");
		assert.ok(
			result.expiresAt >= before + expiresIn,
			"expiresAt should be ~now + expires_in",
		);
		assert.ok(
			result.expiresAt <= after + expiresIn + 1,
			"expiresAt should not be too far in the future",
		);
		assert.equal(result.refreshToken, undefined);
	});

	// 2. Token rotation
	test("refresh: rotated refresh_token is surfaced in TokenSet", async () => {
		globalThis.fetch = makeFetch(200, {
			access_token: "access",
			expires_in: 3600,
			refresh_token: "new-refresh-token",
		});

		const svc = createMailOAuthService(makeConfig());
		const result = await svc.refresh("old-refresh-token");

		assert.equal(result.refreshToken, "new-refresh-token");
	});

	// 3. Cache hit
	test("getAccessToken: two calls within expiry window make only 1 fetch", async () => {
		const { fetch, count } = countingFetch(200, {
			access_token: "cached-token",
			expires_in: 3600,
		});
		globalThis.fetch = fetch;

		const svc = createMailOAuthService(makeConfig());
		const r1 = await svc.getAccessToken("user-1", "rt");
		const r2 = await svc.getAccessToken("user-1", "rt");

		assert.equal(count(), 1, "should only fetch once");
		assert.equal(r1.accessToken, "cached-token");
		assert.equal(r2.accessToken, "cached-token");
	});

	// 4. Cache miss at T-5min
	test("getAccessToken: token expiring in 4 minutes triggers refresh", async () => {
		// First call returns a token that expires in 4 minutes (< 5-min buffer)
		let callCount = 0;
		globalThis.fetch = async () => {
			callCount++;
			return {
				ok: true,
				status: 200,
				json: async () => ({
					access_token: `token-${callCount}`,
					expires_in: callCount === 1 ? 4 * 60 : 3600,
				}),
			} as Response;
		};

		const svc = createMailOAuthService(makeConfig());
		// Prime the cache with a soon-expiring token
		const r1 = await svc.getAccessToken("user-2", "rt");
		assert.equal(r1.accessToken, "token-1");

		// Second call should refresh because the token is within the 5-min buffer
		const r2 = await svc.getAccessToken("user-2", "rt");
		assert.equal(callCount, 2, "should have refreshed");
		assert.equal(r2.accessToken, "token-2");
	});

	// 5. Single-flight
	test("getAccessToken: 10 concurrent callers produce exactly 1 fetch", async () => {
		const { fetch, count } = countingFetch(200, {
			access_token: "shared-token",
			expires_in: 3600,
		});
		globalThis.fetch = fetch;

		const svc = createMailOAuthService(makeConfig());
		const results = await Promise.all(
			Array.from({ length: 10 }, () => svc.getAccessToken("user-3", "rt")),
		);

		assert.equal(
			count(),
			1,
			"should only fetch once despite 10 concurrent callers",
		);
		for (const r of results) {
			assert.equal(r.accessToken, "shared-token");
		}
	});

	// 6a. Error mapping: invalid_grant → reauth-required
	describe("error mapping", () => {
		test("invalid_grant → reauth-required", async () => {
			globalThis.fetch = makeFetch(400, {
				error: "invalid_grant",
				error_description: "AADSTS70008: Refresh token expired.",
				error_codes: [70008],
			});

			const svc = createMailOAuthService(makeConfig());
			await assert.rejects(
				() => svc.refresh("bad-rt"),
				(err: unknown) => {
					assert.ok(err instanceof RefreshTokenError);
					assert.equal(err.error.kind, "reauth-required");
					assert.equal(err.error.code, "invalid_grant");
					return true;
				},
			);
		});

		// 6b. error_codes array containing reauth code
		test("error_codes [70008] → reauth-required", async () => {
			globalThis.fetch = makeFetch(400, {
				error: "some_error",
				error_codes: [70008],
			});

			const svc = createMailOAuthService(makeConfig());
			await assert.rejects(
				() => svc.refresh("bad-rt"),
				(err: unknown) => {
					assert.ok(err instanceof RefreshTokenError);
					assert.equal(err.error.kind, "reauth-required");
					return true;
				},
			);
		});

		// 6c. 503 → transient
		test("503 → transient", async () => {
			globalThis.fetch = makeFetch(503, {
				error: "server_error",
				error_description: "Service unavailable",
			});

			const svc = createMailOAuthService(makeConfig());
			await assert.rejects(
				() => svc.refresh("rt"),
				(err: unknown) => {
					assert.ok(err instanceof RefreshTokenError);
					assert.equal(err.error.kind, "transient");
					return true;
				},
			);
		});

		// 6d. 429 → transient
		test("429 → transient", async () => {
			globalThis.fetch = makeFetch(429, {
				error: "too_many_requests",
			});

			const svc = createMailOAuthService(makeConfig());
			await assert.rejects(
				() => svc.refresh("rt"),
				(err: unknown) => {
					assert.ok(err instanceof RefreshTokenError);
					assert.equal(err.error.kind, "transient");
					return true;
				},
			);
		});

		// 6e. invalid_client → config
		test("invalid_client → config", async () => {
			globalThis.fetch = makeFetch(401, {
				error: "invalid_client",
				error_description: "Client secret is invalid.",
			});

			const svc = createMailOAuthService(makeConfig());
			await assert.rejects(
				() => svc.refresh("rt"),
				(err: unknown) => {
					assert.ok(err instanceof RefreshTokenError);
					assert.equal(err.error.kind, "config");
					assert.equal(err.error.code, "invalid_client");
					return true;
				},
			);
		});

		// 6f. network error → transient
		test("network error → transient", async () => {
			globalThis.fetch = async () => {
				throw new Error("ECONNREFUSED");
			};

			const svc = createMailOAuthService(makeConfig());
			await assert.rejects(
				() => svc.refresh("rt"),
				(err: unknown) => {
					assert.ok(err instanceof RefreshTokenError);
					assert.equal(err.error.kind, "transient");
					assert.equal(err.error.code, "network_error");
					return true;
				},
			);
		});
	});

	// 7. No token leak in error
	test("RefreshTokenError does not leak token values", async () => {
		const sensitiveRefreshToken = "super-secret-refresh-token-abc123";

		globalThis.fetch = makeFetch(400, {
			error: "invalid_grant",
			error_codes: [70008],
		});

		const svc = createMailOAuthService(makeConfig());

		let caughtError: unknown;
		try {
			await svc.refresh(sensitiveRefreshToken);
		} catch (e) {
			// biome-ignore lint/plugin/no-silent-catch: test — catch is part of the test assertion; error presence/absence is what's being tested
			caughtError = e;
		}

		assert.ok(caughtError instanceof RefreshTokenError);

		const serialized = JSON.stringify(caughtError.error);
		assert.ok(
			!serialized.includes(sensitiveRefreshToken),
			"serialized error must not contain the refresh token",
		);

		const message = caughtError.message;
		assert.ok(
			!message.includes(sensitiveRefreshToken),
			"error message must not contain the refresh token",
		);
	});

	// 8a. exchangeCode happy path
	test("exchangeCode: success returns TokenSet", async () => {
		globalThis.fetch = makeFetch(200, {
			access_token: "access-from-code",
			expires_in: 3600,
			refresh_token: "refresh-from-code",
			id_token:
				"header.eyJwcmVmZXJyZWRfdXNlcm5hbWUiOiJhbGljZUBvdXRsb29rLmNvbSJ9.sig",
		});

		const svc = createMailOAuthService(makeConfig());
		const result = await svc.exchangeCode(
			"auth-code",
			"https://app.example.com/callback",
		);

		assert.equal(result.accessToken, "access-from-code");
		assert.equal(result.refreshToken, "refresh-from-code");
		assert.equal(
			result.idToken,
			"header.eyJwcmVmZXJyZWRfdXNlcm5hbWUiOiJhbGljZUBvdXRsb29rLmNvbSJ9.sig",
		);
	});

	// 8b. exchangeCode error mapping
	test("exchangeCode: invalid_grant → RefreshTokenError reauth-required", async () => {
		globalThis.fetch = makeFetch(400, {
			error: "invalid_grant",
			error_codes: [70011],
		});

		const svc = createMailOAuthService(makeConfig());
		await assert.rejects(
			() => svc.exchangeCode("bad-code", "https://app.example.com/callback"),
			(err: unknown) => {
				assert.ok(err instanceof RefreshTokenError);
				assert.equal(err.error.kind, "reauth-required");
				return true;
			},
		);
	});

	// buildAuthorizationUrl
	test("buildAuthorizationUrl includes required params", () => {
		const svc = createMailOAuthService(makeConfig());
		const url = new URL(
			svc.buildAuthorizationUrl({
				redirectUri: "https://app.example.com/callback",
				state: "random-state",
				loginHint: "user@example.com",
			}),
		);

		assert.equal(url.searchParams.get("client_id"), "test-client-id");
		assert.equal(url.searchParams.get("response_type"), "code");
		assert.equal(
			url.searchParams.get("redirect_uri"),
			"https://app.example.com/callback",
		);
		assert.equal(url.searchParams.get("state"), "random-state");
		assert.equal(url.searchParams.get("access_type"), "offline");
		assert.equal(url.searchParams.get("prompt"), "consent");
		assert.equal(url.searchParams.get("login_hint"), "user@example.com");
	});

	test("buildAuthorizationUrl omits login_hint when not provided", () => {
		const svc = createMailOAuthService(makeConfig());
		const url = new URL(
			svc.buildAuthorizationUrl({
				redirectUri: "https://app.example.com/callback",
				state: "s",
			}),
		);
		assert.equal(url.searchParams.get("login_hint"), null);
	});
});
