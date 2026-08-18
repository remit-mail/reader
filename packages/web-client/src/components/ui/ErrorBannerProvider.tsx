import {
	createContext,
	type ReactNode,
	useCallback,
	useContext,
	useMemo,
	useState,
} from "react";
import { buildBugReportContext, buildGitHubIssueUrl } from "@/lib/bug-report";
import { isAlwaysFatal } from "@/lib/error-classifier";
import { reportFatalError } from "@/lib/fatal-error";
import { ErrorBannerStack } from "./ErrorBannerStack.js";
import {
	appendBanner,
	buildEntry,
	dismissBanner,
	type ErrorBannerAction,
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

/**
 * A way out of every failure banner. A soft failure is still a failure the
 * user could not prevent and cannot diagnose, and a banner offering only
 * "Dismiss" is a dead end — the fatal screen has carried a prefilled report
 * since issue #55 and the soft surface never did. The report is seeded from
 * the banner it belongs to, so it names the failure instead of asking the
 * user to describe it, and it carries the same breadcrumbs — failing request,
 * navigation, console — the fatal report does.
 *
 * A caller that already has a better way out keeps it, and a warning or an
 * informational banner gets none: those are not failures to report.
 */
export const bannerWayOut = (
	input: PushErrorInput,
): ErrorBannerAction | undefined => {
	if (input.action) return input.action;
	if ((input.severity ?? "error") !== "error") return undefined;
	return {
		label: "Report an issue",
		href: buildGitHubIssueUrl(
			buildBugReportContext({
				title: `Bug: ${input.title}`,
				errorMessage: input.detail
					? `${input.title} — ${input.detail}`
					: input.title,
				stack: input.error instanceof Error ? input.error.stack : undefined,
			}),
		),
	};
};

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
	 *
	 * The guard is on the error being present, not on the key being present:
	 * `error` is optional, so a caller forwarding one it does not have passes
	 * `undefined`, and "no error at all" must not be classified as a bug.
	 */
	const pushError = useCallback((input: PushErrorInput): string => {
		if (input.error != null && isAlwaysFatal(input.error)) {
			return reportFatalError(input.error).correlationId;
		}
		const entry = buildEntry(
			{ ...input, action: bannerWayOut(input) },
			generateId(),
			Date.now(),
		);
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
