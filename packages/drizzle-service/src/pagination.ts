import type { ResultList } from "@remit/data-ports";

export function encodeToken(data: Record<string, unknown>): string {
	return Buffer.from(JSON.stringify(data)).toString("base64url");
}

export function decodeToken(
	token: string,
): Record<string, unknown> | undefined {
	try {
		return JSON.parse(
			Buffer.from(token, "base64url").toString("utf8"),
		) as Record<string, unknown>;
	} catch {
		return undefined;
	}
}

export function resultList<T>(
	items: T[],
	limit: number | undefined,
	lastKey?: Record<string, unknown>,
): ResultList<T> {
	const continuationToken =
		lastKey && limit !== undefined && items.length === limit
			? encodeToken(lastKey)
			: undefined;
	return { items, continuationToken };
}
