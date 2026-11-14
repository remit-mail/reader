import {
	SpamThresholdsSetSchema,
	SpamThresholdsUnsetSchema,
} from "@remit/api-zod-schemas";
import { SpamJudgeName } from "@remit/domain-enums";
import { z } from "zod";

const ThresholdsSchema = z.union([
	SpamThresholdsUnsetSchema.strict(),
	SpamThresholdsSetSchema.strict().refine(
		(thresholds) => thresholds.cleanBelow <= thresholds.spamAt,
		"cleanBelow must not exceed spamAt",
	),
]);

const HttpUrlSchema = z
	.string()
	.refine(
		(url) => URL.canParse(url) && /^https?:$/.test(new URL(url).protocol),
		"must be an http or https URL",
	);

export const SpamJudgeConfigSchema = z.discriminatedUnion("name", [
	z
		.object({
			name: z.literal(SpamJudgeName.Inline),
			thresholds: ThresholdsSchema,
		})
		.strict(),
	z
		.object({ name: z.literal(SpamJudgeName.Rspamd), url: HttpUrlSchema })
		.strict(),
	z
		.object({
			name: z.literal(SpamJudgeName.Model),
			thresholds: ThresholdsSchema,
		})
		.strict(),
]);

/**
 * The deployment's spam judges, in the order they run (RFC 041). The model
 * gives no verdict for an account without one, so another judge must run.
 */
export const SpamPipelineSchema = z
	.array(SpamJudgeConfigSchema)
	.min(1)
	.refine(
		(judges) => judges.some((judge) => judge.name !== SpamJudgeName.Model),
		"needs a judge other than Model",
	);

export type SpamJudgeConfig = z.infer<typeof SpamJudgeConfigSchema>;
export type SpamPipeline = z.infer<typeof SpamPipelineSchema>;

export const DEFAULT_SPAM_PIPELINE: SpamPipeline = [
	{ name: SpamJudgeName.Inline, thresholds: { state: "Unset" } },
];

const KEY = "SPAM_PIPELINE";

const refuse = (message: string): never => {
	throw new Error(`Refusing to start: ${KEY} ${message}`);
};

const parseJson = (raw: string): unknown => {
	try {
		return JSON.parse(raw);
	} catch {
		return refuse("is not JSON.");
	}
};

/**
 * `SPAM_PIPELINE` as JSON, or the inline judge with its thresholds unset when
 * it is empty. Anything the schema refuses stops the process.
 */
export const spamPipelineFromEnv = (env: {
	readonly SPAM_PIPELINE?: string;
}): SpamPipeline => {
	const raw = (env.SPAM_PIPELINE ?? "").trim();
	if (raw === "") return DEFAULT_SPAM_PIPELINE;
	const parsed = SpamPipelineSchema.safeParse(parseJson(raw));
	if (parsed.success) return parsed.data;
	return refuse(
		parsed.error.issues
			.map((issue) =>
				issue.path.length === 0
					? issue.message
					: `${issue.path.map(String).join(".")}: ${issue.message}`,
			)
			.join("; "),
	);
};
