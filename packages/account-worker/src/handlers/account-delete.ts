import type { Logger } from "@remit/logger";
import type { CascadeServices } from "../cascade.js";
import type { DeletionCapabilities } from "../deletion-port.js";
import type {
	AccountDeleteEvent,
	AccountDeleteFinalizeEvent,
} from "../events.js";

export interface AccountDeleteDeps {
	services: CascadeServices;
	signOut: DeletionCapabilities["signOut"];
	enqueueFinalize: (event: AccountDeleteFinalizeEvent) => Promise<void>;
}

export const processAccountDelete = async (
	event: AccountDeleteEvent,
	log: Logger,
	{ services, signOut, enqueueFinalize }: AccountDeleteDeps,
): Promise<void> => {
	const { accountConfigId } = event;
	const [accountConfig] = await services.accountConfigService.get([
		accountConfigId,
	]);
	if (accountConfig === undefined) {
		log.info({ accountConfigId }, "AccountConfig already erased — no-op");
		return;
	}

	await signOut(event.userId, log);
	await enqueueFinalize({ type: "FinalizeAccountDelete", accountConfigId });
	log.info({ accountConfigId }, "Enqueued finalize event");
};

export interface AccountDeleteFinalizeDeps {
	services: CascadeServices;
	capabilities: DeletionCapabilities;
}

/**
 * The AccountConfig row is deleted last: while it exists, a replay finds it
 * and runs the whole erase again.
 */
export const finalizeAccountDelete = async (
	event: AccountDeleteFinalizeEvent,
	log: Logger,
	{ services, capabilities }: AccountDeleteFinalizeDeps,
): Promise<void> => {
	const { accountConfigId } = event;
	const [accountConfig] = await services.accountConfigService.get([
		accountConfigId,
	]);
	if (accountConfig === undefined) {
		log.info({ accountConfigId }, "Account erase already complete — no-op");
		return;
	}

	await capabilities.assertReady(log);
	await capabilities.invalidateContent(accountConfigId, log);
	await capabilities.eraseAccountConfig(accountConfigId, log);
	await capabilities.deleteStoragePrefix(`accounts/${accountConfigId}/`, log);
	await capabilities.deleteStoragePrefix(`exports/${accountConfigId}/`, log);
	await services.accountConfigService.delete(accountConfigId);
	log.info({ accountConfigId }, "AccountConfig deleted; erase complete");
};
