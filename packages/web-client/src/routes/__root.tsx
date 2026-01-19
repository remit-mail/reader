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

const LoadingSkeleton = () => {
	const { t } = useTranslation();

	return (
		<output
			aria-live="polite"
			className="flex items-center justify-center h-full"
		>
			<span className="text-muted-foreground">{t("app.loading")}</span>
		</output>
	);
};

function RootLayout() {
	return (
		<>
			<SkipLink />

			<div className="flex h-screen">
				<main id="main-content" className="flex-1 overflow-auto">
					<Suspense fallback={<LoadingSkeleton />}>
						<Outlet />
					</Suspense>
				</main>
			</div>
		</>
	);
}
