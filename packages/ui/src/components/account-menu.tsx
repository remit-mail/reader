import { LogOut } from "lucide-react";
import { useEffect, useRef } from "react";
import { Avatar } from "./avatar.js";
import {
	PopoverMenuPanel,
	PopoverMenuPortal,
	PopoverMenuRow,
	usePopoverMenuState,
} from "./popover-menu.js";

export interface AccountMenuProps {
	email: string | null;
	onSignOut: () => void;
}

export function AccountMenu({ email, onSignOut }: AccountMenuProps) {
	const triggerRef = useRef<HTMLButtonElement>(null);
	const { open, setOpen, containerRef, panelRef, getAnchor } =
		usePopoverMenuState("account-menu", () => triggerRef.current?.focus());

	useEffect(() => {
		if (!open) return;
		const frame = requestAnimationFrame(() =>
			panelRef.current
				?.querySelector<HTMLElement>('[role="menuitem"]')
				?.focus(),
		);
		return () => cancelAnimationFrame(frame);
	}, [open, panelRef]);

	const displayName = email ?? "Account";

	return (
		<div ref={containerRef} className="relative">
			<button
				ref={triggerRef}
				type="button"
				aria-label="Account"
				aria-haspopup="menu"
				aria-expanded={open}
				onClick={() => setOpen((value) => !value)}
				className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-md p-1.5 text-fg-muted transition-colors hover:bg-surface-raised hover:text-fg"
			>
				<Avatar name={displayName} email={email ?? undefined} size="sm" />
			</button>
			<PopoverMenuPortal
				open={open}
				align="end"
				panelRef={panelRef}
				getAnchor={getAnchor}
			>
				<PopoverMenuPanel ref={panelRef} label={displayName}>
					{email && (
						<>
							<div
								className="truncate px-4 py-2 text-xs text-fg-muted"
								title={email}
								data-testid="account-menu-email"
							>
								{email}
							</div>
							<hr className="my-1 h-px border-0 bg-line" />
						</>
					)}
					<PopoverMenuRow
						label="Sign out"
						icon={<LogOut className="size-4" />}
						onSelect={() => {
							setOpen(false);
							triggerRef.current?.focus();
							onSignOut();
						}}
					/>
				</PopoverMenuPanel>
			</PopoverMenuPortal>
		</div>
	);
}
