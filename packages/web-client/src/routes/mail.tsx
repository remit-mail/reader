import {
	configOperationsGetConfigOptions,
	unifiedThreadOperationsListAllThreadsOptions,
} from "@remit/api-http-client/@tanstack/react-query.gen.ts";
import { useTriageKeyboard } from "@remit/ui";
import { useQuery } from "@tanstack/react-query";
import {
	createFileRoute,
	Outlet,
	useNavigate,
	useRouterState,
	useSearch,
} from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { z } from "zod";
import { useCompose } from "@/components/compose/ComposeProvider";
import { ComposeFab } from "@/components/layout/ComposeFab";
import { MailShellProvider } from "@/components/layout/MailShell";
import { MailTopBar } from "@/components/layout/MailTopBar";
import { MailNav } from "@/components/mail/MailNav";
import { ErrorState } from "@/components/ui/ErrorState";
import { KeyboardShortcutsModal } from "@/components/ui/KeyboardShortcutsModal";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { useKeyboardNavigation } from "@/hooks/useKeyboardNavigation";
import { isSinglePaneTier, useLayoutTier } from "@/hooks/useLayoutTier";
import { useMailboxNameIndex } from "@/hooks/useMailboxNameIndex";
import { useResultFolderIndex } from "@/hooks/useResultFolderIndex";
import { useStaleAccountSync } from "@/hooks/useStaleAccountSync";
import { hostsComposeSurface } from "@/lib/compose-routes";
import { writeIntelligencePref } from "@/lib/intelligence-pref";
import { MailContext } from "@/lib/mail-context";
import { MailFreshnessProvider } from "@/lib/mail-freshness";
import { mailViewKey } from "@/lib/mail-route";
import { buildAccountNameIndex } from "@/lib/search-token-index";
import { committedSearchQuery, searchInputForView } from "@/lib/search-view";
import { wizardEntryValue, wizardStepValue } from "@/lib/wizard-history";
import { useOpenPanel, useSetOpenPanel } from "@/routing";
import "@/lib/client";

// `MailContext` / `useMailContext` live in `@/lib/mail-context` so the provider
// here and the child-route consumers resolve to a single module instance — see
// that file for why the alias-vs-relative route-tree import split otherwise
// breaks context.
export { useMailContext } from "@/lib/mail-context";

const mailSearchSchema = z.object({
	q: z.string().optional(),
	// The selection wizard's step (#477 clause 1.6). The router owns history, so
	// the step is a validated search param rather than a raw pushState entry.
	wizard: wizardStepValue,
	// Which affordance opened it, so a reload lands back on the walk it was in.
	wizardFrom: wizardEntryValue,
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
	// Below the reading boundary (phone AND tablet) the shell shows a SINGLE
	// pane — there is no reading pane to host the thread or the compose surface.
	// So both tiers use the single-pane view, which swaps the pane in place
	// between list, open thread, and compose. Keying this off "phone" alone left
	// tablet with no compose surface (compose lives in the reading pane, which
	// tablet doesn't mount) — the "c" shortcut / FAB opened nothing.
	const isSinglePane = isSinglePaneTier(tier);
	// The three panels the address carries (#722): the shortcuts sheet, the nav
	// slide-over and the intelligence rail. One fragment, so one of them is up at
	// a time, and a reload or a shared link lands on the same panel.
	const openPanel = useOpenPanel();
	const setOpenPanel = useSetOpenPanel();
	const showShortcuts = openPanel === "shortcuts";
	const drawerOpen = openPanel === "nav";
	// Pane 4 / the mobile details drawer share this toggle. Nothing is open until
	// the address says so, which is what keeps the phone from slamming a
	// full-screen intelligence drawer over a freshly opened thread; the DESKTOP
	// route opens it with the thread (the intelligence rail is the product's core
	// value) and honours the persisted collapse preference there (#782).
	// DKIM-mismatch auto-open still fires on every tier. Explicit toggles persist
	// the user's choice, which is what the address is seeded from next session.
	const intelligenceOpen = openPanel === "intelligence";
	const handleSetIntelligenceOpen = useCallback(
		(open: boolean) => {
			setOpenPanel(open ? "intelligence" : undefined);
			writeIntelligencePref(open);
		},
		[setOpenPanel],
	);

	// Within one view, URL `q` seeds the input and is a one-directional write
	// target: the debounced local value drives the search API and is mirrored
	// back by the list route's own `useSearchMirror`. Across views the URL wins
	// again — see the view-change adjustment below and `lib/search-view.ts` (#47).
	const [searchInput, setSearchInput] = useState(searchQuery);
	const debouncedSearchInput = useDebouncedValue(searchInput, 200);
	const committedQuery = committedSearchQuery(
		searchInput,
		debouncedSearchInput,
	);

	// Search is a mode of the view it was typed in, so leaving that view re-seeds
	// the field from wherever we land (#47): empty when the sidebar dropped `q`
	// (a folder switch starts that folder's search fresh), and the carried query
	// when the top bar's scope chip was removed and sent the user to the brief to
	// search everything. Views that differ only in what is open below the list —
	// a thread, a mirrored `q` — are the same view, so in-flight typing survives
	// them (`searchInputForView`, `mailViewKey`).
	//
	// Adjusted during render, not in an effect. This is React's documented
	// "adjusting state when a prop changes" pattern: both updates are to this
	// component's own state and are guarded by a changed value, so React re-runs
	// the render before committing and nothing is painted with the stale query.
	// An effect would commit one frame carrying the previous view's text, which
	// the mirror then has to be defended against.
	const pathname = useRouterState({ select: (s) => s.location.pathname });
	const viewKey = useRouterState({ select: (s) => mailViewKey(s.matches) });
	const [searchViewKey, setSearchViewKey] = useState(viewKey);
	if (searchViewKey !== viewKey) {
		const seeded = searchInputForView(searchViewKey, viewKey, searchQuery);
		setSearchViewKey(viewKey);
		if (seeded !== undefined) setSearchInput(seeded);
	}

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
				handler: () => setOpenPanel("shortcuts"),
				noModifiers: false, // Allow shift+/
				preventDefault: true,
			},
		],
	});

	// `c` / ⌘N off the mailbox routes — the brief, Flagged, the outbox. On a
	// mailbox the pane's own triage layer owns the key, so this is disabled there
	// rather than firing a second compose alongside it.
	const { openCompose } = useCompose();
	const composeHandlers = useMemo(
		() => ({ compose: () => openCompose({ mode: "new" }) }),
		[openCompose],
	);
	useTriageKeyboard({
		enabled: !hostsComposeSurface(pathname),
		handlers: composeHandlers,
	});

	const handleSearchChange = useCallback((query: string) => {
		setSearchInput(query);
	}, []);

	// Clears the search field; the list route's mirror drops `q` from the URL
	// after the debounce settles.
	const handleSearchClear = useCallback(() => {
		setSearchInput("");
	}, []);

	// Esc inside the search field clears only the query (#489).
	const handleSearchClearQuery = useCallback(() => {
		setSearchInput("");
	}, []);

	const handleToggleIntelligence = useCallback(() => {
		handleSetIntelligenceOpen(!intelligenceOpen);
	}, [handleSetIntelligenceOpen, intelligenceOpen]);

	const accounts = config?.accounts ?? [];
	const accountIds = useMemo(
		() => accounts.map((account) => account.accountId),
		[accounts],
	);
	const mailboxNameIndex = useMailboxNameIndex(accounts);
	const resultFolderIndex = useResultFolderIndex(accounts);
	const accountNameIndex = useMemo(
		() => buildAccountNameIndex(accounts),
		[accounts],
	);

	// Auto-trigger a mailbox-list sync for any account whose lastSyncAt is
	// older than 15 minutes (or unset). Fires once per accountId per session
	// — re-mounts of MailLayout will not retrigger. See #205.
	useStaleAccountSync(accounts);

	const handleMailboxSelect = useCallback(() => {
		// Auto-collapse the mobile drawer after the user picks an inbox from the
		// sidebar (#199). Above the slide-over the sidebar is a pane, and the panel
		// the address is carrying there belongs to something else.
		if (openPanel !== "nav") return;
		setOpenPanel(undefined);
	}, [openPanel, setOpenPanel]);

	const mailContextValue = {
		accounts,
		mailboxNameIndex,
		accountNameIndex,
		resultFolderIndex,
		// The committed local value is the source of truth for search; it is
		// mirrored to the URL for shareable links.
		searchQuery: committedQuery,
		searchInput,
		searchViewKey: viewKey,
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
	const shellChrome = {
		isSinglePane,
		isLoading: isLoading || hasNoAccounts,
		intelligenceOpen,
		nav: <MailNav accounts={accounts} onMailboxSelect={handleMailboxSelect} />,
		// Desktop only. Below 1024px the single pane keeps its own header search
		// and the phone takeover; there is no room for a bar spanning panes that do
		// not exist side by side.
		topBar: isSinglePane ? undefined : <MailTopBar accounts={accounts} />,
		// Single-pane only, where the FAB is the compose entry point. Above it the
		// top bar owns compose.
		overlay: isSinglePane ? <ComposeFab /> : undefined,
		navOpen: drawerOpen,
		onOpenNav: () => setOpenPanel("nav"),
		onCloseNav: () => setOpenPanel(undefined),
	};

	return (
		<MailContext.Provider value={mailContextValue}>
			<MailFreshnessProvider accountIds={accountIds}>
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
				) : (
					// Each list route mounts its own shell around its own panes.
					<MailShellProvider chrome={shellChrome}>
						<Outlet />
					</MailShellProvider>
				)}
				<KeyboardShortcutsModal
					isOpen={showShortcuts}
					onClose={() => setOpenPanel(undefined)}
				/>
			</MailFreshnessProvider>
		</MailContext.Provider>
	);
}
