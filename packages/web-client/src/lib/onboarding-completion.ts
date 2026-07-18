import { configOperationsGetConfigQueryKey } from "@remit/api-http-client/@tanstack/react-query.gen.ts";
import type { QueryClient } from "@tanstack/react-query";

/**
 * Finishing onboarding creates the account server-side, but the cached config
 * still reports zero accounts. The /mail route's first-run guard redirects to
 * /onboarding whenever config reports no accounts, so navigating to the inbox
 * before the cache is refreshed bounces the user straight back into the wizard.
 *
 * Refresh config and wait for it to settle before navigating, so the guard sees
 * the freshly created account.
 */
export async function completeOnboarding(deps: {
	queryClient: Pick<QueryClient, "refetchQueries">;
	recordCompleted: () => void;
	navigateToInbox: () => void;
}): Promise<void> {
	deps.recordCompleted();
	await deps.queryClient.refetchQueries({
		queryKey: configOperationsGetConfigQueryKey(),
	});
	deps.navigateToInbox();
}
