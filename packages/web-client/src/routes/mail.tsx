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
import { Header } from "@/components/layout/Header";
import { Panel } from "@/components/layout/Panel";
import { MailSidebar } from "@/components/mail/MailSidebar";
import { KeyboardShortcutsModal } from "@/components/ui/KeyboardShortcutsModal";
import { useKeyboardNavigation } from "@/hooks/useKeyboardNavigation";
import "@/lib/client";

const mailSearchSchema = z.object({
	q: z.string().optional(),
});

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
	const [showShortcuts, setShowShortcuts] = useState(false);

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
				search: (prev) => ({ ...prev, q: query || undefined }),
				replace: true,
			});
		},
		[navigate],
	);

	const handleSearchClear = useCallback(() => {
		navigate({
			to: ".",
			search: (prev) => ({ ...prev, q: undefined }),
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
					/>
					<div className="flex flex-1 overflow-hidden">
						<Panel className="w-[220px] shrink-0">
							<MailSidebar accounts={accounts} />
						</Panel>
						<Outlet />
					</div>
				</div>
			)}
			<KeyboardShortcutsModal
				isOpen={showShortcuts}
				onClose={() => setShowShortcuts(false)}
			/>
		</MailContext.Provider>
	);
}
