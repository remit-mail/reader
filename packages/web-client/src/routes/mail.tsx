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
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { z } from "zod";
import { AppShellSkeleton } from "@/components/layout/AppShellSkeleton";
import { ComposeFab } from "@/components/layout/ComposeFab";
import { MailTopBar } from "@/components/layout/MailTopBar";
import { BriefPane } from "@/components/mail/BriefPane";
import { FlaggedPane } from "@/components/mail/FlaggedPane";
import { MailboxPane } from "@/components/mail/MailboxPane";
import { MailNav } from "@/components/mail/MailNav";
import { OutboxPane } from "@/components/mail/OutboxPane";
import { ErrorState } from "@/components/ui/ErrorState";
import { KeyboardShortcutsModal } from "@/components/ui/KeyboardShortcutsModal";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { useKeyboardNavigation } from "@/hooks/useKeyboardNavigation";
import { isSinglePaneTier, useLayoutTier } from "@/hooks/useLayoutTier";
import { useMailboxNameIndex } from "@/hooks/useMailboxNameIndex";
import { useStaleAccountSync } from "@/hooks/useStaleAccountSync";
import { writeIntelligencePref } from "@/lib/intelligence-pref";
import { MailContext } from "@/lib/mail-context";
import { isBriefRoute, isFlaggedRoute, isOutboxRoute } from "@/lib/mail-route";
import { buildAccountNameIndex } from "@/lib/search-token-index";
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
	// Below the reading boundary (phone AND tablet) AppShellSlotted shows a
	// SINGLE pane — there is no reading pane to host the thread or the compose
	// surface. So both tiers use the single-pane view, which swaps the pane in
	// place between list, open thread, and compose. Keying this off "phone"
	// alone left tablet with no compose surface (compose lives in the reading
	// pane, which tablet doesn't mount) — the "c" shortcut / FAB opened nothing.
	const isSinglePane = isSinglePaneTier(tier);
	const [showShortcuts, setShowShortcuts] = useState(false);
	const [drawerOpen, setDrawerOpen] = useState(false);
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
	// state after mount — with one exception below, navigation.
	const [searchInput, setSearchInput] = useState(searchQuery);
	const debouncedSearchInput = useDebouncedValue(searchInput, 200);

	const searchQueryRef = useRef(searchQuery);
	searchQueryRef.current = searchQuery;

	// Navigating re-scopes the search, so the field takes the destination's
	// own `q`: empty when the sidebar dropped it (a folder switch starts that
	// folder's search fresh), and the carried query when the top bar's scope
	// chip was removed and sent the user to the brief to search everything.
	// Without this the field kept text the URL no longer had, so the chip said
	// one scope and the words came from another.
	const pathname = useRouterState({ select: (s) => s.location.pathname });
	const [searchPathname, setSearchPathname] = useState(pathname);
	if (searchPathname !== pathname) {
		setSearchPathname(pathname);
		setSearchInput(searchQuery);
	}

	// Mirror the debounced search into the URL so links are shareable and a
	// refresh restores the query. One-directional: the URL is never read back
	// into state, so there is no sync loop.
	// When a query *goes* active, also strip selectedMessageId so the reading
	// pane closes (#539): an open message from the pre-search list is not
	// meaningful in the search result set. Only strip on that transition though —
	// tapping a search result commits the same `q` with the selection, so when
	// `prev.q` already equals the query the result was opened under it (not a
	// pre-search leftover) and must survive. The strip otherwise raced the tap:
	// the row shows before the debounce settles, so this mirror can land just
	// after the open and close it again.
	// The debounce lags a navigation by up to 200ms, so on the render right
	// after a route change it still holds the previous route's query. Writing
	// that would put the old query back on the new URL — and, when the scope
	// chip cleared it, undo the clear. Skip one pass and let the debounce catch
	// up; the effect re-runs when it does.
	const mirroredPathnameRef = useRef(pathname);
	useEffect(() => {
		if (mirroredPathnameRef.current !== pathname) {
			mirroredPathnameRef.current = pathname;
			return;
		}
		if (debouncedSearchInput === searchQueryRef.current) return;
		navigate({
			to: ".",
			search: (prev) => {
				const queryAlreadyActive =
					(prev as { q?: string }).q === debouncedSearchInput;
				return {
					...prev,
					q: debouncedSearchInput || undefined,
					...(debouncedSearchInput && !queryAlreadyActive
						? {
								selectedMessageId: undefined,
								selectedThreadId: undefined,
								selectedMailboxId: undefined,
							}
						: {}),
				};
			},
			replace: true,
		});
	}, [debouncedSearchInput, pathname, navigate]);

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
	const mailboxNameIndex = useMailboxNameIndex(accounts);
	const accountNameIndex = useMemo(
		() => buildAccountNameIndex(accounts),
		[accounts],
	);

	// Read the current mailbox params and selected message (if any) from the
	// child route so the parent shell can mount the right pane (brief / mailbox /
	// outbox) and forward the open thread into it.
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
	const onFlaggedRoute = useRouterState({
		select: (s) => isFlaggedRoute(s.matches),
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
		mailboxNameIndex,
		accountNameIndex,
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

	// Single nav node: the kit renders it as a pane (≥1024px) or inside its
	// own slide-over Dialog (narrow), never both — so there is exactly one
	// "Mailboxes" nav landmark at any width. `MailNav` adds the mobile
	// Settings + bug-report footer when it detects the slide-over context.
	const navContent = (
		<MailNav accounts={accounts} onMailboxSelect={handleMailboxSelect} />
	);
	// Single-pane only, where the FAB is the compose entry point. Above it the
	// top bar owns compose, and mounting the FAB there would resolve the same
	// compose target twice for a button CSS keeps hidden.
	const overlayContent = isSinglePane ? (
		<ComposeFab accounts={accounts} />
	) : undefined;
	// Desktop only. Below 1024px the single pane keeps its own header search and
	// the phone takeover; there is no room for a bar spanning panes that do not
	// exist side by side.
	const topBar = isSinglePane ? undefined : <MailTopBar accounts={accounts} />;
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
							overlay={overlayContent}
							skeleton={<AppShellSkeleton />}
							isLoading={isLoading || hasNoAccounts}
							{...navSlideOver}
						/>
					) : (
						<AppShellSlotted
							nav={navContent}
							topBar={topBar}
							list={<BriefPane.List />}
							reading={<BriefPane.Reading />}
							intelligenceOpen={intelligenceOpen}
							overlay={overlayContent}
							skeleton={<AppShellSkeleton />}
							isLoading={isLoading || hasNoAccounts}
							{...navSlideOver}
						/>
					)}
				</BriefPane>
			) : onFlaggedRoute ? (
				// Flagged virtual mailbox (/mail/flagged) — flat starred list across
				// accounts; 2-pane layout (no intelligence), like the brief.
				<FlaggedPane selectedMessageId={mobileSelectedMessageId}>
					{isSinglePane ? (
						<AppShellSlotted
							nav={navContent}
							list={<FlaggedPane.Phone />}
							intelligenceOpen={intelligenceOpen}
							overlay={overlayContent}
							skeleton={<AppShellSkeleton />}
							isLoading={isLoading || hasNoAccounts}
							{...navSlideOver}
						/>
					) : (
						<AppShellSlotted
							nav={navContent}
							topBar={topBar}
							list={<FlaggedPane.List />}
							reading={<FlaggedPane.Reading />}
							intelligenceOpen={intelligenceOpen}
							overlay={overlayContent}
							skeleton={<AppShellSkeleton />}
							isLoading={isLoading || hasNoAccounts}
							{...navSlideOver}
						/>
					)}
				</FlaggedPane>
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
							overlay={overlayContent}
							skeleton={<AppShellSkeleton />}
							isLoading={isLoading || hasNoAccounts}
							{...navSlideOver}
						/>
					) : (
						<AppShellSlotted
							nav={navContent}
							topBar={topBar}
							list={<MailboxPane.List />}
							reading={<MailboxPane.Reading />}
							intelligence={<MailboxPane.Intelligence />}
							intelligenceOpen={intelligenceOpen}
							overlay={overlayContent}
							skeleton={<AppShellSkeleton />}
							isLoading={isLoading || hasNoAccounts}
							{...navSlideOver}
						/>
					)}
				</MailboxPane>
			) : onOutboxRoute ? (
				// Outbox — 2-pane layout (list + reading, no intelligence).
				<OutboxPane>
					{isSinglePane ? (
						<AppShellSlotted
							nav={navContent}
							list={<OutboxPane.Phone />}
							intelligenceOpen={false}
							overlay={overlayContent}
							skeleton={<AppShellSkeleton />}
							isLoading={isLoading || hasNoAccounts}
							{...navSlideOver}
						/>
					) : (
						<AppShellSlotted
							nav={navContent}
							topBar={topBar}
							list={<OutboxPane.List />}
							reading={<OutboxPane.Reading />}
							intelligenceOpen={false}
							overlay={overlayContent}
							skeleton={<AppShellSkeleton />}
							isLoading={isLoading || hasNoAccounts}
							{...navSlideOver}
						/>
					)}
				</OutboxPane>
			) : (
				// Fallback: transitioning or unrecognized route — show skeleton.
				<AppShellSkeleton />
			)}
			<KeyboardShortcutsModal
				isOpen={showShortcuts}
				onClose={() => setShowShortcuts(false)}
			/>
			{/* Outlet is required for TanStack Router to activate child routes.
			    Routes that manage their own rendering (brief, mailbox, outbox) return
			    null from their component — the parent shell owns the layout. */}
			<Outlet />
		</MailContext.Provider>
	);
}
