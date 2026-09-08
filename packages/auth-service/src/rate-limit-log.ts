import { logger } from "@remit/logger-lambda";
import type { Auth } from "./auth.js";
import { CLIENT_IP_HEADER } from "./auth.js";
import { AUTH_BASE_PATH } from "./config.js";

export type AuthFetchHandler = Auth["handler"];

const TOO_MANY_REQUESTS = 429;

/** better-auth's own name for the seconds it wants the caller to wait. */
const RETRY_AFTER_HEADER = "x-retry-after";

const endpointOf = (url: string): string => {
	const { pathname } = new URL(url);
	if (!pathname.startsWith(AUTH_BASE_PATH)) return pathname;
	return pathname.slice(AUTH_BASE_PATH.length) || "/";
};

const retryAfterSeconds = (response: Response): number | undefined => {
	const raw = response.headers.get(RETRY_AFTER_HEADER);
	if (raw === null) return undefined;
	const seconds = Number(raw);
	return Number.isFinite(seconds) ? seconds : undefined;
};

/**
 * Wrap the better-auth fetch handler so a rate-limited answer leaves a line.
 *
 * better-auth enforces its limits inside the router it owns and answers 429
 * before any route, hook or middleware of ours runs, so the response on its way
 * out is the only place the event can be observed at all. Without this a
 * throttled instance is silent on the operator's side while its users read the
 * failure as having been signed out.
 *
 * `clientIp` is the bucket the limit is keyed on, not incidental context: the
 * limits are per address, so it is what says whether one caller is looping or a
 * whole office behind one NAT is sharing a budget. An absent header means the
 * edge did not set it and better-auth has collapsed every caller onto one
 * bucket, which is itself the thing to see.
 */
export const withRateLimitLogging =
	(auth: { handler: AuthFetchHandler }): AuthFetchHandler =>
	async (request: Request): Promise<Response> => {
		const response = await auth.handler(request);
		if (response.status !== TOO_MANY_REQUESTS) return response;
		logger.warn(
			{
				endpoint: endpointOf(request.url),
				method: request.method,
				clientIp: request.headers.get(CLIENT_IP_HEADER) ?? "unresolved",
				retryAfterSeconds: retryAfterSeconds(response),
			},
			"Auth request rate limited",
		);
		return response;
	};
