import { Avatar } from "@remit/ui";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { LogOut, Settings } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

/**
 * AccountMenu — the top-right avatar button that opens a dropdown with the
 * signed-in email, a Settings link, and Sign out. In the live app this
 * component gates on Cognito being configured and reads from `useAuthenticator`.
 * The story renders the presentational shell directly with a fixture email.
 */

const FIXTURE_EMAIL = "info@example.com";

function DropdownShell({
	trigger,
	children,
}: {
	trigger: React.ReactNode;
	children: React.ReactNode;
}) {
	const [open, setOpen] = useState(false);
	const ref = useRef<HTMLDivElement>(null);

	const close = useCallback(() => setOpen(false), []);

	useEffect(() => {
		if (!open) return;
		const onKey = (e: KeyboardEvent) => {
			if (e.key === "Escape") close();
		};
		const onMouse = (e: MouseEvent) => {
			if (ref.current && !ref.current.contains(e.target as Node)) close();
		};
		document.addEventListener("keydown", onKey);
		document.addEventListener("mousedown", onMouse);
		return () => {
			document.removeEventListener("keydown", onKey);
			document.removeEventListener("mousedown", onMouse);
		};
	}, [open, close]);

	return (
		<div ref={ref} className="relative">
			<button
				type="button"
				onClick={() => setOpen((v) => !v)}
				className="p-1.5 min-h-11 min-w-11 inline-flex items-center justify-center rounded-md transition-colors hover:bg-surface-raised text-fg-muted hover:text-fg"
			>
				{trigger}
			</button>
			{open && (
				<div className="absolute right-0 z-50 mt-1 min-w-[180px] py-1 bg-surface border border-line rounded-md shadow-lg">
					{children}
				</div>
			)}
		</div>
	);
}

function MenuItem({
	onClick,
	children,
}: {
	onClick: () => void;
	children: React.ReactNode;
}) {
	return (
		<button
			type="button"
			onClick={onClick}
			className="w-full px-3 py-2 text-left text-sm flex items-center gap-2 hover:bg-surface-raised transition-colors"
		>
			{children}
		</button>
	);
}

function Separator() {
	return <div className="my-1 h-px bg-line" />;
}

function AccountMenuDemo() {
	return (
		<DropdownShell
			trigger={<Avatar name={FIXTURE_EMAIL} email={FIXTURE_EMAIL} size="sm" />}
		>
			<div
				className="px-3 py-2 text-xs text-fg-muted truncate"
				title={FIXTURE_EMAIL}
			>
				{FIXTURE_EMAIL}
			</div>
			<Separator />
			<MenuItem onClick={() => {}}>
				<Settings className="size-4" />
				Settings
			</MenuItem>
			<Separator />
			<MenuItem onClick={() => {}}>
				<LogOut className="size-4" />
				Sign out
			</MenuItem>
		</DropdownShell>
	);
}

const meta: Meta = {
	title: "Components/AccountMenu",
	parameters: { layout: "padded" },
};
export default meta;

type Story = StoryObj;

/** Avatar button — click to open the account dropdown. */
export const Default: Story = {
	render: () => (
		<div className="flex justify-end p-4">
			<AccountMenuDemo />
		</div>
	),
};

/** As it appears in the MessageToolbar — inline at the far right. */
export const InToolbarContext: Story = {
	render: () => (
		<header className="flex h-pane-header shrink-0 items-center gap-1 border-b border-line bg-surface px-3">
			<div className="flex-1" />
			<AccountMenuDemo />
		</header>
	),
};
