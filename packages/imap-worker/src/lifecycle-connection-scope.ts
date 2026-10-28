import type { ConnectionScopeFactory } from "@remit/backend/create-remit-client";
import type { AccountItem } from "@remit/data-ports";
import { ConflictError } from "@remit/data-ports/errors";
import type { Logger } from "@remit/logger";
import type { ConnectionScope } from "@remit/mailbox-service";
import type { MailCredentials } from "@remit/mailbox-service/types";
import type { TokenService } from "./context.js";
import { withOAuthLifecycle } from "./with-oauth-lifecycle.js";
import { buildLifecycleDeps } from "./with-oauth-lifecycle-deps.js";

/**
 * The account holds no credential a connection can be opened with: it stores
 * none, or its OAuth consent was withdrawn. The account has already been
 * flipped to the state that says so; the caller has to reconnect it.
 */
export class AccountNeedsReconnectError extends ConflictError {
	override name = "AccountNeedsReconnectError";

	constructor(accountId: string) {
		super(`Account ${accountId} has to be reconnected before it can be read`);
		this.publicApiError = {
			code: "account_needs_reconnect",
			details: { accountId },
		};
	}
}

export type OpenConnection = (
	account: AccountItem,
	credentials: MailCredentials,
) => ConnectionScope | Promise<ConnectionScope>;

/**
 * The read path's connection scope, resolving credentials under the same OAuth
 * lifecycle the queue handlers run: a rotated refresh token is persisted, and a
 * revoked token or a missing credential flips the account's connection state
 * and answers 409 instead of surfacing as a 500.
 */
export const lifecycleConnectionScope =
	(
		tokenService: TokenService,
		open: OpenConnection,
		log: Logger,
	): ConnectionScopeFactory =>
	(accountService, secrets) =>
	async (accountId) => {
		const account = await accountService.get(accountId);
		const opened: ConnectionScope[] = [];
		await withOAuthLifecycle(
			buildLifecycleDeps(secrets, accountService, tokenService),
			account,
			log,
			async (credentials) => {
				opened.push(await open(account, credentials));
			},
		);
		const [scope] = opened;
		if (scope === undefined) throw new AccountNeedsReconnectError(accountId);
		return scope;
	};
