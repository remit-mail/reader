import type { Decorator, Meta, StoryObj } from "@storybook/react";
import { type ComponentProps, type MouseEvent, useState } from "react";
import { expect, fireEvent, userEvent, within } from "storybook/test";
import { NavLinkSurface } from "./nav-link-surface.js";

const PHONE_WIDTH = 390;

const phoneFrame: Decorator = (Story) => (
	<div
		className="relative overflow-hidden rounded-lg border border-line"
		style={{ width: PHONE_WIDTH, height: 844 }}
	>
		<Story />
	</div>
);

const meta: Meta = {
	title: "Design System/Primitives/NavLinkSurface",
	parameters: { layout: "centered" },
};
export default meta;

type Story = StoryObj;

type NavLinkVariant = NonNullable<
	ComponentProps<typeof NavLinkSurface>["variant"]
>;

const variants: NavLinkVariant[] = ["nav", "row", "inline"];

const destinations = [
	{ id: "brief", href: "/mail/brief", label: "Daily brief" },
	{ id: "flagged", href: "/mail/flagged", label: "Starred" },
	{ id: "outbox", href: "/mail/outbox", label: "Outbox" },
];

const NOTHING_ACTIVATED = "nothing activated";

function NavLinkMatrix({
	width = 320,
	shown = variants,
}: {
	width?: number;
	shown?: NavLinkVariant[];
}) {
	const [activated, setActivated] = useState(NOTHING_ACTIVATED);

	const activate =
		(label: string) => (event: MouseEvent<HTMLAnchorElement>) => {
			event.preventDefault();
			setActivated(event.metaKey ? `${label} with Meta` : label);
		};

	return (
		<div
			className="flex flex-col gap-5 bg-canvas p-4 text-fg"
			style={{ width }}
		>
			{shown.map((variant) => (
				<section className="flex flex-col items-start gap-1" key={variant}>
					<h3 className="text-2xs uppercase tracking-wider text-fg-subtle">
						{variant}
					</h3>
					{destinations.map((destination, index) => (
						<NavLinkSurface
							current={index === 0 ? "page" : undefined}
							data-testid={`link-${variant}-${destination.id}`}
							href={destination.href}
							key={destination.id}
							onClick={activate(destination.label)}
							variant={variant}
						>
							{variant === "row" ? (
								<span className="flex-1 px-3 py-2">{destination.label}</span>
							) : (
								destination.label
							)}
						</NavLinkSurface>
					))}
				</section>
			))}
			<p className="text-xs text-fg-muted" data-testid="last-activation">
				{activated}
			</p>
		</div>
	);
}

export const Variants: Story = {
	render: () => <NavLinkMatrix />,
};

export const Phone: Story = {
	parameters: { layout: "centered", viewport: { value: "mobile" } },
	decorators: [phoneFrame],
	render: () => <NavLinkMatrix shown={["nav"]} width={PHONE_WIDTH} />,
};

export const IsARealAnchor: Story = {
	render: () => <NavLinkMatrix />,
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		for (const variant of variants) {
			for (const destination of destinations) {
				const link = canvas.getByTestId(`link-${variant}-${destination.id}`);
				await expect(link.tagName).toBe("A");
				await expect(link).toHaveAttribute("href", destination.href);
			}
		}
		await expect(canvas.getAllByRole("link")).toHaveLength(
			variants.length * destinations.length,
		);
	},
};

export const MarksTheCurrentDestination: Story = {
	render: () => <NavLinkMatrix />,
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await expect(canvas.getByTestId("link-nav-brief")).toHaveAttribute(
			"aria-current",
			"page",
		);
		await expect(canvas.getByTestId("link-nav-flagged")).not.toHaveAttribute(
			"aria-current",
		);

		await userEvent.click(canvas.getByTestId("link-nav-flagged"));

		await expect(canvas.getByTestId("link-nav-brief")).toHaveAttribute(
			"aria-current",
			"page",
		);
		await expect(canvas.getByTestId("link-nav-flagged")).not.toHaveAttribute(
			"aria-current",
		);
	},
};

export const ActivatesOnTabThenEnter: Story = {
	render: () => <NavLinkMatrix />,
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await expect(canvas.getByTestId("last-activation")).toHaveTextContent(
			NOTHING_ACTIVATED,
		);

		await userEvent.tab();
		await expect(canvas.getByTestId("link-nav-brief")).toHaveFocus();
		await userEvent.keyboard("{Enter}");

		await expect(canvas.getByTestId("last-activation")).toHaveTextContent(
			"Daily brief",
		);
		await expect(canvas.getByTestId("link-nav-brief")).toHaveFocus();
	},
};

export const PassesModifiedClicksThrough: Story = {
	render: () => <NavLinkMatrix />,
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		const link = canvas.getByTestId("link-nav-outbox");

		await userEvent.click(link);
		await expect(canvas.getByTestId("last-activation")).toHaveTextContent(
			"Outbox",
		);

		fireEvent.click(link, { metaKey: true });
		await expect(canvas.getByTestId("last-activation")).toHaveTextContent(
			"Outbox with Meta",
		);
	},
};
