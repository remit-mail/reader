import type { Logger } from "@remit/logger-lambda";
import type { CascadeEntity } from "./cascade.js";

/**
 * The four steps of the deletion cascade that vary by deployment. Everything
 * else — enumerating the AccountConfig's rows, the FIFO purge orchestration, the
 * queue sends — is backend-neutral and lives in the handlers unchanged.
 *
 * Two composition roots build this:
 *
 * - The DynamoDB composition (AWS custody stack): Cognito global sign-out,
 *   CloudFront invalidation, raw-S3 prefix delete, DynamoDB `BatchWriteItem`
 *   cascade. Byte-for-byte the pre-split behavior. It imports the AWS SDK /
 *   ElectroDB graph and lives outside this shared, open-core module; it is
 *   injected here through `setDeletionCapabilities` so that graph never reaches
 *   the relational tree.
 * - `compose-relational.ts` (self-host stack, RFC 035/036), selected by
 *   `DATA_BACKEND`: no-op sign-out
 *   (deleting the AccountConfig severs the session's data resolution; there is
 *   no CDN to sign out of), no-op invalidation (Caddy proxies `/content/*`
 *   straight to the backend with no cache), filesystem prefix delete, and the
 *   Drizzle cascade over Postgres or SQLite.
 */
export interface DeletionCapabilities {
	/**
	 * Validate every precondition the destructive steps depend on, BEFORE any row
	 * or object is deleted. AWS checks both `CONTENT_DISTRIBUTION_ID` and
	 * `S3_STORAGE_BUCKET_NAME` up front so a missing var fails loud instead of
	 * destroying rows in the cascade and only then erroring at the storage step.
	 * Relational is a no-op — its steps carry no such deploy-time configuration.
	 */
	assertReady(log: Logger): Promise<void>;
	/**
	 * Invalidate the deleted user's active auth sessions. AWS: Cognito
	 * `AdminUserGlobalSignOut`. Relational: no-op.
	 */
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
	 * DynamoDB `BatchWriteItem`. Relational: Drizzle transaction (Postgres or
	 * SQLite). Excludes the AccountConfig row, which the caller deletes last
	 * through its repository as the cascade-in-progress marker.
	 */
	cascadeDelete(entities: CascadeEntity[], log: Logger): Promise<void>;
}

const isRelationalBackend = (): boolean => {
	const backend = process.env.DATA_BACKEND;
	return backend === "postgres" || backend === "sqlite";
};

let injectedCapabilities: DeletionCapabilities | null = null;

/**
 * Register the DynamoDB-backed deletion capabilities from the composition root.
 * The DynamoDB composition imports the AWS SDK / ElectroDB graph and lives
 * outside this shared, open-core module; it is never imported here. The
 * relational backend composes in-package below and never touches this seam.
 */
export const setDeletionCapabilities = (
	capabilities: DeletionCapabilities,
): void => {
	injectedCapabilities = capabilities;
};

const buildDeletionCapabilitiesFromEnv =
	async (): Promise<DeletionCapabilities> => {
		if (isRelationalBackend()) {
			const { buildRelationalDeletionCapabilities } = await import(
				"./compose-relational.js"
			);
			return buildRelationalDeletionCapabilities();
		}
		if (!injectedCapabilities) {
			throw new Error(
				"no DynamoDB deletion capabilities registered — register them with setDeletionCapabilities() from your composition root",
			);
		}
		return injectedCapabilities;
	};

let capabilitiesPromise: Promise<DeletionCapabilities> | undefined;

/**
 * The process-wide deletion capabilities, built once per backend and reused
 * across invocations. Both handlers await this in their default path; tests
 * inject a `DeletionCapabilities` directly.
 */
export const getDeletionCapabilities = (): Promise<DeletionCapabilities> => {
	if (!capabilitiesPromise) {
		capabilitiesPromise = buildDeletionCapabilitiesFromEnv();
	}
	return capabilitiesPromise;
};
