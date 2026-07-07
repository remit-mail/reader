/**
 * MailNav — the nav slot for AppShellSlotted.
 *
 * Renders a single "Mailboxes" navigation landmark. The kit shows this
 * node either as a persistent pane (≥1024px) or inside its own slide-over
 * Dialog (narrow) — never both — so there is exactly one nav landmark at
 * any width. Below 1024px the slide-over also carries a Settings +
 * bug-report footer (#685), since the mobile layout has no message toolbar
 * to host them.
 */
import type { RemitImapAccountResponse } from "@remit/api-http-client/types.gen.ts";
import { useAppShellLayout } from "@remit/ui";
import { Link } from "@tanstack/react-router";
import { LogOut, Settings } from "lucide-react";
import { AccountSession } from "@/auth/AccountSession";
import { MailSidebarAdapter } from "@/components/mail/MailSidebarAdapter";
import { BugReportButton } from "@/components/ui/BugReportButton";

interface MailNavProps {
	accounts: RemitImapAccountResponse[];
	onMailboxSelect?: () => void;
}

export function MailNav({ accounts, onMailboxSelect }: MailNavProps) {
	const layout = useAppShellLayout();
	const isPane = layout?.showNavPane ?? true;

	if (isPane) {
		return <MailSidebarAdapter accounts={accounts} />;
	}

	return (
		<div className="flex h-full flex-col">
			<div className="flex-1 overflow-y-auto">
				<MailSidebarAdapter
					accounts={accounts}
					onMailboxSelect={onMailboxSelect}
					variant="drawer"
				/>
			</div>
			<div className="border-t border-line px-2 py-2">
				<Link
					to="/settings/accounts"
					onClick={onMailboxSelect}
					className="flex w-full items-center gap-2 rounded-md px-2 py-1 text-sm text-fg-muted transition-colors hover:bg-surface hover:text-fg"
				>
					<Settings className="size-4 shrink-0" />
					<span className="flex-1 truncate text-left">Settings</span>
				</Link>
				<BugReportButton variant="drawer" />
				<AccountSession>
					{({ signOut }) => (
						<button
							type="button"
							onClick={() => {
								onMailboxSelect?.();
								signOut();
							}}
							className="flex min-h-11 w-full items-center gap-2 rounded-md px-2 py-1 text-sm text-fg-muted transition-colors hover:bg-surface hover:text-fg"
							data-testid="sign-out-button"
						>
							<LogOut className="size-4 shrink-0" />
							<span className="flex-1 truncate text-left">Sign out</span>
						</button>
					)}
				</AccountSession>
			</div>
		</div>
	);
}
