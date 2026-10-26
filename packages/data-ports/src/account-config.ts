import { ConflictError, NotFoundError } from "./errors.js";
import type { AccountConfigItem, CreateAccountConfigInput } from "./types.js";

export interface AccountConfigCreator {
	get: (accountConfigId: string) => Promise<AccountConfigItem>;
	create: (input: CreateAccountConfigInput) => Promise<AccountConfigItem>;
}

/**
 * The one way an AccountConfig row comes into being. Its id is derived from the
 * caller's identity, so the row is its own owner: `userId` is the id itself,
 * whichever path materializes it first.
 */
export const ensureAccountConfig = async (
	accountConfig: AccountConfigCreator,
	accountConfigId: string,
): Promise<AccountConfigItem> => {
	const existing = await accountConfig
		.get(accountConfigId)
		.catch((err: unknown) => {
			if (err instanceof NotFoundError) return undefined;
			throw err;
		});
	if (existing) return existing;

	return accountConfig
		.create({ accountConfigId, userId: accountConfigId })
		.catch((err: unknown) => {
			if (err instanceof ConflictError)
				return accountConfig.get(accountConfigId);
			throw err;
		});
};
