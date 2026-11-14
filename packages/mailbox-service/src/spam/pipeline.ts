import type {
	SpamReason,
	SpamRequest,
	SpamResponse,
	SpamService,
} from "@remit/data-ports";
import {
	SpamAction,
	SpamJudgeName,
	SpamModelOutcome,
} from "@remit/domain-enums";

type Checked = Extract<SpamResponse, { state: "Checked" }>;
type JudgeName = Checked["decidedBy"];
type ModelOutcome = Checked["modelOutcome"];

/** One judge's verdict, mapped onto an action. `decided` ends the pipeline. */
export type Judged = Pick<Checked, "score" | "action" | "kind" | "reasons"> & {
	state: "Judged";
	decided: boolean;
};

/**
 * What one judge answers. A judge that cannot judge this message abstains;
 * only the model does, when the account has none or is out of calls.
 */
export type Judgement =
	| Extract<SpamResponse, { state: "Failed" }>
	| { state: "Abstained"; modelOutcome: ModelOutcome }
	| Judged;

/** A judge weighs the request and the reasons the judges before it found. */
export interface SpamJudge {
	check(
		request: SpamRequest,
		earlier: readonly SpamReason[],
	): Promise<Judgement>;
}

export interface SpamStage {
	name: JudgeName;
	judge: SpamJudge;
}

/**
 * The spam service as an ordered list of judges (RFC 041). Each judge runs
 * until one is sure; a failure ends the run as the contract's `Failed`. The
 * last judge that judged sets score, action and kind, and the reasons of
 * every judge that ran are kept.
 */
export class SpamPipelineService implements SpamService {
	constructor(private readonly stages: readonly SpamStage[]) {}

	async check(request: SpamRequest): Promise<SpamResponse> {
		const reasons: SpamReason[] = [];
		let standing: { name: JudgeName; judged: Judged } | undefined;
		let modelOutcome: ModelOutcome | undefined;
		for (const { name, judge } of this.stages) {
			const judgement = await judge.check(request, reasons);
			if (judgement.state === "Failed") return judgement;
			if (judgement.state === "Abstained") {
				modelOutcome = judgement.modelOutcome;
				continue;
			}
			reasons.push(...judgement.reasons);
			standing = { name, judged: judgement };
			if (name === SpamJudgeName.Model)
				modelOutcome = SpamModelOutcome.Answered;
			if (judgement.decided) break;
		}
		if (!standing) throw new Error("No spam judge gave a verdict");
		const { score, action, kind } = standing.judged;
		return {
			state: "Checked",
			score,
			action,
			kind,
			reasons,
			modelOutcome:
				modelOutcome ??
				(action === SpamAction.Warn
					? SpamModelOutcome.NotConfigured
					: SpamModelOutcome.OutOfBand),
			decidedBy: standing.name,
		};
	}
}
