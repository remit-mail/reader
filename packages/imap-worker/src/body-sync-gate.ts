import { GetParameterCommand, SSMClient } from "@aws-sdk/client-ssm";
import type { Logger } from "@remit/remit-logger-lambda";

const CACHE_TTL_MS = 30_000;

interface CacheEntry {
	readonly enabled: boolean;
	readonly expiresAt: number;
}

let cache: CacheEntry | undefined;
let inFlight: Promise<boolean> | undefined;
let defaultClient: SSMClient | undefined;

const getDefaultClient = (): SSMClient => {
	if (!defaultClient) {
		defaultClient = new SSMClient({});
	}
	return defaultClient;
};

/**
 * Test seam — clears the module-scope TTL cache between unit tests.
 */
export const resetBodySyncGateCache = (): void => {
	cache = undefined;
	inFlight = undefined;
};

const readParameter = async (
	ssm: SSMClient,
	parameterName: string,
	log: Logger,
): Promise<boolean> => {
	const result = await ssm.send(
		new GetParameterCommand({ Name: parameterName }),
	);
	const value = result.Parameter?.Value;

	if (value === undefined) {
		log.warn(
			{ parameterName },
			"Body-sync toggle parameter missing a value, failing open (enabled)",
		);
		return true;
	}

	return value.trim().toLowerCase() !== "false";
};

/**
 * Reads the `/{stage}/Remit/bodySyncEnabled` SSM parameter, cached at module
 * scope for a short TTL. Returns `true` (enabled) when the parameter is absent
 * or unreadable — body sync fails open so a missing toggle never halts prod.
 */
export const isBodySyncEnabled = async (
	parameterName: string,
	log: Logger,
	ssm: SSMClient = getDefaultClient(),
): Promise<boolean> => {
	if (cache && cache.expiresAt > Date.now()) {
		return cache.enabled;
	}

	if (inFlight) {
		return inFlight;
	}

	inFlight = readParameter(ssm, parameterName, log)
		.catch((error) => {
			log.warn(
				{ parameterName, error },
				"Failed to read body-sync toggle parameter, failing open (enabled)",
			);
			return true;
		})
		.then((enabled) => {
			cache = { enabled, expiresAt: Date.now() + CACHE_TTL_MS };
			return enabled;
		})
		.finally(() => {
			inFlight = undefined;
		});

	return inFlight;
};
