import { NavLinkSurface } from "@remit/ui";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { type ComponentProps, type MouseEvent, useState } from "react";
import { expect, fireEvent, userEvent, within } from "storybook/test";
import { PHONE_WIDTH, phoneFrame, phoneParams } from "../lib/story-frame.js";

/**
 * The surfaces the route mounts into the reading pane (#713), and the link that
 * gets you to them.
 *
 * `NavLinkSurface` is the design system's half of the split: appearance and
 * accessible state, a real `<a>`, no router. Because it holds no `to`, the
 * matrix below renders without a router in the tree — which is the point of
 * keeping the typed binding in `packages/web-client`.
 *
 * Every story here follows one shape: assert the surface, do something
 * unrelated, assert it again. A single assertion straight after the click
 * passes on code that only queued the work.
 */
const meta: Meta = {
	title: "Flows/Detail surface",
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

/**
 * The matrix, plus a line reporting what the last activation looked like from
 * the anchor's own handler. Every link cancels its navigation so the story can
 * survive being clicked; nothing else about the event is touched.
 */
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

/**
 * Three variants against two states. The first entry of each group is the
 * current destination, so the current treatment sits beside the resting one:
 * `nav` for a sidebar entry, `row` for a full-bleed list row (inset ring, since
 * it has no margin to spend on an offset one), `inline` for a link inside prose.
 */
export const NavLinkVariants: Story = {
	render: () => <NavLinkMatrix />,
};

/** Phone width (390 px): the nav variant at the tier the drawer renders it. */
export const NavLinkPhone: Story = {
	parameters: phoneParams,
	decorators: [phoneFrame],
	render: () => <NavLinkMatrix shown={["nav"]} width={PHONE_WIDTH} />,
};

/**
 * The whole reason this is an anchor: every entry carries a real `href`, so
 * middle-click, cmd-click and "copy link address" work without a handler of
 * ours, and the destination survives a page the router never sees.
 */
export const NavLinkIsARealAnchor: Story = {
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

/**
 * `current` is one prop for two facts that must never disagree: the accessible
 * state and the highlight. Asserted before and after clicking a sibling, since
 * the surface owns neither the route nor when it changes — a click must not
 * move the marker on its own.
 */
export const NavLinkMarksTheCurrentDestination: Story = {
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

/**
 * Tab reaches it and Enter activates it, both from the browser rather than from
 * a key handler. A `<div onClick>` wearing link styling passes neither.
 */
export const NavLinkActivatesOnTabThenEnter: Story = {
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

/**
 * A cmd-click arrives with its modifier intact. The surface adds no `onClick` of
 * its own, so the router binding downstream still gets to stand aside and let
 * the browser open a new tab.
 */
export const NavLinkPassesModifiedClicksThrough: Story = {
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
