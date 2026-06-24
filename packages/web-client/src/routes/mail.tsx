import {
	configOperationsGetConfigOptions,
	unifiedThreadOperationsListAllThreadsOptions,
} from "@remit/api-http-client/@tanstack/react-query.gen.ts";
import { AppShellSlotted } from "@remit/ui";
import { useQuery } from "@tanstack/react-query";
import {
	createFileRoute,
	Outlet,
	useNavigate,
	useRouterState,
	useSearch,
} from "@tanstack/react-router";
import { Menu, Search, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { z } from "zod";
import { AccountMenu } from "@/auth/AccountMenu";
import { AppShellSkeleton } from "@/components/layout/AppShellSkeleton";
import { ComposeFab } from "@/components/layout/ComposeFab";
import { SearchBar } from "@/components/layout/SearchBar";
import { BriefPane } from "@/components/mail/BriefPane";
import { MailboxPane } from "@/components/mail/MailboxPane";
import { MailNav } from "@/components/mail/MailNav";
import { ErrorState } from "@/components/ui/ErrorState";
import { KeyboardShortcutsModal } from "@/components/ui/KeyboardShortcutsModal";
import { useCurrentMailboxName } from "@/hooks/useCurrentMailboxName";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { useKeyboardNavigation } from "@/hooks/useKeyboardNavigation";
import { isSinglePaneTier, useLayoutTier } from "@/hooks/useLayoutTier";
import { useStaleAccountSync } from "@/hooks/useStaleAccountSync";
import { writeIntelligencePref } from "@/lib/intelligence-pref";
import { MailContext } from "@/lib/mail-context";
import { isBriefRoute, isOutboxRoute } from "@/lib/mail-route";
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
	// Kick off config and the cross-account thread list together, without
	// awaiting either — the route paints its skeleton shell immediately and the
	// queries resolve in parallel rather than serialized behind config. The
	// zero-account onboarding redirect moved into the component (see
	// MailLayout), so a cold load no longer blocks first paint on the network.
	loader: ({ context: { queryClient } }) => {
		void queryClient.prefetchQuery(configOperationsGetConfigOptions());
		void queryClient.prefetchQuery({
			...unifiedThreadOperationsListAllThreadsOptions(),
			staleTime: 60_000,
		});
	},
	component: MailLayout,
	validateSearch: mailSearchSchema,
});

function MailLayout() {
	const { q: searchQuery = "" } = useSearch({ from: "/mail" });
	const navigate = useNavigate();
	const tier = useLayoutTier();
	const isPhone = tier === "phone";
	// Below the reading boundary (phone AND tablet) AppShellSlotted shows a
	// SINGLE pane — there is no reading pane to host the thread or the compose
	// surface. So both tiers use the single-pane view, which swaps the pane in
	// place between list, open thread, and compose. Keying this off "phone"
	// alone left tablet with no compose surface (compose lives in the reading
	// pane, which tablet doesn't mount) — the "c" shortcut / FAB opened nothing.
	const isSinglePane = isSinglePaneTier(tier);
	const [showShortcuts, setShowShortcuts] = useState(false);
	const [drawerOpen, setDrawerOpen] = useState(false);
	// Narrow layout: the top bar's search toggle expands an inline SearchBar
	// (same affordance the retired Header carried, preserved so mobile search
	// doesn't regress — the wide desktop layout puts search in the toolbar).
	const [mobileSearchOpen, setMobileSearchOpen] = useState(false);
	// Pane 4 / the mobile details drawer share this toggle. It starts closed so
	// the phone never slams a full-screen intelligence drawer over a freshly
	// opened thread; the DESKTOP route opens it by default with the thread (the
	// intelligence rail is the product's core value) and honours the persisted
	// collapse preference there (#782). DKIM-mismatch auto-open still fires on
	// every tier. Explicit toggles persist the user's choice.
	const [intelligenceOpen, setIntelligenceOpen] = useState(false);
	const handleSetIntelligenceOpen = useCallback((open: boolean) => {
		setIntelligenceOpen(open);
		writeIntelligencePref(open);
	}, []);

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

	// First-run guard: a zero-account user goes to the onboarding wizard. This
	// lives here (not a blocking beforeLoad) so a cold load paints the skeleton
	// shell immediately; the redirect fires once config arrives. It guards the
	// /mail parent so it holds for every child route — index redirect, daily
	// brief (#426/#484), etc.
	const hasNoAccounts = Boolean(config && (config.accounts?.length ?? 0) === 0);
	useEffect(() => {
		if (!hasNoAccounts) return;
		navigate({ to: "/onboarding", replace: true });
	}, [hasNoAccounts, navigate]);

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
		setIntelligenceOpen((open) => {
			const next = !open;
			writeIntelligencePref(next);
			return next;
		});
	}, []);

	const accounts = config?.accounts ?? [];
	const mobileTitle = useCurrentMailboxName({ accounts });

	// Read the current mailbox params and selected message (if any) from the
	// child route so the narrow top-bar title can act as a back button when a
	// thread is open.
	//
	// `useParams({ strict: false })` resolves against the *nearest* route match
	// in the React component tree — which for this parent layout is /mail (no
	// path params). The child's $mailboxId param never appears there, so
	// mobileMailboxId would always be undefined and the navigate guard would
	// short-circuit every tap. Use `useRouterState` instead: it exposes all
	// currently matched routes, letting us find the one that carries mailboxId.
	const mobileMailboxId = useRouterState({
		select: (s) => {
			const match = s.matches.find(
				(m): m is typeof m & { params: { mailboxId: string } } =>
					"mailboxId" in m.params,
			);
			return match?.params.mailboxId;
		},
	});
	const { selectedMessageId: mobileSelectedMessageId } = useSearch({
		strict: false,
	}) as { selectedMessageId?: string };

	// Detect which leaf route is active by its own routeId — never the parent
	// /mail layout's pathname (which is "/mail" on EVERY child route and would
	// wrongly route every mailbox through the brief pane, dropping message rows).
	// See lib/mail-route.ts for the contract + regression test.
	const onBriefRoute = useRouterState({
		select: (s) => isBriefRoute(s.matches),
	});
	const onOutboxRoute = useRouterState({
		select: (s) => isOutboxRoute(s.matches),
	});

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

	const mailContextValue = {
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
		onSetIntelligenceOpen: handleSetIntelligenceOpen,
	};

	// Mobile header: shown only on narrow widths by AppShellSlotted.
	const mobileHeader = (
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
			) : isPhone && mobileSelectedMessageId ? (
				<>
					<button
						type="button"
						onClick={() => {
							if (!mobileMailboxId) return;
							navigate({
								to: "/mail/$mailboxId",
								params: { mailboxId: mobileMailboxId },
								search: (prev: Record<string, unknown>) => ({
									...prev,
									selectedMessageId: undefined,
								}),
							});
						}}
						className="inline-flex min-h-11 items-center gap-1.5 px-1 text-sm font-medium text-fg transition-colors hover:text-accent"
						aria-label="Back to inbox"
					>
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
	);

	// Single nav node: the kit renders it as a pane (≥1024px) or inside its
	// own slide-over Dialog (narrow), never both — so there is exactly one
	// "Mailboxes" nav landmark at any width. `MailNav` adds the mobile
	// Settings + bug-report footer when it detects the slide-over context.
	const navContent = (
		<MailNav accounts={accounts} onMailboxSelect={handleMailboxSelect} />
	);
	const overlayContent = <ComposeFab />;
	const navSlideOver = {
		navOpen: drawerOpen,
		onOpenNav: () => setDrawerOpen(true),
		onCloseNav: () => setDrawerOpen(false),
	};

	return (
		<MailContext.Provider value={mailContextValue}>
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
			) : onBriefRoute ? (
				// Daily brief (/mail/) — no mailboxId param; 2-pane layout (no intelligence).
				<BriefPane selectedMessageId={mobileSelectedMessageId}>
					{isSinglePane ? (
						<AppShellSlotted
							nav={navContent}
							list={<BriefPane.Phone />}
							intelligenceOpen={intelligenceOpen}
							header={mobileHeader}
							overlay={overlayContent}
							skeleton={<AppShellSkeleton />}
							isLoading={isLoading || hasNoAccounts}
							{...navSlideOver}
						/>
					) : (
						<AppShellSlotted
							nav={navContent}
							list={<BriefPane.List />}
							reading={<BriefPane.Reading />}
							intelligenceOpen={intelligenceOpen}
							header={mobileHeader}
							overlay={overlayContent}
							skeleton={<AppShellSkeleton />}
							isLoading={isLoading || hasNoAccounts}
							{...navSlideOver}
						/>
					)}
				</BriefPane>
			) : mobileMailboxId ? (
				// Mailbox view (/mail/$mailboxId) — full 4-pane layout.
				<MailboxPane
					mailboxId={mobileMailboxId}
					selectedMessageId={mobileSelectedMessageId}
				>
					{isSinglePane ? (
						<AppShellSlotted
							nav={navContent}
							list={<MailboxPane.Phone />}
							intelligenceOpen={intelligenceOpen}
							header={mobileHeader}
							overlay={overlayContent}
							skeleton={<AppShellSkeleton />}
							isLoading={isLoading || hasNoAccounts}
							{...navSlideOver}
						/>
					) : (
						<AppShellSlotted
							nav={navContent}
							list={<MailboxPane.List />}
							reading={<MailboxPane.Reading />}
							intelligence={<MailboxPane.Intelligence />}
							intelligenceOpen={intelligenceOpen}
							header={mobileHeader}
							overlay={overlayContent}
							skeleton={<AppShellSkeleton />}
							isLoading={isLoading || hasNoAccounts}
							{...navSlideOver}
						/>
					)}
				</MailboxPane>
			) : onOutboxRoute ? (
				// Outbox has its own inline layout — render it via <Outlet />.
				<AppShellSlotted
					nav={navContent}
					list={<Outlet />}
					intelligenceOpen={false}
					header={mobileHeader}
					overlay={overlayContent}
					skeleton={<AppShellSkeleton />}
					isLoading={isLoading || hasNoAccounts}
					{...navSlideOver}
				/>
			) : (
				// Fallback: transitioning or unrecognized route — show skeleton.
				<AppShellSkeleton />
			)}
			<KeyboardShortcutsModal
				isOpen={showShortcuts}
				onClose={() => setShowShortcuts(false)}
			/>
			{/* Outlet is required for TanStack Router to activate child routes.
			    Routes that manage their own rendering (brief, mailbox) return null
			    from their component. Routes with inline layouts (outbox) render via
			    the onOutboxRoute branch above which passes <Outlet /> as the list slot. */}
			{!onOutboxRoute && <Outlet />}
		</MailContext.Provider>
	);
}
