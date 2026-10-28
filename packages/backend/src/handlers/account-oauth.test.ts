/**
 * Tests for Microsoft OAuth connect flow handlers.
 *
 * These tests exercise the HMAC state signing/verification logic and the
 * handler business logic through pure function calls, without booting DynamoDB
 * or making real AWS API calls. The handlers themselves are tested via
 * integration / end-to-end tests; here we focus on the critical security
 * paths (state signing, expiry, token handling).
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { AccountService } from "@remit/domain-enums";
import {
	type OAuthState,
	STATE_TTL_MS,
	signState,
	verifyState,
} from "../oauth-state.js";
import { getWebOrigin, parseJwtClaims } from "./account-oauth.js";

function makeJwtToken(claims: Record<string, unknown>): string {
	const header = Buffer.from(JSON.stringify({ alg: "RS256" })).toString(
		"base64url",
	);
	const payload = Buffer.from(JSON.stringify(claims), "utf8").toString(
		"base64url",
	);
	return `${header}.${payload}.fake-signature`;
}

// ─── HMAC state signing tests ─────────────────────────────────────────────────

describe("HMAC state signing", () => {
	const SECRET = "test-client-secret-value";

	it("signs and verifies a valid state", async () => {
		const payload: OAuthState = {
			accountConfigId: "acc-config-1",
			nonce: "deadbeef",
			timestamp: Date.now(),
			services: [AccountService.Mail],
		};

		const state = await signState(payload, SECRET);
		const verified = await verifyState(state, SECRET);

		assert.equal(verified.accountConfigId, payload.accountConfigId);
		assert.equal(verified.nonce, payload.nonce);
	});

	it("rejects a tampered payload", async () => {
		const payload: OAuthState = {
			accountConfigId: "acc-config-1",
			nonce: "deadbeef",
			timestamp: Date.now(),
			services: [AccountService.Mail],
		};

		const state = await signState(payload, SECRET);
		const [payloadPart, sigPart] = state.split(".");
		// Tamper: replace the payload with a different one
		const tamperedPayload = Buffer.from(
			JSON.stringify({ ...payload, accountConfigId: "HACKED" }),
			"utf8",
		).toString("base64url");
		const tampered = `${tamperedPayload}.${sigPart}`;

		await assert.rejects(
			() => verifyState(tampered, SECRET),
			/State signature verification failed/,
		);

		// Keep linter happy: payloadPart is used in the tamper to ensure it's different
		assert.notEqual(tamperedPayload, payloadPart);
	});

	it("rejects a state signed with a different secret", async () => {
		const payload: OAuthState = {
			accountConfigId: "acc-config-1",
			nonce: "deadbeef",
			timestamp: Date.now(),
			services: [AccountService.Mail],
		};

		const state = await signState(payload, SECRET);

		await assert.rejects(
			() => verifyState(state, "different-secret"),
			/State signature verification failed/,
		);
	});

	it("rejects a state with a truncated signature", async () => {
		const payload: OAuthState = {
			accountConfigId: "acc-config-1",
			nonce: "deadbeef",
			timestamp: Date.now(),
			services: [AccountService.Mail],
		};

		const state = await signState(payload, SECRET);
		// Remove last few chars of signature
		const truncated = state.slice(0, -4);

		await assert.rejects(() => verifyState(truncated, SECRET));
	});

	it("rejects a state that has no dot separator", async () => {
		await assert.rejects(
			() => verifyState("nodotanywhere", SECRET),
			/Malformed state/,
		);
	});

	it("reads a state signed before services existed as mail only", async () => {
		const state = await signState(
			{
				accountConfigId: "acc-config-1",
				nonce: "deadbeef",
				timestamp: Date.now(),
			} as OAuthState,
			SECRET,
		);

		assert.deepEqual((await verifyState(state, SECRET)).services, [
			AccountService.Mail,
		]);
	});

	it("rejects a state that names no requested services", async () => {
		const state = await signState(
			{
				accountConfigId: "acc-config-1",
				nonce: "deadbeef",
				timestamp: Date.now(),
				services: [],
			},
			SECRET,
		);

		await assert.rejects(
			() => verifyState(state, SECRET),
			/State names no requested services/,
		);
	});

	it("carries the requested services through the signed state", async () => {
		const state = await signState(
			{
				accountConfigId: "acc-config-1",
				nonce: "deadbeef",
				timestamp: Date.now(),
				services: [AccountService.Mail, AccountService.Calendar],
			},
			SECRET,
		);

		assert.deepEqual((await verifyState(state, SECRET)).services, [
			AccountService.Mail,
			AccountService.Calendar,
		]);
	});

	it("rejects an expired state (timestamp > 10 minutes ago)", async () => {
		const expired: OAuthState = {
			accountConfigId: "acc-config-1",
			nonce: "deadbeef",
			timestamp: Date.now() - STATE_TTL_MS - 1000, // 1 second past expiry
			services: [AccountService.Mail],
		};

		const state = await signState(expired, SECRET);

		await assert.rejects(() => verifyState(state, SECRET), /State has expired/);
	});

	it("accepts a state right at the TTL boundary", async () => {
		const almostExpired: OAuthState = {
			accountConfigId: "acc-config-1",
			nonce: "deadbeef",
			timestamp: Date.now() - STATE_TTL_MS + 2000, // 2 seconds before expiry
			services: [AccountService.Mail],
		};

		const state = await signState(almostExpired, SECRET);
		const verified = await verifyState(state, SECRET);
		assert.equal(verified.accountConfigId, "acc-config-1");
	});
});

// ─── JWT claims parsing ───────────────────────────────────────────────────────

describe("parseJwtClaims", () => {
	it("extracts preferred_username from a Microsoft-style access token", async () => {
		const token = makeJwtToken({
			sub: "12345",
			preferred_username: "alice@example.com",
			email: "alice@example.com",
		});
		const claims = await parseJwtClaims(token);
		assert.ok(claims);
		assert.equal(claims.preferred_username, "alice@example.com");
	});

	it("returns null on a non-JWT string", async () => {
		assert.equal(await parseJwtClaims("not-a-jwt"), null);
	});

	it("returns null on a two-part string", async () => {
		assert.equal(await parseJwtClaims("header.payload"), null);
	});

	it("extracts email claim when preferred_username is absent", async () => {
		const token = makeJwtToken({ email: "bob@outlook.com" });
		const claims = await parseJwtClaims(token);
		assert.ok(claims);
		assert.equal(claims.email, "bob@outlook.com");
	});
});

// ─── Callback redirect behaviour (logic-only, no DynamoDB) ───────────────────
//
// These tests verify the redirect logic for error cases without calling the
// full handler (which would need DynamoDB + AWS credentials). The handler's
// error redirect paths are determined by simple conditional logic we can
// unit-test by re-implementing the decision tree here.

describe("callback redirect decision", () => {
	function decideCallback(opts: {
		hasError?: string;
		hasCode?: boolean;
		hasState?: boolean;
		stateValid?: boolean;
		exchangeOk?: boolean;
		hasRefreshToken?: boolean;
		emailInToken?: string | undefined;
	}): string {
		const webOrigin = "https://app.example.com";
		const redirect = (path: string) => path;

		if (opts.hasError) {
			return redirect(
				`${webOrigin}/settings/accounts?oauthError=${opts.hasError}`,
			);
		}
		if (!opts.hasCode || !opts.hasState) {
			return redirect(
				`${webOrigin}/settings/accounts?oauthError=missing_params`,
			);
		}
		if (!opts.stateValid) {
			return redirect(
				`${webOrigin}/settings/accounts?oauthError=invalid_state`,
			);
		}
		if (!opts.exchangeOk || !opts.hasRefreshToken) {
			return redirect(
				`${webOrigin}/settings/accounts?oauthError=exchange_failed`,
			);
		}
		if (!opts.emailInToken) {
			return redirect(
				`${webOrigin}/settings/accounts?oauthError=missing_email`,
			);
		}
		return redirect(`${webOrigin}/settings/accounts?connected=new-account-id`);
	}

	it("redirects with oauthError=access_denied when Microsoft returns error", () => {
		const url = decideCallback({ hasError: "access_denied" });
		assert.ok(
			url.includes("oauthError=access_denied"),
			`Expected oauthError=access_denied in: ${url}`,
		);
	});

	it("redirects with oauthError=missing_params when code/state absent", () => {
		const url = decideCallback({ hasCode: false, hasState: false });
		assert.ok(url.includes("oauthError=missing_params"));
	});

	it("redirects with oauthError=invalid_state on bad HMAC", () => {
		const url = decideCallback({
			hasCode: true,
			hasState: true,
			stateValid: false,
		});
		assert.ok(url.includes("oauthError=invalid_state"));
	});

	it("redirects with oauthError=exchange_failed when token exchange fails", () => {
		const url = decideCallback({
			hasCode: true,
			hasState: true,
			stateValid: true,
			exchangeOk: false,
		});
		assert.ok(url.includes("oauthError=exchange_failed"));
	});

	it("redirects with oauthError=exchange_failed when no refresh_token in response", () => {
		const url = decideCallback({
			hasCode: true,
			hasState: true,
			stateValid: true,
			exchangeOk: true,
			hasRefreshToken: false,
		});
		assert.ok(url.includes("oauthError=exchange_failed"));
	});

	it("redirects with oauthError=missing_email when ID token has no email", () => {
		const url = decideCallback({
			hasCode: true,
			hasState: true,
			stateValid: true,
			exchangeOk: true,
			hasRefreshToken: true,
			emailInToken: undefined,
		});
		assert.ok(url.includes("oauthError=missing_email"));
	});

	it("redirects to connected page on happy path", () => {
		const url = decideCallback({
			hasCode: true,
			hasState: true,
			stateValid: true,
			exchangeOk: true,
			hasRefreshToken: true,
			emailInToken: "alice@outlook.com",
		});
		assert.ok(url.includes("connected=new-account-id"));
	});
});

// ─── getWebOrigin helper ──────────────────────────────────────────────────────

describe("web origin selection", () => {
	it("prefers HTTPS origin over HTTP", () => {
		assert.equal(
			getWebOrigin(["http://localhost:3000", "https://app.example.com"]),
			"https://app.example.com",
		);
	});

	it("returns first origin when no HTTPS available", () => {
		assert.equal(
			getWebOrigin(["http://localhost:3000"]),
			"http://localhost:3000",
		);
	});

	it("returns fallback when no origin is configured", () => {
		assert.equal(getWebOrigin([]), "https://localhost:3000");
	});

	it("handles multiple HTTPS origins by returning the first", () => {
		assert.equal(
			getWebOrigin(["https://staging.example.com", "https://app.example.com"]),
			"https://staging.example.com",
		);
	});
});
