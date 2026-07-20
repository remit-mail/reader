import type { QuarantineItem } from "../types.js";

export interface IQuarantineRepository {
	/**
	 * Every quarantined message for one user, newest first. Unpaginated: the
	 * list is small by design, and it is read whole both by the settings
	 * surface and by a sync round that keeps it in memory.
	 */
	listByAccountConfigId(accountConfigId: string): Promise<QuarantineItem[]>;
}
