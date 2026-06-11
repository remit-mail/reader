import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AccountItem } from "@remit/remit-electrodb-service";
import {
	RefreshTokenError,
	type TokenSet,
} from "@remit/mail-oauth-service";
import {
	type EncryptedPayload,
	serializeEncryptedPayload,
} from "@remit/secrets-service";
import {
	type AccountCredentialsDeps,
	resolveConnectionCredentials,
} from "./account-credentials.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const makeEncryptedHash = (secret: string): string =>
	JSON.stringify(
		serializeEncryptedPayload({
			encryptedDek: Buffer.from(`dek-${secret}`),
			encryptedData: Buffer.from(`data-${secret}`),
			iv: Buffer.from(`iv-${secret}`),
			authTag: Buffer.from(`tag-${secret}`),
		}),
	);

const buildAccount = (overrides: Partial<AccountItem> = {}): AccountItem =>
	({
		accountId: "acct-1",
		accountConfigId: "cfg-1",
		username: "alice@example.com",
		email: "alice@example.com",
		authType: "password",
		passwordHash: makeEncryptedHash("password-secret"),
		imapHost: "imap.example.com",
		imapPort: 993,
		imapTls: true,
		imapStartTls: false,
		isActive: true,
		connectionState: "not_authenticated",
		createdAt: 0,
		updatedAt: 0,
		...overrides,
	}) as unknown as AccountItem;

const stubSecrets = (returnValue?: string) => ({
	decrypt: async (payload: EncryptedPayload): Promise<string> =>
		returnValue ?? payload.encryptedDek.toString(),
	encrypt: async (plaintext: string): Promise<EncryptedPayload> => ({
		encryptedDek: Buffer.from(`dek-enc-${plaintext}`),
		encryptedData: Buffer.from(`data-enc-${plaintext}`),
		iv: Buffer.from("iv"),
		authTag: Buffer.from("tag"),
	}),
});

const stubTokenService = (
	tokenSet: TokenSet,
): AccountCredentialsDeps["tokenService"] => ({
	getAccessToken: async (_cacheKey: string, _refreshToken: string) => tokenSet,
});

const stubPersist = (): {
	calls: Array<{ accountId: string; hash: string; updatedAt: number }>;
	fn: AccountCredentialsDeps["persistRotatedToken"];
} => {
	const calls: Array<{ accountId: string; hash: string; updatedAt: number }> =
		[];
	return {
		calls,
		fn: async (accountId, hash, updatedAt) => {
			calls.push({ accountId, hash, updatedAt });
		},
	};
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("resolveConnectionCredentials", () => {
	describe("password path", () => {
		it("decrypts passwordHash and returns a password credential", async () => {
			const account = buildAccount({ authType: "password" });
			const secrets = stubSecrets();
			const persist = stubPersist();

			const creds = await resolveConnectionCredentials(account, {
				secrets,
				tokenService: stubTokenService({ accessToken: "tok", expiresAt: 9999 }),
				persistRotatedToken: persist.fn,
			});

			assert.equal(creds.kind, "password");
			if (creds.kind === "password") {
				// stubSecrets returns encryptedDek.toString() = "dek-password-secret"
				assert.equal(creds.password, "dek-password-secret");
			}
			// No persist call on password path
			assert.equal(persist.calls.length, 0);
		});

		it("throws when authType=password but no passwordHash", async () => {
			const account = buildAccount({
				authType: "password",
				passwordHash: undefined,
			});

			await assert.rejects(
				() =>
					resolveConnectionCredentials(account, {
						secrets: stubSecrets(),
						tokenService: stubTokenService({
							accessToken: "tok",
							expiresAt: 9999,
						}),
						persistRotatedToken: stubPersist().fn,
					}),
				/passwordHash/,
			);
		});
	});

	describe("OAuth path", () => {
		const oauthRefreshTokenHash = makeEncryptedHash("refresh-token");

		it("calls tokenService.getAccessToken and returns accessToken credential", async () => {
			const account = buildAccount({
				authType: "oauthMicrosoft",
				oauthRefreshTokenHash,
			});

			const tokenService = stubTokenService({
				accessToken: "access-token-value",
				expiresAt: 9999,
			});
			const persist = stubPersist();

			const creds = await resolveConnectionCredentials(account, {
				secrets: stubSecrets(),
				tokenService,
				persistRotatedToken: persist.fn,
			});

			assert.equal(creds.kind, "accessToken");
			if (creds.kind === "accessToken") {
				assert.equal(creds.accessToken, "access-token-value");
			}
			// No rotation — provider did not return a new refreshToken
			assert.equal(persist.calls.length, 0);
		});

		it("persists rotated refresh token BEFORE returning credentials", async () => {
			const account = buildAccount({
				authType: "oauthMicrosoft",
				oauthRefreshTokenHash,
			});

			// Track call order
			const callOrder: string[] = [];

			const tokenService: AccountCredentialsDeps["tokenService"] = {
				getAccessToken: async () => {
					callOrder.push("getAccessToken");
					return {
						accessToken: "new-access",
						expiresAt: 9999,
						refreshToken: "new-refresh-token",
					};
				},
			};

			const persistRotatedToken: AccountCredentialsDeps["persistRotatedToken"] =
				async (id, hash, _updatedAt) => {
					callOrder.push("persist");
					assert.equal(id, "acct-1");
					// hash must be a valid JSON-serialized encrypted payload
					const parsed = JSON.parse(hash);
					assert.ok(parsed.encryptedDek, "encryptedDek must be present");
				};

			const creds = await resolveConnectionCredentials(account, {
				secrets: stubSecrets(),
				tokenService,
				persistRotatedToken,
			});

			// persist must happen BEFORE returning
			assert.deepEqual(callOrder, ["getAccessToken", "persist"]);
			assert.equal(creds.kind, "accessToken");
		});

		it("propagates RefreshTokenError reauth-required", async () => {
			const account = buildAccount({
				authType: "oauthMicrosoft",
				oauthRefreshTokenHash,
			});

			const tokenService: AccountCredentialsDeps["tokenService"] = {
				getAccessToken: async () => {
					throw new RefreshTokenError({
						kind: "reauth-required",
						code: "invalid_grant",
					});
				},
			};

			await assert.rejects(
				() =>
					resolveConnectionCredentials(account, {
						secrets: stubSecrets(),
						tokenService,
						persistRotatedToken: stubPersist().fn,
					}),
				RefreshTokenError,
			);
		});

		it("throws when authType=oauthMicrosoft but no oauthRefreshTokenHash", async () => {
			const account = buildAccount({
				authType: "oauthMicrosoft",
				oauthRefreshTokenHash: undefined,
			});

			await assert.rejects(
				() =>
					resolveConnectionCredentials(account, {
						secrets: stubSecrets(),
						tokenService: stubTokenService({
							accessToken: "tok",
							expiresAt: 9999,
						}),
						persistRotatedToken: stubPersist().fn,
					}),
				/oauthRefreshTokenHash/,
			);
		});
	});
});
