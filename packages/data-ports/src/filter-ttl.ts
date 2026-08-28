import { FilterScope } from "@remit/domain-enums";
import { BadRequestError } from "./errors.js";

/**
 * Epoch-seconds `ttl` derived from `expiresAt`, set only for a `Temporary`
 * filter (RFC 034 Decision 1.3). A `Standing` filter never carries `ttl` — the
 * reserved table-wide TTL attribute must stay absent, or the row would be swept
 * (Decision 1.4).
 */
export const deriveFilterTtl = (
	scope: string,
	expiresAt: string | undefined,
): number | undefined => {
	if (scope !== FilterScope.Temporary || !expiresAt) return undefined;
	const ms = new Date(expiresAt).getTime();
	if (Number.isNaN(ms)) {
		throw new BadRequestError(`Invalid expiresAt: ${expiresAt}`);
	}
	return Math.floor(ms / 1000);
};
