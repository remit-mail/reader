import type { CalendarSlotPick } from "@remit/ui";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
	type AnyRouter,
	createMemoryHistory,
	createRootRoute,
	createRoute,
	createRouter,
	Outlet,
	RouterProvider,
} from "@tanstack/react-router";
import { type ReactNode, useState } from "react";
import { CalendarComposeSeedProvider } from "@/components/calendar/CalendarComposeSeed";
import { calendarSearchSchema } from "@/lib/calendar-route";
import { client } from "@/lib/client";
import { stringifySearch } from "@/lib/search-params";

/**
 * The calendar's addresses and its server, stood up for a story.
 *
 * `AgendaView`, `OpenCalendarEvent` and `WriteCalendarEvent` are the three panes
 * that read the address and read the API, so a story cannot hand them props:
 * what they draw comes out of a URL and a response. Both are supplied here, with
 * synthetic answers, so the story still names one state and asserts it.
 *
 * The routes are built out of the real paths rather than out of the generated
 * tree — the route objects are module singletons and re-parenting one would
 * mutate it for every other story in the run. Their ids are what the panes read
 * their params `from`, which is what makes these the app's addresses rather than
 * an imitation of them.
 *
 * The server is the app's own generated client with its `fetch` swapped, so the
 * responses run through the same error interceptor the app installs: a 412 comes
 * back as the conflict the pane states, and not as a message it happens to
 * print.
 */

/** A reply to one request, at a status the client classifies the way it would. */
export const json = (body: unknown, status = 200): Response =>
	new Response(JSON.stringify(body), {
		status,
		headers: { "content-type": "application/json" },
	});

/** A request that never comes back, which is what a loading state is. */
export const never = (): Promise<Response> => new Promise<Response>(() => {});

export type CalendarServer = (request: Request) => Response | Promise<Response>;

/** Nowhere. Every request is answered before it can leave. */
const STORY_BASE_URL = "https://calendar.story.invalid";

function storyRouter(
	entry: string,
	pane: ReactNode,
	pick: CalendarSlotPick | undefined,
): AnyRouter {
	const leaf = () => <>{pane}</>;
	const rootRoute = createRootRoute({ component: Outlet });
	const viewRoute = createRoute({
		getParentRoute: () => rootRoute,
		path: "/calendar/$view/$date",
		validateSearch: calendarSearchSchema,
		component: () => (
			<CalendarComposeSeedProvider pick={pick}>
				<Outlet />
			</CalendarComposeSeedProvider>
		),
	});
	const eventRoute = createRoute({
		getParentRoute: () => viewRoute,
		path: "$calendarObjectId",
		component: Outlet,
	});
	const routeTree = rootRoute.addChildren([
		viewRoute.addChildren([
			createRoute({
				getParentRoute: () => viewRoute,
				path: "/",
				component: leaf,
			}),
			createRoute({
				getParentRoute: () => viewRoute,
				path: "new",
				component: leaf,
			}),
			eventRoute.addChildren([
				createRoute({
					getParentRoute: () => eventRoute,
					path: "/",
					component: leaf,
				}),
				createRoute({
					getParentRoute: () => eventRoute,
					path: "$recurrenceId",
					component: leaf,
				}),
			]),
		]),
	]);
	return createRouter({
		routeTree,
		stringifySearch,
		history: createMemoryHistory({ initialEntries: [entry] }),
	}) as unknown as AnyRouter;
}

export interface CalendarStoryProps {
	/** The pane under test, mounted at whichever address the story opens on. */
	pane: ReactNode;
	/** The address the story opens on. */
	entry: string;
	/** What the server answers, request by request. */
	server: CalendarServer;
	/** The slot a reader dragged out of the grid, for the composer. */
	pick?: CalendarSlotPick;
}

export function CalendarStory({
	pane,
	entry,
	server,
	pick,
}: CalendarStoryProps) {
	// Built once, and the client configured before anything can ask it a
	// question: a pane that fetched against the default host would reach for the
	// network on its first render.
	const [mounted] = useState(() => {
		client.setConfig({
			baseUrl: STORY_BASE_URL,
			fetch: ((input: RequestInfo | URL) =>
				Promise.resolve(
					server(input instanceof Request ? input : new Request(String(input))),
				)) as typeof globalThis.fetch,
		});
		return {
			router: storyRouter(entry, pane, pick),
			queryClient: new QueryClient({
				defaultOptions: {
					queries: { retry: false },
					mutations: { retry: false },
				},
			}),
		};
	});

	return (
		<QueryClientProvider client={mounted.queryClient}>
			<RouterProvider router={mounted.router} />
		</QueryClientProvider>
	);
}
