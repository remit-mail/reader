import {
	createContext,
	useCallback,
	useContext,
	useMemo,
	useState,
} from "react";

interface HideHeaderContextValue {
	hidden: boolean;
	setHidden: (hidden: boolean) => void;
}

const HideHeaderContext = createContext<HideHeaderContextValue | null>(null);

/**
 * Provides a flag the active route can flip to hide the top Header on
 * mobile. Mirrors the pattern used by `ThreadActionsContext` — the
 * thread/conversation view publishes `true` while it owns the screen so
 * the bottom nav (which already shows Back / Reply / Forward) is the
 * only chrome.
 *
 * Desktop layouts ignore this signal — Header consumers should branch
 * on viewport before respecting `hidden`.
 */
export const HideHeaderProvider = ({
	children,
}: {
	children: React.ReactNode;
}) => {
	const [hidden, setHidden] = useState(false);
	const value = useMemo(() => ({ hidden, setHidden }), [hidden]);
	return (
		<HideHeaderContext.Provider value={value}>
			{children}
		</HideHeaderContext.Provider>
	);
};

export const useHideHeader = (): boolean => {
	const ctx = useContext(HideHeaderContext);
	return ctx?.hidden ?? false;
};

/**
 * Stable setter for publishing the hide flag. Returns a noop when used
 * outside a provider so consumers don't need to guard.
 */
export const useSetHideHeader = (): ((hidden: boolean) => void) => {
	const ctx = useContext(HideHeaderContext);
	const noop = useCallback(() => {}, []);
	return ctx?.setHidden ?? noop;
};
