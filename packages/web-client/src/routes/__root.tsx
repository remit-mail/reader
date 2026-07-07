import {
	createRootRouteWithContext,
	type ErrorComponentProps,
	Outlet,
} from "@tanstack/react-router";
import { Suspense } from "react";
import { useTranslation } from "react-i18next";
import { ComposeProvider } from "@/components/compose/ComposeProvider";
import { AppShellSkeleton } from "@/components/layout/AppShellSkeleton";
import { ErrorBannerProvider } from "@/components/ui/ErrorBannerProvider";
import {
	FatalErrorOverlay,
	FatalErrorScreen,
} from "@/components/ui/FatalErrorOverlay";
import { isServerError } from "@/lib/error-classifier";
import { reportFatalError } from "@/lib/fatal-error";
import type { RouterContext } from "@/router";

const RootErrorComponent = ({ error, reset, info }: ErrorComponentProps) => {
	// Everything that bubbles to the route boundary escalates to the loud
	// full-screen fatal page — never the soft grey "Something went wrong" that
	// implied recovery. A bubbled 5xx is transient (Retry re-runs the loader via
	// reset); a caught render exception is deterministic — retry re-crashes, so
	// it is fatal with no Retry, offering a safe route out instead (issue #1231).
	const recoverable = isServerError(error);
	const fatal = reportFatalError(error, {
		recoverable,
		componentStack: info?.componentStack,
	});
	return (
		<FatalErrorScreen fatal={fatal} onRetry={recoverable ? reset : undefined} />
	);
};

export const Route = createRootRouteWithContext<RouterContext>()({
	component: RootLayout,
	errorComponent: RootErrorComponent,
});

const SkipLink = () => {
	// Provide a string fallback so Suspense doesn't render the raw i18n key
	// while the common namespace is still loading over HTTP.
	const { t } = useTranslation("common", { useSuspense: false });

	return (
		<a
			href="#main-content"
			className="sr-only focus:not-sr-only focus:absolute focus:z-50 focus:p-4 focus:bg-canvas focus:text-fg focus:rounded-md"
		>
			{t("accessibility.skipToContent", "Skip to main content")}
		</a>
	);
};

function RootLayout() {
	return (
		<ErrorBannerProvider>
			<ComposeProvider>
				<SkipLink />
				<main id="main-content" className="h-dvh overflow-hidden">
					<Suspense fallback={<AppShellSkeleton />}>
						<Outlet />
					</Suspense>
				</main>
			</ComposeProvider>
			<FatalErrorOverlay />
		</ErrorBannerProvider>
	);
}
