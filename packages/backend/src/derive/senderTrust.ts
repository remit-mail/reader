import { SenderTrust } from "@remit/domain-enums";
import type { AddressFlags } from "@remit/api-openapi-types";

export type SenderTrustValue = (typeof SenderTrust)[keyof typeof SenderTrust];

/**
 * Derive the SenderTrust discriminator from an Address's flags map.
 *
 * Precedence (per EDD #232):
 *   flags.vip.value === true       → "vip"
 *   flags.wellknown.value === true → "wellknown"
 *   otherwise                      → "unknown"
 *
 * Pure function, no I/O. Frontend never derives this — single source of
 * truth for the UI badge state.
 */
export const deriveSenderTrust = (
	flags: AddressFlags | undefined,
): SenderTrustValue => {
	if (flags?.vip?.value === true) return SenderTrust.Vip;
	if (flags?.wellknown?.value === true) return SenderTrust.Wellknown;
	return SenderTrust.Unknown;
};
