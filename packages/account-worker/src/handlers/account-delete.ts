import type { Logger } from "@remit/logger";
import {
	type CascadeEntity,
	type CascadeServices,
	enumerateCascadeEntities,
} from "../cascade.js";
import type { DeletionCapabilities } from "../deletion-port.js";
import type {
	AccountDeleteEvent,
	AccountDeleteFinalizeEvent,
} from "../events.js";

export interface AccountDeleteDeps {
	services: CascadeServices;
	capabilities: DeletionCapabilities;
}

/**
 * GDPR hard-delete: every row tied to the deleted AccountConfig is removed and
 * every stored object under `accounts/{accountConfigId}/` and
 * `exports/{accountConfigId}/` is purged. The AccountConfig row itself is the
 * LAST delete so that a mid-cascade replay still sees the cascade-in-progress
 * flag (`deletedAt` set, `isActive=false`, written API-side) and re-runs
 * cleanly. After a successful run nothing tied to the AccountConfig persists.
 *
 * Step order (non-negotiable per #320):
 *   1. Content invalidation — runs FIRST so cached body parts cannot leak after
 *      the underlying objects are gone (a no-op where no CDN fronts content).
 *   2. Relational/DDB cascade delete in dependency order (children → parents).
 *   3. Storage prefix cleanup: the mail under `accounts/{accountConfigId}/`,
 *      then the export archives under `exports/{accountConfigId}/`.
 *   4. AccountConfig delete.
 *
 * Idempotency: every step is replay-safe. The cascade on a missing key is a
 * no-op, storage prefix delete on missing keys is a no-op, and invalidation is
 * always idempotent. No explicit "already deleted" pre-checks — they make
 * replays racier, not safer. Errors propagate so the queue retries the message;
 * eventually the DLQ alarm fires and an operator inspects the failure.
 */
export const finalizeAccountDelete = async (
	event: AccountDeleteFinalizeEvent,
	log: Logger,
	{ services, capabilities }: AccountDeleteDeps,
): Promise<void> => {
	const { accountConfigId } = event;

	// Validate every deploy-time precondition BEFORE the first destructive step,
	// so a missing var fails loud instead of deleting rows in the cascade and
	// only then erroring at the storage step.
	await capabilities.assertReady(log);

	log.info(
		{ accountConfigId },
		"Invalidating cached content for erased account",
	);
	await capabilities.invalidateContent(accountConfigId, log);

	// A redelivered, already-completed cascade finds no AccountConfig row:
	// `describe()` throws `NotFoundError`, which is the success signal.
	let entities: CascadeEntity[];
	try {
		const enumeration = await enumerateCascadeEntities(
			accountConfigId,
			services,
			log,
		);
		entities = enumeration.entities;
	} catch (error) {
		if ((error as { name?: string })?.name === "NotFoundError") {
			log.info(
				{ accountConfigId },
				"Cascade already complete (AccountConfig not found on replay) — no-op",
			);
			return;
		}
		throw error;
	}
	const cascadeEntities = entities.filter(
		(e) => e.entityType !== "AccountConfig",
	);
	await capabilities.cascadeDelete(cascadeEntities, log);

	await capabilities.deleteStoragePrefix(`accounts/${accountConfigId}/`, log);
	await capabilities.deleteStoragePrefix(`exports/${accountConfigId}/`, log);

	await services.accountConfigService.delete(accountConfigId);
	log.info({ accountConfigId }, "AccountConfig deleted; cascade complete");
};

/**
 * Account deletion on a host that runs the whole erase in one consumer: sign
 * the user out, then run the finalize cascade in place, where the AWS stack
 * hands it to the separately granted finalize worker.
 */
export const processAccountDelete = async (
	event: AccountDeleteEvent,
	log: Logger,
	deps: AccountDeleteDeps,
): Promise<void> => {
	const { accountConfigId } = event;
	const [accountConfig] = await deps.services.accountConfigService.get([
		accountConfigId,
	]);
	if (accountConfig === undefined) {
		log.info(
			{ accountConfigId },
			"AccountConfig already erased on replay — no-op",
		);
		return;
	}
	await deps.capabilities.signOut(accountConfig.userId, log);
	await finalizeAccountDelete(
		{ type: "FinalizeAccountDelete", accountConfigId },
		log,
		deps,
	);
};
