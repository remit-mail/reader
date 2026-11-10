import { ClassificationFailureKind } from "@remit/domain-enums";

export type ClassificationFailureKindValue =
	(typeof ClassificationFailureKind)[keyof typeof ClassificationFailureKind];

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
