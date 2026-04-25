import { configOperationsGetConfigOptions } from "@remit/api-http-client/@tanstack/react-query.gen.ts";
import type { RemitImapAccountResponse } from "@remit/api-http-client/types.gen.ts";
import { useQuery } from "@tanstack/react-query";
import {
	createFileRoute,
	Outlet,
	useNavigate,
	useSearch,
} from "@tanstack/react-router";
import { createContext, useCallback, useContext, useState } from "react";
import { z } from "zod";
import { BottomNav } from "@/components/layout/BottomNav";
import { Drawer } from "@/components/layout/Drawer";
import { Header } from "@/components/layout/Header";
import { Panel } from "@/components/layout/Panel";
import {
	ResizableHandle,
	ResizablePanel,
	ResizablePanelGroup,
} from "@/components/layout/Resizable";
import { MailSidebar } from "@/components/mail/MailSidebar";
import { KeyboardShortcutsModal } from "@/components/ui/KeyboardShortcutsModal";
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

	const { data: config, isLoading } = useQuery(
		configOperationsGetConfigOptions(),
	);

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

	const handleSearchChange = useCallback(
		(query: string) => {
			navigate({
				to: ".",
				search: (prev: MailSearch) => ({ ...prev, q: query || undefined }),
				replace: true,
			});
		},
		[navigate],
	);

	const handleSearchClear = useCallback(() => {
		navigate({
			to: ".",
			search: (prev: MailSearch) => ({ ...prev, q: undefined }),
			replace: true,
		});
	}, [navigate]);

	const accounts = config?.accounts ?? [];

	return (
		<MailContext.Provider value={{ accounts, searchQuery }}>
			{isLoading ? (
				<div className="flex h-full items-center justify-center bg-background">
					<span className="text-muted-foreground">Loading...</span>
				</div>
			) : (
				<div className="flex flex-col h-full bg-background">
					<Header
						searchQuery={searchQuery}
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
							<ResizablePanelGroup direction="horizontal" className="h-full">
								<ResizablePanel defaultSize={15} minSize={10}>
									<Panel className="h-full">
										<MailSidebar accounts={accounts} />
									</Panel>
								</ResizablePanel>
								<ResizableHandle />
								<ResizablePanel defaultSize={85} minSize={30}>
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
					{/* Bottom nav (mobile only). PR-B will hide this when a
					    thread is full-screen by routing-aware logic. */}
					<BottomNav />
				</div>
			)}
			<KeyboardShortcutsModal
				isOpen={showShortcuts}
				onClose={() => setShowShortcuts(false)}
			/>
		</MailContext.Provider>
	);
}
