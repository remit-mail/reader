import type { ReactElement } from "react";
import ReactPullToRefresh from "react-simple-pull-to-refresh";

import { useIsDesktop } from "@/hooks/useMediaQuery";
import { useTriggerSync } from "@/hooks/useTriggerSync";

interface PullToRefreshProps {
	accountId: string;
	children: ReactElement;
}

/**
 * Wraps children with pull-to-refresh on mobile. Triggers a mailbox sync
 * for the active account when pulled down. On desktop, renders children
 * directly (no pull behaviour).
 */
export const PullToRefresh = ({ accountId, children }: PullToRefreshProps) => {
	const isDesktop = useIsDesktop();
	const { triggerAsync } = useTriggerSync(accountId);

	if (isDesktop) {
		return <>{children}</>;
	}

	return (
		<ReactPullToRefresh onRefresh={triggerAsync}>{children}</ReactPullToRefresh>
	);
};
