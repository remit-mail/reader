import { meOperationsListQuarantineOptions } from "@remit/api-http-client/@tanstack/react-query.gen.ts";
import type { RemitImapQuarantineListResponse } from "@remit/api-http-client/types.gen.ts";
import { useQuery } from "@tanstack/react-query";
import { isUnauthenticated, softErrorStatuses } from "@/lib/error-classifier";

const WARNINGS_LIST_META = softErrorStatuses(401);

export function useWarningsList() {
	return useQuery({
		...meOperationsListQuarantineOptions(),
		meta: WARNINGS_LIST_META,
	});
}

export const WARNINGS_ATTENTION = {
	listed: "Sync warnings",
	unread: "Warnings could not be read",
	signedOut: "Session ended",
} as const;

export function warningsAttentionOf(
	data: RemitImapQuarantineListResponse | undefined,
	error: unknown,
): string | undefined {
	if (isUnauthenticated(error)) return WARNINGS_ATTENTION.signedOut;
	if (error) return WARNINGS_ATTENTION.unread;
	if (!data) return undefined;
	if ((data.entries?.length ?? 0) > 0 || (data.warnings?.length ?? 0) > 0) {
		return WARNINGS_ATTENTION.listed;
	}
	return undefined;
}

export function useWarningsAttention(): string | undefined {
	const list = useWarningsList();
	return warningsAttentionOf(list.data, list.error);
}
