import type { Decorator } from "@storybook/react-vite";

/** The tiers the preview's viewport toolbar offers, so a story can match one. */
export const PHONE_WIDTH = 390;

/**
 * A device-sized window onto a full-screen story. The shell reflows off its own
 * width, so a narrow tier needs a frame that width rather than a browser
 * viewport the story cannot see.
 */
export const framedAt =
	(width: number): Decorator =>
	(Story) => (
		<div
			className="relative overflow-hidden rounded-lg border border-line"
			style={{ width, height: 844 }}
		>
			<Story />
		</div>
	);

export const phoneFrame = framedAt(PHONE_WIDTH);

export const phoneParams = {
	layout: "centered" as const,
	viewport: { value: "mobile" },
};
