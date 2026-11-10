import {
	ClassificationFailureKind,
	ClassificationField,
} from "@remit/domain-enums";

export type ClassificationFailureKindValue =
	(typeof ClassificationFailureKind)[keyof typeof ClassificationFailureKind];
export type ClassificationFieldValue =
	(typeof ClassificationField)[keyof typeof ClassificationField];

export type ClassifierFailureHelp =
	| { field: ClassificationFieldValue; fix: string }
	| { fix: string };

const DEFAULT_MODEL_FIX = "Use the preset's default model";

export const CLASSIFIER_FAILURE_HELP: Record<
	ClassificationFailureKindValue,
	ClassifierFailureHelp
> = {
	[ClassificationFailureKind.Unauthorized]: {
		field: ClassificationField.ApiKey,
		fix: "Replace the key, save, test again",
	},
	[ClassificationFailureKind.ModelNotFound]: {
		field: ClassificationField.Model,
		fix: "Check the model name, or empty it for the default",
	},
	[ClassificationFailureKind.RateLimited]: {
		fix: "Raise the limit at the provider, or lower the daily limit",
	},
	[ClassificationFailureKind.Rejected]: {
		field: ClassificationField.Model,
		fix: DEFAULT_MODEL_FIX,
	},
	[ClassificationFailureKind.ProviderError]: {
		fix: "The provider is failing; built-in rules cover until it recovers",
	},
	[ClassificationFailureKind.Unreachable]: {
		field: ClassificationField.BaseUrl,
		fix: "Check the endpoint runs and the Remit server can reach it",
	},
	[ClassificationFailureKind.TimedOut]: {
		field: ClassificationField.BaseUrl,
		fix: "Check the endpoint runs and the Remit server can reach it",
	},
	[ClassificationFailureKind.Unparseable]: {
		field: ClassificationField.Model,
		fix: DEFAULT_MODEL_FIX,
	},
};

export const failureKindForStatus = (
	status: number,
): ClassificationFailureKindValue => {
	if (status === 401 || status === 403) {
		return ClassificationFailureKind.Unauthorized;
	}
	if (status === 404) return ClassificationFailureKind.ModelNotFound;
	if (status === 429) return ClassificationFailureKind.RateLimited;
	if (status >= 500) return ClassificationFailureKind.ProviderError;
	return ClassificationFailureKind.Rejected;
};
