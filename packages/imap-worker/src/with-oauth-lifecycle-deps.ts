import type { IAccountRepository } from "@remit/data-ports";
import type { SecretsService } from "@remit/secrets-service";
import type { TokenService } from "./context.js";
import type {
	ConnectionStateValue,
	OAuthLifecycleDeps,
} from "./with-oauth-lifecycle.js";

export const buildLifecycleDeps = (
	secrets: SecretsService,
	accountService: IAccountRepository,
	tokenService: TokenService,
): OAuthLifecycleDeps => ({
	secrets,
	tokenService,
	persistRotatedToken: async (accountId, encryptedHash, updatedAt) => {
		await accountService.update(accountId, {
			oauthRefreshTokenHash: encryptedHash,
			oauthTokenUpdatedAt: updatedAt,
		});
	},
	// A state flip with no reason of its own removes the stored one. Left in
	// place it would describe a failure the account has moved on from — the
	// mailbox a sync could not find, still on the card beside a Reconnect
	// button, after the token was revoked hours later.
	updateConnectionState: async (
		accountId: string,
		state: ConnectionStateValue,
		lastError?: string,
	) => {
		await accountService.update(
			accountId,
			{ connectionState: state, lastError },
			lastError === undefined ? ["lastError"] : undefined,
		);
	},
});
