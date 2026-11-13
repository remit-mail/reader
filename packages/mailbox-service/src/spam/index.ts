import type {
	ClassifierScoreItem,
	IAccountRepository,
	IAddressRepository,
	IDomainRegistrationRepository,
	MessageSpamVerdict,
	SpamService,
} from "@remit/data-ports";
import { NotFoundError } from "@remit/data-ports/errors";
import { deriveAddressId } from "@remit/data-ports/id";
import type { AuthResultVerdict } from "@remit/domain-enums";
import type { ParsedMail } from "mailparser";
import type { FilterDecision } from "../filters/pipeline.js";
import type { SenderPlacement } from "../sender-placement.js";
import { buildSpamRequest } from "./evidence.js";
import {
	domainRegisteredAt,
	type RdapClient,
	type RdapLogger,
} from "./rdap.js";
import { screen } from "./screen.js";

export { InlineSpamService, judge } from "./judge.js";
export { parseRdapRegistration, RdapClient, type RdapFetch } from "./rdap.js";

/** What body sync needs to record a spam verdict (RFC 041). */
export interface SpamConfig {
	spamService: SpamService;
	domainRegistration: IDomainRegistrationRepository;
	rdap: Pick<RdapClient, "lookup">;
	accountService: Pick<IAccountRepository, "listAllByAccountConfig">;
	logger: RdapLogger;
}

export interface SpamArrival {
	accountConfigId: string;
	fromEmail: string | null;
	parsed: ParsedMail;
	raw: Buffer;
	internalDate: number;
	sender: SenderPlacement;
	filterDecision: FilterDecision;
	classifierScores: ClassifierScoreItem[];
	modelAllowed: boolean;
	hasListUnsubscribe: boolean;
	dmarc: (typeof AuthResultVerdict)[keyof typeof AuthResultVerdict] | undefined;
}

const readSenderHistory = async (
	addressService: Pick<IAddressRepository, "getAddress">,
	accountConfigId: string,
	fromEmail: string | null,
): Promise<{ knownSender: boolean; senderMessagesSeen: number }> => {
	if (fromEmail === null) return { knownSender: false, senderMessagesSeen: 0 };
	const address = await addressService
		.getAddress(accountConfigId, deriveAddressId(accountConfigId, fromEmail))
		.catch((error: unknown) => {
			if (error instanceof NotFoundError) return undefined;
			throw error;
		});
	return {
		knownSender:
			(address?.outboundCount ?? 0) > 0 || (address?.replyCount ?? 0) > 0,
		senderMessagesSeen: address?.inboundCount ?? 0,
	};
};

/**
 * Stage 1 screens trusted mail out; everything else goes to the spam service
 * with the evidence Remit gathered: sender history, the domain's history and
 * registration date, and the category classifier's answer.
 */
export const decideSpamVerdict = async (
	config: SpamConfig,
	addressService: Pick<
		IAddressRepository,
		"getAddress" | "countInboundForDomain"
	>,
	arrival: SpamArrival,
): Promise<MessageSpamVerdict> => {
	const { accountConfigId, fromEmail } = arrival;
	const history = await readSenderHistory(
		addressService,
		accountConfigId,
		fromEmail,
	);
	const screened = screen({
		sender: arrival.sender,
		filterDecision: arrival.filterDecision,
		hasListUnsubscribe: arrival.hasListUnsubscribe,
		dmarc: arrival.dmarc,
		senderMessagesSeen: history.senderMessagesSeen,
	});
	if (screened) return { state: "ScreenedOut", screen: screened };

	const tldts = await import("tldts");
	const senderDomain = fromEmail
		? tldts.getDomain(fromEmail.slice(fromEmail.lastIndexOf("@") + 1))
		: null;
	const accounts =
		await config.accountService.listAllByAccountConfig(accountConfigId);
	const request = buildSpamRequest(
		arrival.parsed,
		arrival.raw,
		{
			rcpt: accounts.map((account) => account.email),
			receivedAt: arrival.internalDate,
			...history,
			senderDomainMessagesSeen: senderDomain
				? await addressService.countInboundForDomain(
						accountConfigId,
						senderDomain,
					)
				: 0,
			senderDomainRegisteredAt: senderDomain
				? await domainRegisteredAt(config, senderDomain)
				: undefined,
			classifierScores: arrival.classifierScores,
			modelAllowed: arrival.modelAllowed,
		},
		tldts,
	);
	return config.spamService.check(request);
};
