import type { Meta, StoryObj } from "@storybook/react";
import { Lock, Mail, Search } from "lucide-react";
import { Avatar } from "./avatar.js";
import { Badge } from "./badge.js";
import { Button } from "./button.js";
import { Card, CardBody, CardHeader, CardTitle } from "./card.js";
import { FieldLabel } from "./field-label.js";
import { Input } from "./input.js";
import { ListItem } from "./list-item.js";
import { SecuritySelect } from "./security-select.js";
import { Select } from "./select.js";

const meta: Meta = {
	title: "Primitives",
};
export default meta;

type Story = StoryObj;

export const Buttons: Story = {
	render: () => (
		<div className="flex flex-wrap items-center gap-3 p-8">
			<Button variant="primary">Primary</Button>
			<Button variant="secondary">Secondary</Button>
			<Button variant="ghost">Ghost</Button>
			<Button variant="danger">Danger</Button>
			<Button variant="primary" size="sm" icon={<Mail className="size-3.5" />}>
				Compose
			</Button>
			<Button variant="primary" disabled>
				Disabled
			</Button>
			<Button
				variant="ghost"
				size="touch"
				icon={<Mail className="size-4" />}
				aria-label="Touch-sized icon button"
			/>
		</div>
	),
};

export const Badges: Story = {
	render: () => (
		<div className="flex flex-wrap items-center gap-3 p-8">
			<Badge tone="neutral">newsletter</Badge>
			<Badge tone="accent">personal</Badge>
			<Badge tone="positive" dot>
				Known sender
			</Badge>
			<Badge tone="warning">social</Badge>
			<Badge tone="danger">spam</Badge>
		</div>
	),
};

export const Avatars: Story = {
	render: () => (
		<div className="flex items-center gap-4 p-8">
			<Avatar name="Alice Tan" size="sm" />
			<Avatar name="Priya Natarajan" size="md" />
			<Avatar name="Marcus Webb" size="lg" />
			<Avatar name="Remit CI" email="ci@remit.example" size="md" />
		</div>
	),
};

export const Inputs: Story = {
	render: () => (
		<div className="max-w-sm space-y-3 p-8">
			<Input placeholder="Plain input" />
			<Input icon={<Search className="size-4" />} placeholder="Search mail" />
		</div>
	),
};

export const InlineInputs: Story = {
	render: () => (
		<div className="max-w-sm space-y-3 p-8">
			<div className="border-b border-line px-3 py-2">
				<Input variant="inline" placeholder="Filter folders" />
			</div>
			<div className="border-b border-line px-3 py-2">
				<Input
					variant="inline"
					icon={<Search className="size-4" />}
					placeholder="Move to…"
				/>
			</div>
		</div>
	),
};

export const LabeledFields: Story = {
	render: () => (
		<div className="max-w-sm space-y-3 p-8">
			<div>
				<FieldLabel htmlFor="host">Host</FieldLabel>
				<Input id="host" placeholder="imap.example.com" />
			</div>
			<div>
				<FieldLabel htmlFor="security">Security</FieldLabel>
				<SecuritySelect id="security" defaultValue="tls" />
			</div>
		</div>
	),
};

export const SecuritySelects: Story = {
	render: () => (
		<div className="max-w-sm space-y-3 p-8">
			<SecuritySelect defaultValue="tls" />
			<SecuritySelect defaultValue="starttls" />
			<SecuritySelect defaultValue="none" />
		</div>
	),
};

export const Selects: Story = {
	render: () => (
		<div className="max-w-sm space-y-3 p-8">
			<Select defaultValue="tls">
				<option value="tls">TLS/SSL</option>
				<option value="starttls">STARTTLS</option>
				<option value="none">None (insecure)</option>
			</Select>
			<Select icon={<Lock className="size-4" />} defaultValue="starttls">
				<option value="tls">TLS/SSL</option>
				<option value="starttls">STARTTLS</option>
				<option value="none">None (insecure)</option>
			</Select>
		</div>
	),
};

export const Cards: Story = {
	render: () => (
		<div className="max-w-md p-8">
			<Card raised>
				<CardHeader>
					<CardTitle>Card title</CardTitle>
				</CardHeader>
				<CardBody>
					Hairline border, minimal shadow. Surfaces and text are fully
					token-driven so this flips cleanly between light and dark.
				</CardBody>
			</Card>
		</div>
	),
};

export const ListItems: Story = {
	render: () => (
		<div className="max-w-md divide-y divide-line p-8">
			<ListItem
				unread
				leading={<Avatar name="Priya Natarajan" size="md" />}
				trailing="08:52"
			>
				<div className="text-sm font-semibold text-fg">Priya Natarajan</div>
				<div className="text-sm text-fg">Q3 roadmap review</div>
				<p className="line-clamp-1 text-xs text-fg-subtle">
					Sharing the agenda ahead of Thursday…
				</p>
			</ListItem>
			<ListItem
				active
				leading={<Avatar name="Marcus Webb" size="md" />}
				trailing="Wed"
			>
				<div className="text-sm font-medium text-fg-muted">Marcus Webb</div>
				<div className="text-sm text-fg-muted">Re: Reading pane density</div>
				<p className="line-clamp-1 text-xs text-fg-subtle">
					Strong +1 on tightening the rows…
				</p>
			</ListItem>
		</div>
	),
};
