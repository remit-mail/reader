import {
	MutationCache,
	QueryCache,
	QueryClient,
	QueryClientProvider,
} from "@tanstack/react-query";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
import { RouterProvider } from "@tanstack/react-router";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { installAuthInterceptor } from "@/auth/auth-interceptor";
import { type AuthProvider, AuthProviderProvider } from "@/auth/provider";
import { install as installConsoleErrorCatcher } from "@/lib/console-errors";
import { setFatalErrorTelemetry } from "@/lib/fatal-error";
import {
	handleMutationCacheError,
	handleQueryCacheError,
} from "@/lib/query-error-handler";
import { initRum } from "@/lib/rum-adapter";
import { TelemetryContext } from "@/lib/telemetry-context";
import { installThemeSync } from "@/lib/theme";
import { createAppRouter } from "@/router";
import { getRuntimeConfig } from "@/runtime-config";
import "@/lib/i18n";
import "@/index.css";
import "@/lib/client"; // Initialize client with error interceptor

export interface MountOptions {
	/** The identity system this build composes. */
	authProvider: AuthProvider;
	/** Element to mount into. Defaults to `#root`. */
	rootElementId?: string;
}

/**
 * Boot the web client against a composed auth provider. This is the app shell:
 * providers, router, telemetry, and the global fail-fast query wiring — every
 * primitive a deployment shares, with the identity system supplied by the
 * distributor rather than baked in.
 */
export const mountApp = ({
	authProvider,
	rootElementId = "root",
}: MountOptions): void => {
	installConsoleErrorCatcher();
	installThemeSync();
	authProvider.configure();
	installAuthInterceptor(authProvider);

	const telemetry = initRum();
	// Plug the live telemetry adapter into the single fatal-error seam.
	setFatalErrorTelemetry(telemetry);

	// Every query and mutation error flows through the global fail-fast
	// classifier (#1059): a non-2xx escalates to the full-screen red overlay by
	// DEFAULT — a 5xx always escalates (even on a background refetch). Only
	// aborts, statusless connectivity blips, and non-5xx errors a call site
	// explicitly opted out of via `meta.softError` stay soft. This is the v5
	// equivalent of `defaultOptions.queries.onError` / `.mutations.onError`.
	const queryClient = new QueryClient({
		queryCache: new QueryCache({ onError: handleQueryCacheError }),
		mutationCache: new MutationCache({ onError: handleMutationCacheError }),
		defaultOptions: {
			queries: {
				staleTime: 30_000,
				gcTime: 5 * 60_000,
				retry: 1,
			},
		},
	});

	const router = createAppRouter(queryClient, telemetry);
	telemetry.recordPageView(window.location.pathname);

	const rootElement = document.getElementById(rootElementId);
	if (!rootElement) {
		throw new Error(`Root element not found: #${rootElementId}`);
	}

	const { Shell } = authProvider;

	createRoot(rootElement).render(
		<StrictMode>
			<TelemetryContext.Provider value={telemetry}>
				<QueryClientProvider client={queryClient}>
					<AuthProviderProvider value={authProvider}>
						<Shell>
							<RouterProvider router={router} />
						</Shell>
					</AuthProviderProvider>
					{!import.meta.env.PROD && !getRuntimeConfig().disableDevtools && (
						<ReactQueryDevtools initialIsOpen={false} />
					)}
				</QueryClientProvider>
			</TelemetryContext.Provider>
		</StrictMode>,
	);
};
