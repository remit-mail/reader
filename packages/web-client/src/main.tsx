import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
import { RouterProvider } from "@tanstack/react-router";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { AuthShell } from "./auth/AuthShell";
import { configureAmplify } from "./auth/amplify-config";
import { installAuthInterceptor } from "./auth/auth-interceptor";
import { installThemeSync } from "./lib/theme";
import { createAppRouter } from "./router";
import "./lib/i18n";
import "./index.css";
import "./lib/client"; // Initialize client with error interceptor

installThemeSync();
configureAmplify();
installAuthInterceptor();

const queryClient = new QueryClient({
	defaultOptions: {
		queries: {
			staleTime: 30_000,
			gcTime: 5 * 60_000,
			retry: 1,
		},
	},
});

const router = createAppRouter(queryClient);

const rootElement = document.getElementById("root");
if (!rootElement) {
	throw new Error("Root element not found");
}

createRoot(rootElement).render(
	<StrictMode>
		<QueryClientProvider client={queryClient}>
			<AuthShell>
				<RouterProvider router={router} />
			</AuthShell>
			<ReactQueryDevtools initialIsOpen={false} />
		</QueryClientProvider>
	</StrictMode>,
);
