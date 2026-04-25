import {
	createContext,
	useCallback,
	useContext,
	useMemo,
	useState,
} from "react";

export interface ThreadActions {
	onBack: () => void;
	onReply?: () => void;
	onReplyAll?: () => void;
	onForward?: () => void;
	disabled?: boolean;
}

interface ThreadActionsContextValue {
	actions: ThreadActions | null;
	setActions: (actions: ThreadActions | null) => void;
}

const ThreadActionsContext = createContext<ThreadActionsContextValue | null>(
	null,
);

/**
 * Provides a slot for the active thread/conversation to publish its
 * primary actions (Back, Reply, ReplyAll, Forward) so that mobile chrome
 * (the bottom nav) can render them in a single bottom bar.
 *
 * Desktop renders these actions inline in the conversation pane and does
 * not need to consume this context.
 */
export const ThreadActionsProvider = ({
	children,
}: {
	children: React.ReactNode;
}) => {
	const [actions, setActions] = useState<ThreadActions | null>(null);
	const value = useMemo(() => ({ actions, setActions }), [actions]);
	return (
		<ThreadActionsContext.Provider value={value}>
			{children}
		</ThreadActionsContext.Provider>
	);
};

export const useThreadActions = (): ThreadActions | null => {
	const ctx = useContext(ThreadActionsContext);
	return ctx?.actions ?? null;
};

/**
 * Stable setter for publishing actions into the provider. Returns a noop
 * when used outside a provider so consumers don't need to guard.
 */
export const useSetThreadActions = (): ((
	actions: ThreadActions | null,
) => void) => {
	const ctx = useContext(ThreadActionsContext);
	const noop = useCallback(() => {}, []);
	return ctx?.setActions ?? noop;
};
