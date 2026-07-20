import type { ResultList } from "@remit/data-ports";
import { BadRequestError } from "@remit/data-ports/errors";

export function encodeToken(data: Record<string, unknown>): string {
	return Buffer.from(JSON.stringify(data)).toString("base64url");
}

// A continuation token is opaque and server-minted: absent means "first page",
// present means "resume here". A token that does not decode is neither, so it
// is a malformed parameter. Reading it as "first page" answered the request
// with page one under a fresh token, so a client that kept paging kept
// appending the same rows with nothing signalling the failure (#136).
export function decodeToken(
	token: string,
	encoding: "base64" | "base64url" = "base64url",
): Record<string, unknown> {
	let parsed: unknown;
	try {
		parsed = JSON.parse(Buffer.from(token, encoding).toString("utf8"));
	} catch {
		throw new BadRequestError("Invalid continuationToken");
	}

	if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
		throw new BadRequestError("Invalid continuationToken");
	}

	return parsed as Record<string, unknown>;
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
