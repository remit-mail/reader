import {
	createContext,
	type ReactNode,
	useCallback,
	useContext,
	useMemo,
	useState,
} from "react";
import { isAlwaysFatal } from "@/lib/error-classifier";
import { reportFatalError } from "@/lib/fatal-error";
import { ErrorBannerStack } from "./ErrorBannerStack.js";
import {
	appendBanner,
	buildEntry,
	dismissBanner,
	type ErrorBannerEntry,
	type PushErrorInput,
} from "./error-banners.js";

interface ErrorBannerContextValue {
	errors: ErrorBannerEntry[];
	pushError: (input: PushErrorInput) => string;
	dismissError: (id: string) => void;
	clearAll: () => void;
}

const ErrorBannerContext = createContext<ErrorBannerContextValue | undefined>(
	undefined,
);

const generateId = (): string => {
	if (
		typeof globalThis.crypto !== "undefined" &&
		typeof globalThis.crypto.randomUUID === "function"
	) {
		return globalThis.crypto.randomUUID();
	}
	return `banner-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
};

export const ErrorBannerProvider = ({ children }: { children: ReactNode }) => {
	const [errors, setErrors] = useState<ErrorBannerEntry[]>([]);

	/**
	 * Show a soft, dismissible banner — and only that. A fatal error is not a
	 * notification: when the caller hands us a 5xx or an exception from our own
	 * code, it goes to the fatal seam instead, so the user gets the full-screen
	 * page with a way forward and a bug report rather than a toast they can only
	 * dismiss (issue #55). Those two classes are fatal with no opt-out; anything
	 * a call site can legitimately own — a 404 empty state, a 4xx the user can
	 * act on — still banners here.
	 */
	const pushError = useCallback((input: PushErrorInput): string => {
		if ("error" in input && isAlwaysFatal(input.error)) {
			return reportFatalError(input.error).correlationId;
		}
		const entry = buildEntry(input, generateId(), Date.now());
		setErrors((current) => appendBanner(current, entry));
		return entry.id;
	}, []);

	const dismissError = useCallback((id: string) => {
		setErrors((current) => dismissBanner(current, id));
	}, []);

	const clearAll = useCallback(() => {
		setErrors([]);
	}, []);

	const value = useMemo(
		() => ({ errors, pushError, dismissError, clearAll }),
		[errors, pushError, dismissError, clearAll],
	);

	return (
		<ErrorBannerContext.Provider value={value}>
			{children}
			<ErrorBannerStack errors={errors} onDismiss={dismissError} />
		</ErrorBannerContext.Provider>
	);
};

export const useErrorBanners = (): ErrorBannerContextValue => {
	const context = useContext(ErrorBannerContext);
	if (!context) {
		throw new Error(
			"useErrorBanners must be used within an ErrorBannerProvider",
		);
	}
	return context;
};
