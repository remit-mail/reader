import type { Request } from "openapi-backend";

// API Gateway hands over nullable maps with undefined values and a Fetch
// request an empty string for a missing body; both reduce to one shape here.
// A query key carries every value it was sent with, in order.
export interface HostRequest {
	method: string;
	path: string;
	query: Readonly<Record<string, readonly string[] | undefined>> | null;
	headers: Readonly<Record<string, string | undefined>> | null;
	body: string | null;
}

const definedHeaders = (
	map: Readonly<Record<string, string | undefined>> | null,
): Record<string, string> =>
	Object.fromEntries(
		Object.entries(map ?? {}).filter(
			(entry): entry is [string, string] => entry[1] !== undefined,
		),
	);

const collapsedQuery = (
	map: Readonly<Record<string, readonly string[] | undefined>> | null,
): Record<string, string | string[]> => {
	const query: Record<string, string | string[]> = {};
	for (const [key, values] of Object.entries(map ?? {})) {
		if (!values || values.length === 0) continue;
		query[key] = values.length === 1 ? values[0] : [...values];
	}
	return query;
};

export const normalizeRequest = (request: HostRequest): Request => ({
	method: request.method,
	path: request.path,
	query: collapsedQuery(request.query),
	body: request.body === "" ? null : request.body,
	headers: definedHeaders(request.headers),
});
