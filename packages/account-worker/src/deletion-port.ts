import type { Logger } from "@remit/logger";
import type { CascadeEntity } from "./cascade.js";

export interface DeletionCapabilities {
	/**
	 * Validate every precondition the destructive steps depend on, BEFORE any row
	 * or object is deleted. AWS checks both `CONTENT_DISTRIBUTION_ID` and
	 * `S3_STORAGE_BUCKET_NAME` up front so a missing var fails loud instead of
	 * destroying rows in the cascade and only then erroring at the storage step.
	 * Relational is a no-op — its steps carry no such deploy-time configuration.
	 */
	assertReady(log: Logger): Promise<void>;
	signOut(userId: string, log: Logger): Promise<void>;
	/**
	 * Purge any CDN/edge cache under a tenant/account content prefix
	 * (`accountConfigId` or `accountConfigId/accountId`). AWS: CloudFront
	 * invalidation of `/content/accounts/{prefix}/*`. Relational: no-op.
	 */
	invalidateContent(contentPrefix: string, log: Logger): Promise<void>;
	/**
	 * Delete every stored object under a storage key prefix
	 * (`accounts/{accountConfigId}/…`). AWS: raw-S3 list+delete. Relational:
	 * recursive filesystem removal under the local storage root.
	 */
	deleteStoragePrefix(keyPrefix: string, log: Logger): Promise<void>;
	/**
	 * Remove the enumerated rows in dependency order (children → parents). AWS:
	 * DynamoDB `BatchWriteItem`. Relational: a Drizzle transaction. Excludes the AccountConfig row, which the caller deletes last
	 * through its repository as the cascade-in-progress marker.
	 */
	cascadeDelete(entities: CascadeEntity[], log: Logger): Promise<void>;
	/**
	 * Remove every row an account config owns except the AccountConfig row,
	 * which the caller deletes last. Relational: one keyed delete per table.
	 */
	eraseAccountConfig(accountConfigId: string, log: Logger): Promise<void>;
}
