import type { IAddressRepository } from "@remit/data-ports";
import { NotFoundError } from "@remit/data-ports/errors";
import { deriveAddressId } from "@remit/data-ports/id";
import { type SenderOverride, SenderTrust } from "@remit/domain-enums";
import { resolveSenderPlacement } from "./heuristics/classifyPlacement.js";

export interface SenderPlacement {
	senderTrust: (typeof SenderTrust)[keyof typeof SenderTrust];
	senderOverride: (typeof SenderOverride)[keyof typeof SenderOverride];
	autoArchive: boolean;
}

interface SenderPlacementSignals {
	trust: (typeof SenderTrust)[keyof typeof SenderTrust];
	trustSetAt?: number;
	blocked: boolean;
	blockedSetAt?: number;
	neverSpam: boolean;
	autoArchive: boolean;
}

const UNKNOWN_SENDER: SenderPlacementSignals = {
	trust: SenderTrust.Unknown,
	blocked: false,
	neverSpam: false,
	autoArchive: false,
};

/**
 * The per-sender signals placement needs, from ONE `Address` fetch (RFC 039
 * Decision 3/3a, issue #300): the trust reads exactly as `deriveSenderTrust`
 * always did — `vip → wellknown → unknown`, untouched by `blocked` — plus
 * `blocked`/`autoArchive` off the same row. `trustSetAt` is the `setAt` of
 * whichever flag produced the trust value, needed by
 * {@link resolveSenderPlacement}'s tie-break; it stays local to placement and
 * never reaches `deriveSenderTrust`'s own contract (the trust badge).
 */
const readSenderPlacementSignals = async (
	addressService: Pick<IAddressRepository, "getAddress">,
	accountConfigId: string,
	fromEmail: string,
): Promise<SenderPlacementSignals> => {
	// A genuinely-absent address means "no signals". Any other failure
	// (AccessDenied, throttle, infra) must NOT be silently downgraded — let it
	// crash so the placement decision isn't made on bad data.
	const address = await addressService
		.getAddress(accountConfigId, deriveAddressId(accountConfigId, fromEmail))
		.catch((error: unknown) => {
			if (error instanceof NotFoundError) return undefined;
			throw error;
		});
	const flags = address?.flags;
	const standing = {
		blocked: flags?.blocked?.value === true,
		blockedSetAt: flags?.blocked?.setAt,
		neverSpam: flags?.neverSpam?.value === true,
		autoArchive: flags?.autoArchive?.value === true,
	};
	if (flags?.vip?.value === true) {
		return {
			...standing,
			trust: SenderTrust.Vip,
			trustSetAt: flags.vip.setAt,
		};
	}
	if (flags?.wellknown?.value === true) {
		return {
			...standing,
			trust: SenderTrust.Wellknown,
			trustSetAt: flags.wellknown.setAt,
		};
	}
	return { ...standing, trust: SenderTrust.Unknown };
};

/** The sender's trust and standing placement instruction, tie-broken. */
export const readSenderPlacement = async (
	addressService: Pick<IAddressRepository, "getAddress">,
	accountConfigId: string,
	fromEmail: string | null,
): Promise<SenderPlacement> => {
	const signals = fromEmail
		? await readSenderPlacementSignals(
				addressService,
				accountConfigId,
				fromEmail,
			)
		: UNKNOWN_SENDER;
	return {
		...resolveSenderPlacement(
			{ trust: signals.trust, setAt: signals.trustSetAt },
			{ blocked: signals.blocked, setAt: signals.blockedSetAt },
			signals.neverSpam,
		),
		autoArchive: signals.autoArchive,
	};
};
