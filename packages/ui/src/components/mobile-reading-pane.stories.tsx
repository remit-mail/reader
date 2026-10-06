import type { Meta, StoryObj } from "@storybook/react";
import { useState } from "react";
import { expect, waitFor, within } from "storybook/test";
import { MobileReadingPane } from "./mobile-reading-pane.js";

const subjects = ["First message", "Second message", "Third message"];

const meta: Meta<typeof MobileReadingPane> = {
	title: "Design System/Primitives/MobileReadingPane",
	component: MobileReadingPane,
	parameters: { layout: "fullscreen" },
};
export default meta;

type Story = StoryObj<typeof MobileReadingPane>;

const SwipeBetweenMessages = () => {
	const [index, setIndex] = useState(1);
	return (
		<div className="h-96 max-w-md">
			<MobileReadingPane
				thread={{ subject: subjects[index] ?? "", messages: [] }}
				onBack={() => undefined}
				onSwipeNext={
					index < subjects.length - 1 ? () => setIndex(index + 1) : undefined
				}
				onSwipePrevious={index > 0 ? () => setIndex(index - 1) : undefined}
			>
				<p className="p-4">Swipe the body left or right.</p>
			</MobileReadingPane>
		</div>
	);
};

const swipe = (area: Element, fromX: number, toX: number) => {
	const touch = (type: string, x: number) =>
		area.dispatchEvent(
			new PointerEvent(type, {
				bubbles: true,
				buttons: type === "pointerup" ? 0 : 1,
				pointerType: "touch",
				pointerId: 1,
				clientX: x,
				clientY: 200,
			}),
		);
	touch("pointerdown", fromX);
	touch("pointermove", (fromX + toX) / 2);
	touch("pointermove", toX);
	touch("pointerup", toX);
};

export const SwipeToOpenNextAndPrevious: Story = {
	name: "Swipe to open next and previous (interactive)",
	render: () => <SwipeBetweenMessages />,
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		const area = canvasElement.querySelector("article > div.overflow-y-auto");
		if (!area) throw new Error("reading area did not render");
		await expect(canvas.getByRole("heading")).toHaveTextContent(
			"Second message",
		);

		swipe(area, 300, 100);
		await waitFor(() =>
			expect(canvas.getByRole("heading")).toHaveTextContent("Third message"),
		);

		swipe(area, 100, 300);
		await waitFor(() =>
			expect(canvas.getByRole("heading")).toHaveTextContent("Second message"),
		);
		swipe(area, 100, 300);
		await waitFor(() =>
			expect(canvas.getByRole("heading")).toHaveTextContent("First message"),
		);
	},
};
