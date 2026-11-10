import {
	ClassificationFailureKind,
	ClassificationField,
} from "@remit/domain-enums";

export type ClassificationFailureKindValue =
	(typeof ClassificationFailureKind)[keyof typeof ClassificationFailureKind];
export type ClassificationFieldValue =
	(typeof ClassificationField)[keyof typeof ClassificationField];

export interface ClassifierFailureHelp {
	field: ClassificationFieldValue;
	fix: string;
}

export const CLASSIFIER_FAILURE_HELP: Record<
	ClassificationFailureKindValue,
	ClassifierFailureHelp
> = {
	[ClassificationFailureKind.Unauthorized]: {
		field: ClassificationField.ApiKey,
		fix: "The provider refused the API key. Paste a valid key for this provider.",
	},
	[ClassificationFailureKind.ModelNotFound]: {
		field: ClassificationField.Model,
		fix: "The provider does not know this model. Check the model name, or leave it empty for the default.",
	},
	[ClassificationFailureKind.RateLimited]: {
		field: ClassificationField.ApiKey,
		fix: "The provider is rate limiting this key. Wait a minute and test again, or raise the key's quota.",
	},
	[ClassificationFailureKind.Rejected]: {
		field: ClassificationField.Model,
		fix: "The provider rejected the request. Check that the model supports classification.",
	},
	[ClassificationFailureKind.ProviderError]: {
		field: ClassificationField.BaseUrl,
		fix: "The provider had an error. Test again later, or check the base URL points at the provider's API.",
	},
	[ClassificationFailureKind.Unreachable]: {
		field: ClassificationField.BaseUrl,
		fix: "Nothing answered at this base URL. Check the address and that the provider is running.",
	},
	[ClassificationFailureKind.TimedOut]: {
		field: ClassificationField.BaseUrl,
		fix: "The provider did not answer within 10 seconds. Check the base URL, or test again when the provider is less busy.",
	},
	[ClassificationFailureKind.Unparseable]: {
		field: ClassificationField.Model,
		fix: "The provider's answer could not be read as one of the labels. Pick a model that follows the classification request.",
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
