import {
	MutationCache,
	QueryCache,
	QueryClient,
	QueryClientProvider,
} from "@tanstack/react-query";
import { createMemoryHistory, RouterProvider } from "@tanstack/react-router";
import { useState } from "react";
import {
	handleMutationCacheError,
	handleQueryCacheError,
} from "@/lib/query-error-handler";
import { noopTelemetry } from "@/lib/telemetry";
import { createAppRouter } from "@/router";
import "@/lib/i18n";
import "@/lib/client";

export interface AppStoryProps {
	url: string;
}

const createStoryQueryClient = (): QueryClient =>
	new QueryClient({
		queryCache: new QueryCache({ onError: handleQueryCacheError }),
		mutationCache: new MutationCache({ onError: handleMutationCacheError }),
		defaultOptions: {
			queries: { staleTime: Number.POSITIVE_INFINITY, retry: false },
			mutations: { retry: false },
		},
	});

export function AppStory({ url }: AppStoryProps) {
	const [queryClient] = useState(createStoryQueryClient);
	const [router] = useState(() =>
		createAppRouter(
			queryClient,
			noopTelemetry,
			createMemoryHistory({ initialEntries: [url] }),
		),
	);

	return (
		<QueryClientProvider client={queryClient}>
			<RouterProvider router={router} />
		</QueryClientProvider>
	);
}
