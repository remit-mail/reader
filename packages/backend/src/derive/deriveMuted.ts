import type { AddressFlags } from "@remit/api-openapi-types";

/**
 * Derive whether the From address is muted from an Address's flags map.
 *
 * Pure function, no I/O. Frontend never derives this — single source of
 * truth for filtering the daily brief.
 */
export const deriveMuted = (flags: AddressFlags | undefined): boolean =>
	flags?.muted?.value === true;
