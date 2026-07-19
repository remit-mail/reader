import type { IAccountConfigRepository } from "@remit/data-ports";
import { ConflictError, NotFoundError } from "@remit/data-ports/errors";

/**
 * Ensure an AccountConfig row exists for the given id. A first-time caller
 * coming from Cognito will not yet have one; subsequent calls are idempotent.
 *
 * We attempt a read first to avoid relying on a race on `create()` — the
 * deterministic id (derived from Cognito `sub`) makes both paths safe.
 */
export const ensureAccountConfig = async (
	accountConfig: IAccountConfigRepository,
	accountConfigId: string,
): Promise<void> => {
	const existing = await accountConfig.get(accountConfigId).catch((err) => {
		if (err instanceof NotFoundError) return undefined;
		throw err;
	});
	if (existing) return;

	await accountConfig
		.create({
			accountConfigId,
			userId: accountConfigId,
		})
		.catch((err) => {
			if (err instanceof ConflictError) return;
			throw err;
		});
};
