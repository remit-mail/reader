import type {
	ClassifierScoreItem,
	IAccountRepository,
	IAddressRepository,
	IDomainRegistrationRepository,
	IMessageLabelRepository,
	MessageSpamVerdict,
	SpamJudgeConfig,
	SpamPipeline,
	SpamService,
	SpamSettingsDeps,
} from "@remit/data-ports";
import { type AuthResultVerdict, SpamJudgeName } from "@remit/domain-enums";
import type { ParsedMail } from "mailparser";
import type { ClassificationLabelDeps } from "../classification-labels.js";
import type { FilterDecision } from "../filters/pipeline.js";
import type { SenderPlacement } from "../sender-placement.js";
import { buildSpamRequest } from "./evidence.js";
import { InlineJudge } from "./judge.js";
import { ModelJudge, type SpamModelAccess } from "./model.js";
import { type SpamJudge, SpamPipelineService } from "./pipeline.js";
import {
	domainRegisteredAt,
	type RdapClient,
	type RdapLogger,
} from "./rdap.js";
import { RspamdJudge } from "./rspamd.js";
import { screen } from "./screen.js";

export { judge } from "./judge.js";
export {
	SPAM_MODEL_OFF,
	type SpamModelAccess,
	spamModelAccessOf,
} from "./model.js";
export { type SpamPlacement, spamPlacementOf } from "./placement.js";
export { parseRdapRegistration, RdapClient, type RdapFetch } from "./rdap.js";
export { fromRspamd } from "./rspamd.js";

const judgeFor = (
	config: SpamJudgeConfig,
	model: SpamModelAccess,
	now: number,
): SpamJudge => {
	switch (config.name) {
		case SpamJudgeName.Inline:
			return new InlineJudge(config.thresholds);
		case SpamJudgeName.Rspamd:
			return new RspamdJudge(config.url);
		case SpamJudgeName.Model:
			return new ModelJudge(config.thresholds, model, now);
		default:
			return config satisfies never;
	}
};

/** The deployment's judges for one message: the model judge asks this account's model. */
export const spamServiceFor = (
	pipeline: SpamPipeline,
	model: SpamModelAccess,
	now: number,
): SpamService =>
	new SpamPipelineService(
		pipeline.map((config) => ({
			name: config.name,
			judge: judgeFor(config, model, now),
		})),
	);

/** What body sync needs to record a spam verdict and act on it (RFC 041). */
export interface SpamConfig extends SpamSettingsDeps {
	domainRegistration: IDomainRegistrationRepository;
	rdap: Pick<RdapClient, "lookup">;
	accountService: Pick<IAccountRepository, "listAllByAccountConfig">;
	labelService: ClassificationLabelDeps;
	messageLabelService: Pick<IMessageLabelRepository, "apply">;
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
	model: SpamModelAccess;
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
			modelAllowed: arrival.model.state === "On",
		},
		tldts,
	);
	return spamServiceFor(config.spamPipeline, arrival.model, Date.now()).check(
		request,
	);
};
