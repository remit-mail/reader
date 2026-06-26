import { PullToRefresh as KitPullToRefresh } from "@remit/ui";
import type { ReactElement } from "react";

import { useTriggerSync } from "@/hooks/useTriggerSync";

interface PullToRefreshProps {
	accountId: string;
	children: ReactElement;
}

/**
 * Binds the kit pull-to-refresh gesture to a mailbox sync for the active
 * account: a pull triggers the sync and the in-flight state suspends the
 * gesture until it settles.
 */
export const PullToRefresh = ({ accountId, children }: PullToRefreshProps) => {
	const { triggerAsync, isPending } = useTriggerSync(accountId);

	return (
		<KitPullToRefresh onRefresh={triggerAsync} isRefreshing={isPending}>
			{children}
		</KitPullToRefresh>
	);
};
