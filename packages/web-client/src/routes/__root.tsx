import {
	createRootRouteWithContext,
	type ErrorComponentProps,
	Outlet,
} from "@tanstack/react-router";
import { Suspense } from "react";
import { useTranslation } from "react-i18next";
import { ComposeProvider } from "@/components/compose/ComposeProvider";
import { ErrorBannerProvider } from "@/components/ui/ErrorBannerProvider";
import { ErrorState } from "@/components/ui/ErrorState";
import type { RouterContext } from "@/router";

const RootErrorComponent = ({ error, reset }: ErrorComponentProps) => (
	<div className="flex h-dvh items-center justify-center bg-canvas p-4">
		<ErrorState title="Something went wrong" error={error} onRetry={reset} />
	</div>
);

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

const LoadingSkeleton = () => (
	<div className="flex h-dvh items-center justify-center bg-canvas">
		<span className="text-fg-muted">Loading...</span>
	</div>
);

function RootLayout() {
	return (
		<ErrorBannerProvider>
			<ComposeProvider>
				<SkipLink />
				<main id="main-content" className="h-dvh overflow-hidden">
					<Suspense fallback={<LoadingSkeleton />}>
						<Outlet />
					</Suspense>
				</main>
			</ComposeProvider>
		</ErrorBannerProvider>
	);
}
