import type { DeletionCapabilities } from "./deletion-port.js";

export type { DeletionCapabilities };

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
		if (injectedCapabilities) return injectedCapabilities;
		if (process.env.SQLITE_APP_DB_PATH) {
			const { buildRelationalDeletionCapabilities } = await import(
				"./compose-relational.js"
			);
			return buildRelationalDeletionCapabilities();
		}
		throw new Error(
			"no deletion capabilities registered — register them with setDeletionCapabilities() from your composition root",
		);
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
