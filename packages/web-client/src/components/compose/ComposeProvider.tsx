import type {
	RemitImapAccountResponse,
	RemitImapDescribeMessageResponse,
} from "@remit/api-http-client/types.gen.ts";
import {
	createContext,
	useCallback,
	useContext,
	useMemo,
	useState,
} from "react";

export type ComposeMode = "reply" | "reply_all" | "forward" | "new";

export interface ComposeState {
	isOpen: boolean;
	mode: ComposeMode;
	account?: RemitImapAccountResponse;
	sourceMessage?: RemitImapDescribeMessageResponse;
	threadId?: string;
	mailboxId?: string;
	outboxMessageId?: string;
}

interface ComposeContextValue {
	state: ComposeState;
	openCompose: (params: Omit<ComposeState, "isOpen">) => void;
	closeCompose: () => void;
	setOutboxMessageId: (id: string) => void;
}

const ComposeContext = createContext<ComposeContextValue | undefined>(
	undefined,
);

const INITIAL_STATE: ComposeState = {
	isOpen: false,
	mode: "new",
};

export const ComposeProvider = ({
	children,
}: {
	children: React.ReactNode;
}) => {
	const [state, setState] = useState<ComposeState>(INITIAL_STATE);

	const openCompose = useCallback((params: Omit<ComposeState, "isOpen">) => {
		setState({ ...params, isOpen: true });
	}, []);

	const closeCompose = useCallback(() => {
		setState(INITIAL_STATE);
	}, []);

	const setOutboxMessageId = useCallback((id: string) => {
		setState((prev) => ({ ...prev, outboxMessageId: id }));
	}, []);

	const value = useMemo(
		() => ({ state, openCompose, closeCompose, setOutboxMessageId }),
		[state, openCompose, closeCompose, setOutboxMessageId],
	);

	return (
		<ComposeContext.Provider value={value}>{children}</ComposeContext.Provider>
	);
};

export const useCompose = (): ComposeContextValue => {
	const context = useContext(ComposeContext);
	if (!context) {
		throw new Error("useCompose must be used within a ComposeProvider");
	}
	return context;
};
