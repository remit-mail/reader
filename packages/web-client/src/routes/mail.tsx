import { configOperationsGetConfigOptions } from "@remit/api-http-client/@tanstack/react-query.gen.ts";
import type { RemitImapAccountResponse } from "@remit/api-http-client/types.gen.ts";
import { useQuery } from "@tanstack/react-query";
import {
	createFileRoute,
	Outlet,
	useNavigate,
	useSearch,
} from "@tanstack/react-router";
import {
	createContext,
	useCallback,
	useContext,
	useEffect,
	useState,
} from "react";
import { z } from "zod";
import { BottomNav } from "@/components/layout/BottomNav";
import { ComposeFab } from "@/components/layout/ComposeFab";
import { Drawer } from "@/components/layout/Drawer";
import { Header } from "@/components/layout/Header";
import { HideHeaderProvider } from "@/components/layout/HideHeaderContext";
import { Panel } from "@/components/layout/Panel";
import {
	ResizableHandle,
	ResizablePanel,
	ResizablePanelGroup,
} from "@/components/layout/Resizable";
import { MailSidebar } from "@/components/mail/MailSidebar";
import { ThreadActionsProvider } from "@/components/mail/ThreadActionsContext";
import { ErrorState } from "@/components/ui/ErrorState";
import { KeyboardShortcutsModal } from "@/components/ui/KeyboardShortcutsModal";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { useKeyboardNavigation } from "@/hooks/useKeyboardNavigation";
import { useIsDesktop } from "@/hooks/useMediaQuery";
import "@/lib/client";

const mailSearchSchema = z.object({
	q: z.string().optional(),
});

type MailSearch = z.infer<typeof mailSearchSchema>;

interface MailContextValue {
	accounts: RemitImapAccountResponse[];
	searchQuery: string;
}

const MailContext = createContext<MailContextValue | null>(null);

export const useMailContext = (): MailContextValue => {
	const context = useContext(MailContext);
	// Return default values if context not yet available (e.g., during loading)
	// This can happen when TanStack Router renders child routes before parent finishes
	return context ?? { accounts: [], searchQuery: "" };
};

export const Route = createFileRoute("/mail")({
	component: MailLayout,
	validateSearch: mailSearchSchema,
});

function MailLayout() {
	const { q: searchQuery = "" } = useSearch({ from: "/mail" });
	const navigate = useNavigate();
	const isDesktop = useIsDesktop();
	const [showShortcuts, setShowShortcuts] = useState(false);
	const [drawerOpen, setDrawerOpen] = useState(false);

	// Local input state — keeps the SearchBar responsive while we debounce
	// the URL write below. Without this, every keystroke would trigger a
	// route-state mutation and an in-flight search request.
	const [searchInput, setSearchInput] = useState(searchQuery);
	const debouncedSearchInput = useDebouncedValue(searchInput, 200);

	const {
		data: config,
		isLoading,
		isError: isConfigError,
		error: configError,
		refetch: refetchConfig,
	} = useQuery({
		...configOperationsGetConfigOptions(),
		// Config only changes when accounts are added/edited/removed; those
		// mutations explicitly invalidate this query.
		staleTime: Infinity,
	});

	// Global keyboard shortcut for help
	useKeyboardNavigation({
		enabled: !showShortcuts,
		bindings: [
			{
				key: "?",
				handler: () => setShowShortcuts(true),
				noModifiers: false, // Allow shift+/
				preventDefault: true,
			},
		],
	});

	// Push debounced input to the URL. Skips the initial render where the
	// debounced value already matches the URL, and skips identical updates
	// to avoid infinite loops with the URL → state sync below.
	useEffect(() => {
		if (debouncedSearchInput === searchQuery) return;
		navigate({
			to: ".",
			search: (prev: MailSearch) => ({
				...prev,
				q: debouncedSearchInput || undefined,
			}),
			replace: true,
		});
	}, [debouncedSearchInput, searchQuery, navigate]);

	// External URL changes (e.g. router back/forward, or programmatic clears
	// like the Escape-to-clear path on SearchBar's onClear) should refresh
	// the local input. Only sync when they diverge to avoid clobbering
	// in-flight typing.
	useEffect(() => {
		setSearchInput((prev) => (prev === searchQuery ? prev : searchQuery));
	}, [searchQuery]);

	const handleSearchChange = useCallback((query: string) => {
		setSearchInput(query);
	}, []);

	const handleSearchClear = useCallback(() => {
		setSearchInput("");
		navigate({
			to: ".",
			search: (prev: MailSearch) => ({ ...prev, q: undefined }),
			replace: true,
		});
	}, [navigate]);

	const accounts = config?.accounts ?? [];

	return (
		<MailContext.Provider value={{ accounts, searchQuery }}>
			<ThreadActionsProvider>
				<HideHeaderProvider>
					{isConfigError ? (
						<div className="flex h-full items-center justify-center bg-background p-4">
							<ErrorState
								title="Couldn't load your account"
								error={configError}
								onRetry={() => {
									refetchConfig();
								}}
							/>
						</div>
					) : isLoading ? (
						<div className="flex h-full items-center justify-center bg-background">
							<span className="text-muted-foreground">Loading...</span>
						</div>
					) : (
						<div className="flex flex-col h-full bg-background">
							<Header
								searchQuery={searchInput}
								onSearchChange={handleSearchChange}
								onSearchClear={handleSearchClear}
								onMenuClick={() => setDrawerOpen(true)}
							/>
							{/*
							 * Desktop: resizable sidebar + outlet via ResizablePanelGroup.
							 * Mobile (< md): outlet only — the sidebar lives in the Drawer.
							 * We branch with `isDesktop` (matchMedia) instead of CSS hide,
							 * because react-resizable-panels does not handle `display:none`
							 * on its panels.
							 */}
							<div className="flex-1 min-h-0">
								{isDesktop ? (
									<ResizablePanelGroup
										direction="horizontal"
										className="h-full"
										autoSaveId="remit-mail-shell"
									>
										<ResizablePanel
											id="sidebar"
											order={1}
											defaultSize={15}
											minSize={10}
										>
											<Panel className="h-full">
												<MailSidebar accounts={accounts} />
											</Panel>
										</ResizablePanel>
										<ResizableHandle />
										<ResizablePanel
											id="content"
											order={2}
											defaultSize={85}
											minSize={30}
										>
											<Outlet />
										</ResizablePanel>
									</ResizablePanelGroup>
								) : (
									<div
										className="h-full"
										style={{
											// Reserve space for the bottom nav + iOS safe area.
											paddingBottom:
												"calc(3.5rem + env(safe-area-inset-bottom, 0))",
										}}
									>
										<Outlet />
									</div>
								)}
							</div>
							{/* Mobile drawer holds the sidebar */}
							<Drawer
								isOpen={drawerOpen}
								onClose={() => setDrawerOpen(false)}
								ariaLabel="Mailboxes and accounts"
							>
								<MailSidebar accounts={accounts} />
							</Drawer>
							{/* Bottom nav (mobile only). Context-aware: shows global tabs
						    by default, swaps to thread actions (Back, Reply, Forward)
						    while reading a conversation. */}
							<BottomNav />
							{/* Mobile compose FAB. The compose form itself takes over the
						    detail pane in `routes/mail/$mailboxId.tsx`, which on
						    mobile is the entire screen — so compose effectively goes
						    full-screen with no extra plumbing. */}
							<ComposeFab />
						</div>
					)}
					<KeyboardShortcutsModal
						isOpen={showShortcuts}
						onClose={() => setShowShortcuts(false)}
					/>
				</HideHeaderProvider>
			</ThreadActionsProvider>
		</MailContext.Provider>
	);
}
