import { LogOut } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useOverlayScope } from "../lib/overlay-scope.js";
import { Avatar } from "./avatar.js";
import {
	PopoverMenuPanel,
	PopoverMenuPortal,
	PopoverMenuRow,
} from "./popover-menu.js";

export interface AccountMenuProps {
	email: string | null;
	onSignOut: () => void;
}

export function AccountMenu({ email, onSignOut }: AccountMenuProps) {
	const [open, setOpen] = useState(false);
	const containerRef = useRef<HTMLDivElement>(null);
	const panelRef = useRef<HTMLDivElement>(null);

	useOverlayScope({
		id: "account-menu",
		open,
		answers: { back: () => setOpen(false) },
	});

	useEffect(() => {
		if (!open) return;
		const onPointer = (event: MouseEvent) => {
			const target = event.target as Node;
			if (
				containerRef.current?.contains(target) ||
				panelRef.current?.contains(target)
			)
				return;
			setOpen(false);
		};
		document.addEventListener("mousedown", onPointer);
		return () => document.removeEventListener("mousedown", onPointer);
	}, [open]);

	const displayName = email ?? "Account";

	return (
		<div ref={containerRef} className="relative">
			<button
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
				getAnchor={() => containerRef.current?.getBoundingClientRect() ?? null}
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
							onSignOut();
						}}
					/>
				</PopoverMenuPanel>
			</PopoverMenuPortal>
		</div>
	);
}
