import { configOperationsGetConfigOptions } from "@remit/api-http-client/@tanstack/react-query.gen.ts";
import {
	ResizableHandle,
	ResizablePanel,
	ResizablePanelGroup,
} from "@remit/ui";
import { useQuery } from "@tanstack/react-query";
import {
	createFileRoute,
	Outlet,
	redirect,
	useNavigate,
	useParams,
	useSearch,
} from "@tanstack/react-router";
import { ArrowLeft, Menu, Search, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { z } from "zod";
import { AccountMenu } from "@/auth/AccountMenu";
import { ComposeFab } from "@/components/layout/ComposeFab";
import { Drawer } from "@/components/layout/Drawer";
import { SearchBar } from "@/components/layout/SearchBar";
import { MailSidebar } from "@/components/mail/MailSidebar";
import { ErrorState } from "@/components/ui/ErrorState";
import { KeyboardShortcutsModal } from "@/components/ui/KeyboardShortcutsModal";
import { useCurrentMailboxName } from "@/hooks/useCurrentMailboxName";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { useKeyboardNavigation } from "@/hooks/useKeyboardNavigation";
import { useIsDesktop } from "@/hooks/useMediaQuery";
import { useStaleAccountSync } from "@/hooks/useStaleAccountSync";
import { MailContext } from "@/lib/mail-context";
import "@/lib/client";

// `MailContext` / `useMailContext` live in `@/lib/mail-context` so the provider
// here and the child-route consumers resolve to a single module instance — see
// that file for why the alias-vs-relative route-tree import split otherwise
// breaks context.
export { useMailContext } from "@/lib/mail-context";

const mailSearchSchema = z.object({
	q: z.string().optional(),
});

export const Route = createFileRoute("/mail")({
	// First-run guard lives on the /mail parent (not the index loader) so it
	// survives regardless of what the child route renders — index redirect,
	// daily brief (#426/#484), etc. A zero-account user is sent to the
	// onboarding wizard before any mail UI mounts.
	beforeLoad: async ({ context: { queryClient } }) => {
		const config = await queryClient.ensureQueryData(
			configOperationsGetConfigOptions(),
		);
		if (!config.accounts || config.accounts.length === 0) {
			throw redirect({ to: "/onboarding", replace: true });
		}
	},
	component: MailLayout,
	validateSearch: mailSearchSchema,
});

function MailLayout() {
	const { q: searchQuery = "" } = useSearch({ from: "/mail" });
	const navigate = useNavigate();
	const isDesktop = useIsDesktop();
	const [showShortcuts, setShowShortcuts] = useState(false);
	const [drawerOpen, setDrawerOpen] = useState(false);
	// Mobile-only: the top bar's search toggle expands an inline SearchBar
	// (same affordance the retired Header carried, preserved so mobile search
	// doesn't regress — the 4-pane desktop layout puts search in the toolbar).
	const [mobileSearchOpen, setMobileSearchOpen] = useState(false);
	// Pane 4 ships collapsed by default; the message-toolbar info icon toggles
	// it. State lives here so it survives thread navigation within /mail.
	const [intelligenceOpen, setIntelligenceOpen] = useState(false);

	// URL `q` is a load-once seed for the input and a one-directional write
	// target. The debounced local value is the source of truth and drives the
	// search API; it is mirrored back to the URL but the URL is never read into
	// state after mount.
	const [searchInput, setSearchInput] = useState(searchQuery);
	const debouncedSearchInput = useDebouncedValue(searchInput, 200);

	const searchQueryRef = useRef(searchQuery);
	searchQueryRef.current = searchQuery;

	// Mirror the debounced search into the URL so links are shareable and a
	// refresh restores the query. One-directional: the URL is never read back
	// into state, so there is no sync loop.
	// When a query goes active, also strip selectedMessageId so the reading
	// pane closes (#539): an open message from the pre-search list is not
	// meaningful in the search result set.
	useEffect(() => {
		if (debouncedSearchInput === searchQueryRef.current) return;
		navigate({
			to: ".",
			search: (prev) => ({
				...prev,
				q: debouncedSearchInput || undefined,
				...(debouncedSearchInput ? { selectedMessageId: undefined } : {}),
			}),
			replace: true,
		});
	}, [debouncedSearchInput, navigate]);

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

	const handleSearchChange = useCallback((query: string) => {
		setSearchInput(query);
	}, []);

	// Clears the search field; the write effect drops `q` from the URL after
	// the debounce settles.
	const handleSearchClear = useCallback(() => {
		setSearchInput("");
	}, []);

	// Esc inside the search field clears only the query (#489).
	const handleSearchClearQuery = useCallback(() => {
		setSearchInput("");
	}, []);

	const handleToggleIntelligence = useCallback(() => {
		setIntelligenceOpen((open) => !open);
	}, []);

	const accounts = config?.accounts ?? [];
	const mobileTitle = useCurrentMailboxName({ accounts });

	// Read the current mailbox params and selected message (if any) from the
	// child route so the mobile top-bar title can act as a back button when a
	// thread is open. `strict: false` lets the parent layout read child-route
	// params without coupling to the child route definition.
	const { mailboxId: mobileMailboxId } = useParams({ strict: false }) as {
		mailboxId?: string;
	};
	const { selectedMessageId: mobileSelectedMessageId } = useSearch({
		strict: false,
	}) as { selectedMessageId?: string };

	const handleMobileBackToInbox = useCallback(() => {
		if (!mobileMailboxId) return;
		navigate({
			to: "/mail/$mailboxId",
			params: { mailboxId: mobileMailboxId },
			search: (prev: Record<string, unknown>) => ({
				...prev,
				selectedMessageId: undefined,
			}),
		});
	}, [mobileMailboxId, navigate]);

	// Auto-trigger a mailbox-list sync for any account whose lastSyncAt is
	// older than 15 minutes (or unset). Fires once per accountId per session
	// — re-mounts of MailLayout will not retrigger. See #205.
	useStaleAccountSync(accounts);

	const handleMailboxSelect = useCallback(() => {
		// Auto-collapse the mobile drawer after the user picks an inbox
		// from the sidebar (#199). Desktop sidebar isn't a drawer so the
		// noop is fine there.
		setDrawerOpen(false);
	}, []);

	return (
		<MailContext.Provider
			value={{
				accounts,
				// Debounced local value is the source of truth for search; it is
				// mirrored to the URL one-directionally for shareable links.
				searchQuery: debouncedSearchInput,
				searchInput,
				onSearchChange: handleSearchChange,
				onSearchClear: handleSearchClear,
				onSearchClearQuery: handleSearchClearQuery,
				intelligenceOpen,
				onToggleIntelligence: handleToggleIntelligence,
			}}
		>
			{isConfigError ? (
				<div className="flex h-full items-center justify-center bg-canvas p-4">
					<ErrorState
						title="Couldn't load your account"
						error={configError}
						onRetry={() => {
							refetchConfig();
						}}
					/>
				</div>
			) : isLoading ? (
				<div className="flex h-full items-center justify-center bg-canvas">
					<span className="text-fg-muted">Loading...</span>
				</div>
			) : (
				<div className="flex h-full flex-col bg-canvas">
					{/*
					 * Desktop: the 4-pane AppShell model (#422). Pane 1 is the nav
					 * sidebar (no toolbar — nav starts at the top, its full-height
					 * right hairline anchors the datum); panes 2–4 (list, reading,
					 * intelligence) are composed by the child route via the Outlet,
					 * which renders its own nested resizable group. The nav↔content
					 * boundary is a hairline drag handle.
					 *
					 * Mobile (< md): a slim top bar with a hamburger that opens the
					 * sidebar drawer; the Outlet is the single full-screen pane.
					 *
					 * We branch with `isDesktop` (matchMedia) instead of CSS hide,
					 * because react-resizable-panels does not handle `display:none`
					 * on its panels.
					 *
					 * TODO(#422 follow-up): persist pane sizes via `autoSaveId` →
					 * user preferences (design marks this future work).
					 */}
					{isDesktop ? (
						<div className="min-h-0 flex-1">
							<ResizablePanelGroup direction="horizontal">
								<ResizablePanel
									id="nav"
									order={1}
									defaultSize={17}
									minSize={12}
									maxSize={24}
									className="min-w-0"
								>
									<MailSidebar accounts={accounts} />
								</ResizablePanel>
								<ResizableHandle />
								<ResizablePanel
									id="content"
									order={2}
									minSize={40}
									className="min-w-0"
								>
									<Outlet />
								</ResizablePanel>
							</ResizablePanelGroup>
						</div>
					) : (
						<>
							{/* Mobile top bar: hamburger + current mailbox name + a
							    search toggle. The 4-pane desktop layout moves search and
							    compose into the message toolbar; on mobile, compose stays
							    on the FAB and search expands inline here (the same
							    affordance the retired Header carried). */}
							<header className="flex h-12 shrink-0 items-center gap-2 border-b border-line bg-canvas px-2">
								<button
									type="button"
									onClick={() => setDrawerOpen(true)}
									className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-md p-2 transition-colors hover:bg-surface-raised"
									aria-label="Menu"
								>
									<Menu className="size-5" />
								</button>
								{mobileSearchOpen ? (
									<div className="flex flex-1 items-center gap-1">
										<div className="flex-1">
											<SearchBar
												value={searchInput}
												onChange={handleSearchChange}
												onClear={handleSearchClear}
												onClearQuery={handleSearchClearQuery}
											/>
										</div>
										<button
											type="button"
											onClick={() => setMobileSearchOpen(false)}
											className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-md p-2 transition-colors hover:bg-surface-raised"
											aria-label="Close search"
										>
											<X className="size-5" />
										</button>
									</div>
								) : mobileSelectedMessageId ? (
									<>
										<button
											type="button"
											onClick={handleMobileBackToInbox}
											className="inline-flex min-h-11 items-center gap-1.5 px-1 text-sm font-medium text-fg transition-colors hover:text-accent"
											aria-label="Back to inbox"
										>
											<ArrowLeft className="size-4 shrink-0" />
											<span className="truncate">{mobileTitle ?? "Inbox"}</span>
										</button>
										<div className="flex-1" />
										<AccountMenu />
									</>
								) : (
									<>
										<span className="flex-1 truncate text-sm font-semibold text-fg">
											{mobileTitle ?? "Remit"}
										</span>
										<button
											type="button"
											onClick={() => setMobileSearchOpen(true)}
											className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-md p-2 transition-colors hover:bg-surface-raised"
											aria-label="Search"
										>
											<Search className="size-5" />
										</button>
										<AccountMenu />
									</>
								)}
							</header>
							<div className="min-h-0 flex-1">
								<Outlet />
							</div>
						</>
					)}
					{/* Mobile drawer holds the sidebar */}
					<Drawer
						isOpen={drawerOpen}
						onClose={() => setDrawerOpen(false)}
						ariaLabel="Mailboxes and accounts"
					>
						<MailSidebar
							accounts={accounts}
							onMailboxSelect={handleMailboxSelect}
							variant="drawer"
						/>
					</Drawer>
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
		</MailContext.Provider>
	);
}
