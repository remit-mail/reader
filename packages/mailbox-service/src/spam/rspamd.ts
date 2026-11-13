import type { SpamRequest, SpamResponse, SpamService } from "@remit/data-ports";
import {
	SpamAction,
	SpamFailureKind,
	SpamModelOutcome,
	SpamReasonName,
} from "@remit/domain-enums";
import { kindOf } from "./judge.js";

type Action = (typeof SpamAction)[keyof typeof SpamAction];
type FailureKind = (typeof SpamFailureKind)[keyof typeof SpamFailureKind];
type ReasonName = (typeof SpamReasonName)[keyof typeof SpamReasonName];
type Failed = Extract<SpamResponse, { state: "Failed" }>;

const TIMEOUT_MS = 10_000;

const ACTIONS: Readonly<Record<string, Action>> = {
	"no action": SpamAction.None,
	greylist: SpamAction.Warn,
	"add header": SpamAction.Warn,
	"rewrite subject": SpamAction.Warn,
	"soft reject": SpamAction.Warn,
	reject: SpamAction.Junk,
	discard: SpamAction.Junk,
	quarantine: SpamAction.Junk,
};

const RSPAMD_SYMBOLS: Readonly<Record<string, ReasonName>> = {
	DMARC_POLICY_REJECT: SpamReasonName.DmarcFail,
	DMARC_POLICY_QUARANTINE: SpamReasonName.DmarcFail,
	DMARC_POLICY_SOFTFAIL: SpamReasonName.DmarcFail,
	REPLYTO_DOM_NEQ_FROM_DOM: SpamReasonName.ReplyToMismatch,
	PHISHING: SpamReasonName.LinkTextMismatch,
	OMOGRAPH_URL: SpamReasonName.MixedScriptDomain,
	MIXED_CHARSET_URL: SpamReasonName.MixedScriptDomain,
	SPOOF_DISPLAY_NAME: SpamReasonName.DisplayNameForeignAddress,
	FROM_NEQ_DISPLAY_NAME: SpamReasonName.DisplayNameForeignAddress,
	PHISHED_OPENPHISH: SpamReasonName.ListedPhishingLink,
	PHISHED_PHISHTANK: SpamReasonName.ListedPhishingLink,
	PHISHED_GENERIC_SERVICE: SpamReasonName.ListedPhishingLink,
};

const failed = (kind: FailureKind): Failed => ({ state: "Failed", kind });

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value);

const isSymbol = (
	value: unknown,
): value is { score: number; options?: string[] } =>
	isRecord(value) &&
	typeof value.score === "number" &&
	(value.options === undefined ||
		(Array.isArray(value.options) &&
			value.options.every((option) => typeof option === "string")));

/**
 * Maps a `/checkv2` answer onto the contract. The score is rspamd's score as a
 * share of its `required_score`; rspamd's action is kept as rspamd chose it.
 */
export const fromRspamd = (body: unknown): SpamResponse => {
	if (!isRecord(body)) return failed(SpamFailureKind.Unparseable);
	if (body.is_skipped === true) return failed(SpamFailureKind.ServiceError);
	const { score, required_score: requiredScore, action, symbols } = body;
	if (
		typeof score !== "number" ||
		typeof requiredScore !== "number" ||
		requiredScore <= 0 ||
		typeof action !== "string" ||
		!Object.hasOwn(ACTIONS, action) ||
		!isRecord(symbols)
	) {
		return failed(SpamFailureKind.Unparseable);
	}
	const entries = Object.entries(symbols);
	const reasons = entries.flatMap(([symbol, found]) =>
		isSymbol(found)
			? [
					{
						name: RSPAMD_SYMBOLS[symbol] ?? SpamReasonName.BackendSymbol,
						symbol,
						score: found.score,
						options: found.options ?? [],
					},
				]
			: [],
	);
	if (reasons.length !== entries.length) {
		return failed(SpamFailureKind.Unparseable);
	}
	return {
		state: "Checked",
		score: Math.min(1, Math.max(0, score / requiredScore)),
		action: ACTIONS[action],
		kind: kindOf(reasons),
		reasons,
		modelOutcome:
			ACTIONS[action] === SpamAction.Warn
				? SpamModelOutcome.NotConfigured
				: SpamModelOutcome.OutOfBand,
	};
};

const envelopeHeaders = ({ envelope }: SpamRequest): Record<string, string> => {
	const headers: Record<string, string> = {};
	if (envelope.mailFrom !== "") headers.From = envelope.mailFrom;
	// fetch folds repeated headers into one comma-joined value, which rspamd
	// reads as a single bad address; the first recipient goes alone.
	if (envelope.rcpt.length > 0) headers.Rcpt = envelope.rcpt[0];
	if (envelope.ip !== "") headers.IP = envelope.ip;
	if (envelope.helo !== "") headers.Helo = envelope.helo;
	if (envelope.hostname !== "") headers.Hostname = envelope.hostname;
	return headers;
};

const transportFailure = (error: unknown): Failed =>
	failed(
		error instanceof Error && error.name === "TimeoutError"
			? SpamFailureKind.TimedOut
			: SpamFailureKind.Unreachable,
	);

const parseJson = (text: string): unknown => {
	try {
		return JSON.parse(text);
	} catch {
		return undefined;
	}
};

/** The rspamd backend: posts the raw message to rspamd's `/checkv2`. */
export class RspamdSpamService implements SpamService {
	private readonly checkUrl: string;

	constructor(url: string) {
		this.checkUrl = new URL(
			"checkv2",
			url.endsWith("/") ? url : `${url}/`,
		).href;
	}

	async check(request: SpamRequest): Promise<SpamResponse> {
		const answer = await fetch(this.checkUrl, {
			method: "POST",
			headers: envelopeHeaders(request),
			body: Buffer.from(request.message.raw, "base64"),
			signal: AbortSignal.timeout(TIMEOUT_MS),
		})
			.then(async (response) => ({
				ok: response.ok,
				text: await response.text(),
			}))
			.catch(transportFailure);
		if ("state" in answer) return answer;
		if (!answer.ok) return failed(SpamFailureKind.ServiceError);
		return fromRspamd(parseJson(answer.text));
	}
}
