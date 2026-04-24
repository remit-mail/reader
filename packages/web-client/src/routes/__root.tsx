import { createRootRouteWithContext, Outlet } from "@tanstack/react-router";
import { Suspense } from "react";
import { useTranslation } from "react-i18next";
import { ComposeProvider } from "@/components/compose/ComposeProvider";
import type { RouterContext } from "@/router";

export const Route = createRootRouteWithContext<RouterContext>()({
	component: RootLayout,
});

const SkipLink = () => {
	// Provide a string fallback so Suspense doesn't render the raw i18n key
	// while the common namespace is still loading over HTTP.
	const { t } = useTranslation("common", { useSuspense: false });

	return (
		<a
			href="#main-content"
			className="sr-only focus:not-sr-only focus:absolute focus:z-50 focus:p-4 focus:bg-background focus:text-foreground focus:rounded-md"
		>
			{t("accessibility.skipToContent", "Skip to main content")}
		</a>
	);
};

const LoadingSkeleton = () => (
	<div className="flex h-screen items-center justify-center bg-background">
		<span className="text-muted-foreground">Loading...</span>
	</div>
);

function RootLayout() {
	return (
		<ComposeProvider>
			<SkipLink />
			<main id="main-content" className="h-screen overflow-hidden">
				<Suspense fallback={<LoadingSkeleton />}>
					<Outlet />
				</Suspense>
			</main>
		</ComposeProvider>
	);
}
