import { Avatar } from "@remit/ui";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { FileText, Inbox } from "lucide-react";

/**
 * Design source for the segmented Drafts view (#788): Remit drafts not yet sent
 * sit above the IMAP \Drafts already on the server, each under a labeled
 * section header. Mirrors `DraftsView.tsx`.
 */

const meta: Meta = {
	title: "Flows/Drafts",
	parameters: { layout: "fullscreen" },
};
export default meta;

type Story = StoryObj;

function SectionHeader({
	icon,
	label,
	count,
}: {
	icon: React.ReactNode;
	label: string;
	count: number;
}) {
	return (
		<div className="sticky top-0 flex h-section-row items-center gap-1.5 border-b border-line bg-surface-sunken px-row-inset">
			<span className="text-fg-subtle">{icon}</span>
			<span className="flex-1 text-2xs font-semibold uppercase tracking-wider text-fg-subtle">
				{label}
			</span>
			<span className="text-2xs tabular-nums text-fg-subtle">{count}</span>
		</div>
	);
}

function DraftRow({
	to,
	subject,
	snippet,
}: {
	to: string;
	subject: string;
	snippet: string;
}) {
	return (
		<button
			type="button"
			className="flex w-full items-start gap-3 border-b border-line px-row-inset py-2 text-left hover:bg-surface-sunken"
		>
			<Avatar name={to} email={`${to}@example.com`} size="sm" />
			<div className="min-w-0 flex-1">
				<div className="truncate text-sm font-medium text-fg">
					{subject || "No subject"}
				</div>
				<div className="truncate text-xs text-fg-subtle">{snippet}</div>
			</div>
		</button>
	);
}

export const Segmented: Story = {
	render: () => (
		<div className="flex h-dvh w-full flex-col bg-surface">
			<header className="flex h-pane-header shrink-0 items-center border-b border-line px-row-inset">
				<h1 className="text-sm font-semibold text-fg">Drafts</h1>
			</header>
			<div className="min-h-0 flex-1 overflow-y-auto">
				<SectionHeader
					icon={<FileText className="size-3" />}
					label="Not yet sent (Remit)"
					count={2}
				/>
				<DraftRow
					to="Ada"
					subject="Re: Q3 planning"
					snippet="Thanks — that works…"
				/>
				<DraftRow to="Team" subject="" snippet="(no subject yet)" />
				<SectionHeader
					icon={<Inbox className="size-3" />}
					label="On the server"
					count={1}
				/>
				<DraftRow
					to="Grace"
					subject="Conference talk outline"
					snippet="Here's the rough structure for…"
				/>
			</div>
		</div>
	),
};

export const Empty: Story = {
	render: () => (
		<div className="flex h-dvh w-full flex-col items-center justify-center bg-surface text-center">
			<FileText className="size-10 text-fg-subtle" />
			<p className="mt-3 text-sm text-fg-muted">No drafts</p>
		</div>
	),
};
