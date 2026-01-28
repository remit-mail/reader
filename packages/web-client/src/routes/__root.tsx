import { createRootRouteWithContext, Outlet } from "@tanstack/react-router";
import { Suspense } from "react";
import { useTranslation } from "react-i18next";
import type { RouterContext } from "@/router";

export const Route = createRootRouteWithContext<RouterContext>()({
	component: RootLayout,
});

const SkipLink = () => {
	const { t } = useTranslation();

	return (
		<a
			href="#main-content"
			className="sr-only focus:not-sr-only focus:absolute focus:z-50 focus:p-4 focus:bg-background focus:text-foreground focus:rounded-md"
		>
			{t("accessibility.skipToContent")}
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
		<>
			<SkipLink />
			<main id="main-content" className="h-screen overflow-hidden">
				<Suspense fallback={<LoadingSkeleton />}>
					<Outlet />
				</Suspense>
			</main>
		</>
	);
}
