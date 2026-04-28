import type { APIGatewayTokenAuthorizerHandler } from "aws-lambda";

/** LRU cache for deletedAt lookups — exported for tests only. */
const cache = new Map<string, { deletedAt: number | undefined; ts: number }>();

export const _testCache = {
	getCachedDeletedAt: (id: string): number | undefined | null => {
		const entry = cache.get(id);
		return entry ? entry.deletedAt : null;
	},
	setCachedDeletedAt: (id: string, deletedAt: number | undefined): void => {
		cache.set(id, { deletedAt, ts: Date.now() });
	},
	size: (): number => cache.size,
	clear: (): void => cache.clear(),
};

export const handler: APIGatewayTokenAuthorizerHandler = async (_event) => {
	throw new Error("Not implemented — authorizer stub for CDK synth");
};
