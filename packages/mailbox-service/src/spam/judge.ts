import type {
	SpamRequest,
	SpamResponse,
	SpamService,
	SpamThresholds,
} from "@remit/data-ports";
import { SpamAction, SpamKind, SpamReasonName } from "@remit/domain-enums";
import {
	type CheckName,
	type Finding,
	runChecks,
	toCheckInput,
} from "./checks.js";
import type { Tldts } from "./display-name.js";

type Action = (typeof SpamAction)[keyof typeof SpamAction];
type Checked = Extract<SpamResponse, { state: "Checked" }>;

/**
 * What each check adds. The provider's verdict weighs least: the owner's
 * provider misjudges mail both ways. A missing registration date weighs
 * lightly, since some registries publish none.
 */
export const WEIGHTS: Readonly<Record<CheckName, number>> = {
	DmarcFail: 0.45,
	SignerMismatch: 0.1,
	ReplyToMismatch: 0.2,
	LinkTextMismatch: 0.45,
	LinkDomainDistant: 0.15,
	PunycodeDomain: 0.3,
	MixedScriptDomain: 0.45,
	ConfusableDomains: 0.5,
	SingleOffDomainLink: 0.25,
	GeneratedName: 0.2,
	FirstContactDomain: 0.1,
	RecentlyRegisteredDomain: 0.35,
	UnknownRegistrationDate: 0.05,
	ClassifierSpam: 0.4,
	ClassifierPhishing: 0.5,
	ProviderSpam: 0.1,
	DisplayNameForeignAddress: 0.5,
	DisplayNameLookalike: 0.4,
};

/** Reasons that say the message impersonates someone. */
export const IMPERSONATION: ReadonlySet<
	(typeof SpamReasonName)[keyof typeof SpamReasonName]
> = new Set([
	SpamReasonName.LinkTextMismatch,
	SpamReasonName.MixedScriptDomain,
	SpamReasonName.ConfusableDomains,
	SpamReasonName.ClassifierPhishing,
	SpamReasonName.DisplayNameForeignAddress,
	SpamReasonName.DisplayNameLookalike,
]);

/** Weights combine as independent evidence: each one closes part of the gap to 1. */
export const scoreOf = (findings: readonly Finding[]): number => {
	const clean = findings.reduce(
		(product, finding) => product * (1 - WEIGHTS[finding.name]),
		1,
	);
	return Math.round((1 - clean) * 10_000) / 10_000;
};

/**
 * Below `cleanBelow` nothing happens and from `spamAt` up the message goes to
 * Junk. Between the two the model would decide; without it the message is
 * flagged. Until calibration sets both, nothing moves.
 */
export const actionOf = (score: number, thresholds: SpamThresholds): Action => {
	if (thresholds.state === "Unset") return SpamAction.None;
	if (score >= thresholds.spamAt) return SpamAction.Junk;
	if (score < thresholds.cleanBelow) return SpamAction.None;
	return SpamAction.Warn;
};

/** Stage 2: a pure function of the request, holding no list of names. */
export const judge = (
	request: SpamRequest,
	thresholds: SpamThresholds,
	tldts: Tldts,
): Checked => {
	const findings = runChecks(toCheckInput(request, tldts));
	const score = scoreOf(findings);
	return {
		state: "Checked",
		score,
		action: actionOf(score, thresholds),
		kind: findings.some((finding) => IMPERSONATION.has(finding.name))
			? SpamKind.Phishing
			: SpamKind.Spam,
		reasons: findings.map((finding) => ({
			name: finding.name,
			symbol: finding.name,
			score: WEIGHTS[finding.name],
			options: finding.options,
		})),
		modelCalled: false,
	};
};

/** The inline backend: the judge running inside Remit. */
export class InlineSpamService implements SpamService {
	constructor(private readonly thresholds: SpamThresholds) {}

	async check(request: SpamRequest): Promise<SpamResponse> {
		return judge(request, this.thresholds, await import("tldts"));
	}
}
