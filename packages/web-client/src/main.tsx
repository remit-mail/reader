import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
import { RouterProvider } from "@tanstack/react-router";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { AuthShell } from "./auth/AuthShell";
import { configureAmplify } from "./auth/amplify-config";
import { installAuthInterceptor } from "./auth/auth-interceptor";
import { install as installConsoleErrorCatcher } from "./lib/console-errors";
import { initRum } from "./lib/rum-adapter";
import { TelemetryContext } from "./lib/telemetry-context";
import { installThemeSync } from "./lib/theme";
import { createAppRouter } from "./router";
import "./lib/i18n";
import "./index.css";
import "./lib/client"; // Initialize client with error interceptor

installConsoleErrorCatcher();
installThemeSync();
configureAmplify();
installAuthInterceptor();

const telemetry = initRum();

const queryClient = new QueryClient({
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
				<ReactQueryDevtools initialIsOpen={false} />
			</QueryClientProvider>
		</TelemetryContext.Provider>
	</StrictMode>,
);
