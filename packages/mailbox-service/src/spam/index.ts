import type {
	ClassifierScoreItem,
	IAccountRepository,
	IAddressRepository,
	IDomainRegistrationRepository,
	MessageSpamVerdict,
	SpamModel,
	SpamService,
} from "@remit/data-ports";
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

export { InlineSpamService, judge, judgeWithModel } from "./judge.js";
export { NO_SPAM_MODEL, type SpamModelAccount, spamModelFor } from "./model.js";
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
	rcpt: string[];
	parsed: ParsedMail;
	raw: Buffer;
	internalDate: number;
	sender: SenderPlacement;
	filterDecision: FilterDecision;
	classifierScores: ClassifierScoreItem[];
	model: SpamModel;
	modelAllowed: boolean;
	hasListUnsubscribe: boolean;
	dmarc: (typeof AuthResultVerdict)[keyof typeof AuthResultVerdict] | undefined;
}

/**
 * Stage 1 screens trusted mail out; everything else goes to the spam service
 * with the evidence Remit gathered: sender history, the domain's history and
 * registration date, and the category classifier's answer.
 */
export const decideSpamVerdict = async (
	config: SpamConfig,
	addressService: Pick<IAddressRepository, "countInboundForDomain">,
	arrival: SpamArrival,
): Promise<MessageSpamVerdict> => {
	const { accountConfigId, fromEmail, sender } = arrival;
	const screened = screen({
		sender,
		filterDecision: arrival.filterDecision,
		hasListUnsubscribe: arrival.hasListUnsubscribe,
		dmarc: arrival.dmarc,
		senderMessagesSeen: sender.inboundCount,
	});
	if (screened) return { state: "ScreenedOut", screen: screened };

	const tldts = await import("tldts");
	const senderDomain = fromEmail
		? tldts.getDomain(fromEmail.slice(fromEmail.lastIndexOf("@") + 1))
		: null;
	const request = buildSpamRequest(
		arrival.parsed,
		arrival.raw,
		{
			rcpt: arrival.rcpt,
			receivedAt: arrival.internalDate,
			knownSender: sender.knownSender,
			senderMessagesSeen: sender.inboundCount,
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
	return config.spamService.check(request, arrival.model);
};
