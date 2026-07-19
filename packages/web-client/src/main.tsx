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
import { AuthShell } from "./auth/AuthShell";
import { configureAmplify } from "./auth/amplify-config";
import { installAuthInterceptor } from "./auth/auth-interceptor";
import { install as installConsoleErrorCatcher } from "./lib/console-errors";
import { setFatalErrorTelemetry } from "./lib/fatal-error";
import {
	handleMutationCacheError,
	handleQueryCacheError,
} from "./lib/query-error-handler";
import { initRum } from "./lib/rum-adapter";
import { TelemetryContext } from "./lib/telemetry-context";
import { installThemeSync } from "./lib/theme";
import { createAppRouter } from "./router";
import { getRuntimeConfig } from "./runtime-config";
import "./lib/i18n";
import "./index.css";
import "./lib/client"; // Initialize client with error interceptor

installConsoleErrorCatcher();
installThemeSync();
configureAmplify();
installAuthInterceptor();

const telemetry = initRum();
// Plug the live telemetry adapter into the single fatal-error seam.
setFatalErrorTelemetry(telemetry);

// Every query and mutation error flows through the global fail-fast classifier
// (#1059): a non-2xx escalates to the full-screen red overlay by DEFAULT — a 5xx
// always escalates (even on a background refetch). Only aborts, statusless
// connectivity blips, and non-5xx errors a call site explicitly opted out of via
// `meta.softError` stay soft. This is the v5 equivalent of
// `defaultOptions.queries.onError` / `.mutations.onError`.
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

const rootElement = document.getElementById("root");
if (!rootElement) {
	throw new Error("Root element not found");
}

createRoot(rootElement).render(
	<StrictMode>
		<TelemetryContext.Provider value={telemetry}>
			<QueryClientProvider client={queryClient}>
				<AuthShell>
					<RouterProvider router={router} />
				</AuthShell>
				{!import.meta.env.PROD && !getRuntimeConfig().disableDevtools && (
					<ReactQueryDevtools initialIsOpen={false} />
				)}
			</QueryClientProvider>
		</TelemetryContext.Provider>
	</StrictMode>,
);
