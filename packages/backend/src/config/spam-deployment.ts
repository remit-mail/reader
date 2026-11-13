import type {
	SpamBackend,
	SpamDeployment,
	SpamThresholds,
} from "@remit/data-ports";

const CLEAN_BELOW = "SPAM_CLEAN_BELOW";
const SPAM_AT = "SPAM_AT";
const BACKEND = "SPAM_BACKEND";
const RSPAMD_URL = "SPAM_RSPAMD_URL";

const refuse = (message: string): never => {
	throw new Error(`Refusing to start: ${message}`);
};

const envValue = (env: NodeJS.ProcessEnv, key: string): string =>
	(env[key] ?? "").trim();

const scoreOf = (key: string, raw: string): number => {
	const score = Number(raw);
	if (/^(0(\.\d+)?|1(\.0+)?)$/.test(raw) && score >= 0 && score <= 1) {
		return score;
	}
	return refuse(`${key}=${raw} must be a number from 0 to 1.`);
};

const thresholdsOf = (env: NodeJS.ProcessEnv): SpamThresholds => {
	const cleanBelow = envValue(env, CLEAN_BELOW);
	const spamAt = envValue(env, SPAM_AT);
	if (cleanBelow === "" && spamAt === "") return { state: "Unset" };
	if (cleanBelow === "" || spamAt === "") {
		return refuse(`set both ${CLEAN_BELOW} and ${SPAM_AT}, or neither.`);
	}
	const thresholds = {
		state: "Set" as const,
		cleanBelow: scoreOf(CLEAN_BELOW, cleanBelow),
		spamAt: scoreOf(SPAM_AT, spamAt),
	};
	if (thresholds.cleanBelow > thresholds.spamAt) {
		return refuse(`${CLEAN_BELOW} must not exceed ${SPAM_AT}.`);
	}
	return thresholds;
};

const rspamdUrlOf = (raw: string): string => {
	if (raw === "")
		return refuse(`${RSPAMD_URL} is not set. ${BACKEND}=Rspamd needs it.`);
	if (!URL.canParse(raw) || !/^https?:$/.test(new URL(raw).protocol)) {
		return refuse(`${RSPAMD_URL}=${raw} must be an http or https URL.`);
	}
	return raw;
};

const backendOf = (env: NodeJS.ProcessEnv): SpamBackend => {
	const backend = envValue(env, BACKEND);
	const url = envValue(env, RSPAMD_URL);
	if (backend === "" || backend === "Inline") {
		if (url !== "")
			return refuse(`${RSPAMD_URL} set without ${BACKEND}=Rspamd.`);
		return { name: "Inline" };
	}
	if (backend === "Rspamd") return { name: "Rspamd", url: rspamdUrlOf(url) };
	return refuse(
		`${BACKEND}=${backend} is not a known backend. Use Inline or Rspamd.`,
	);
};

/**
 * The two thresholds that turn a spam score into an action (RFC 041). Both
 * stay unset until calibration measures them, and while unset nothing moves.
 * The inline judge is the backend unless `SPAM_BACKEND` names rspamd.
 */
export const spamDeploymentFromEnv = (
	env: NodeJS.ProcessEnv,
): SpamDeployment => ({
	thresholds: thresholdsOf(env),
	backend: backendOf(env),
});
