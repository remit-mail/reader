import type { IAddressRepository } from "@remit/data-ports";
import { NotFoundError } from "@remit/data-ports/errors";
import { deriveAddressId } from "@remit/data-ports/id";
import { type SenderOverride, SenderTrust } from "@remit/domain-enums";
import { resolveSenderPlacement } from "./heuristics/classifyPlacement.js";

export interface SenderPlacement {
	senderTrust: (typeof SenderTrust)[keyof typeof SenderTrust];
	senderOverride: (typeof SenderOverride)[keyof typeof SenderOverride];
	autoArchive: boolean;
	/** Earlier messages from this address. */
	inboundCount: number;
	/** The owner has sent mail to this address. */
	knownSender: boolean;
}

interface SenderPlacementSignals {
	trust: (typeof SenderTrust)[keyof typeof SenderTrust];
	trustSetAt?: number;
	blocked: boolean;
	blockedSetAt?: number;
	neverSpam: boolean;
	autoArchive: boolean;
	inboundCount: number;
	knownSender: boolean;
}

const UNKNOWN_SENDER: SenderPlacementSignals = {
	trust: SenderTrust.Unknown,
	blocked: false,
	neverSpam: false,
	autoArchive: false,
	inboundCount: 0,
	knownSender: false,
};

/** The per-sender signals placement needs, from one `Address` fetch. */
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
		inboundCount: address?.inboundCount ?? 0,
		knownSender:
			(address?.outboundCount ?? 0) > 0 || (address?.replyCount ?? 0) > 0,
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
		inboundCount: signals.inboundCount,
		knownSender: signals.knownSender,
	};
};
