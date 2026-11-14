import {
	SpamInlineJudgeConfigSchema,
	SpamModelJudgeConfigSchema,
	SpamRspamdJudgeConfigSchema,
} from "@remit/api-zod-schemas";
import { SpamJudgeName } from "@remit/domain-enums";
import { z } from "zod";

export const SpamJudgeConfigSchema = z.discriminatedUnion("name", [
	SpamInlineJudgeConfigSchema,
	SpamRspamdJudgeConfigSchema,
	SpamModelJudgeConfigSchema,
]);

export type SpamJudgeConfig = z.infer<typeof SpamJudgeConfigSchema>;

const isHttpUrl = (url: string): boolean =>
	URL.canParse(url) && /^https?:$/.test(new URL(url).protocol);

/**
 * The deployment's spam judges, in the order they run (RFC 041). The model
 * gives no verdict for an account without one, so another judge must run.
 */
export const SpamPipelineSchema = z
	.array(SpamJudgeConfigSchema)
	.min(1)
	.superRefine((judges, context) => {
		if (judges.every((judge) => judge.name === SpamJudgeName.Model)) {
			context.addIssue({
				code: "custom",
				message: "needs a judge other than Model",
			});
		}
		judges.forEach((judge, index) => {
			if (judge.name === SpamJudgeName.Rspamd && !isHttpUrl(judge.url)) {
				context.addIssue({
					code: "custom",
					path: [index, "url"],
					message: "must be an http or https URL",
				});
			}
			if (
				judge.name !== SpamJudgeName.Rspamd &&
				judge.thresholds.state === "Set" &&
				judge.thresholds.cleanBelow > judge.thresholds.spamAt
			) {
				context.addIssue({
					code: "custom",
					path: [index, "thresholds"],
					message: "cleanBelow must not exceed spamAt",
				});
			}
		});
	});

export type SpamPipeline = z.infer<typeof SpamPipelineSchema>;

export const DEFAULT_SPAM_PIPELINE: SpamPipeline = [
	{ name: SpamJudgeName.Inline, thresholds: { state: "Unset" } },
];

const KEY = "SPAM_PIPELINE";

const LEGACY_KEYS = [
	"SPAM_BACKEND",
	"SPAM_CLEAN_BELOW",
	"SPAM_AT",
	"SPAM_RSPAMD_URL",
] as const;

type SpamEnv = Readonly<
	Partial<Record<typeof KEY | (typeof LEGACY_KEYS)[number], string>>
>;

const refuse = (message: string): never => {
	throw new Error(`Refusing to start: ${message}`);
};

const parseJson = (raw: string): unknown => {
	try {
		return JSON.parse(raw);
	} catch {
		return refuse(`${KEY} is not JSON.`);
	}
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value);

/** Paths in `given` the schema dropped: a field no judge reads is a typo or a misplaced setting. */
const unknownFields = (
	given: unknown,
	kept: unknown,
	path: string,
): string[] => {
	if (Array.isArray(given) && Array.isArray(kept)) {
		return given.flatMap((item, index) =>
			unknownFields(item, kept[index], `${path}${index}.`),
		);
	}
	if (!isRecord(given) || !isRecord(kept)) return [];
	return Object.entries(given).flatMap(([key, value]) =>
		Object.hasOwn(kept, key)
			? unknownFields(value, kept[key], `${path}${key}.`)
			: [`${path}${key}`],
	);
};

/**
 * `SPAM_PIPELINE` as JSON, or the inline judge with its thresholds unset when
 * it is empty. Anything the schema refuses, a field no judge reads, or one of
 * the keys it replaced stops the process.
 */
export const spamPipelineFromEnv = (env: SpamEnv): SpamPipeline => {
	const legacy = LEGACY_KEYS.filter((key) => (env[key] ?? "").trim() !== "");
	if (legacy.length > 0) {
		return refuse(
			`${legacy.join(", ")} is no longer read. Describe the spam judges in ${KEY} instead.`,
		);
	}
	const raw = (env[KEY] ?? "").trim();
	if (raw === "") return DEFAULT_SPAM_PIPELINE;
	const given = parseJson(raw);
	const parsed = SpamPipelineSchema.safeParse(given);
	if (!parsed.success) {
		return refuse(
			`${KEY} ${parsed.error.issues
				.map((issue) =>
					issue.path.length === 0
						? issue.message
						: `${issue.path.map(String).join(".")}: ${issue.message}`,
				)
				.join("; ")}`,
		);
	}
	const unknown = unknownFields(given, parsed.data, "");
	if (unknown.length > 0) {
		return refuse(`${KEY} has fields no judge reads: ${unknown.join(", ")}`);
	}
	return parsed.data;
};
