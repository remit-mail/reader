import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, within } from "storybook/test";
import { AppStory } from "@/mocks/story-frame/AppStory";
import { mailHandlers } from "@/mocks/story-frame/mail-handlers";
import { mailWorld } from "@/mocks/story-frame/mail-world";
import {
	calendars,
	fortnight,
	ROADMAP_OBJECT,
	roadmapResource,
	STANDUP_OBJECT,
	STANDUP_RECURRENCE,
	STORY_DATE,
	STORY_WEEK,
	standupResource,
} from "./calendar-story-fixtures";

const world = mailWorld({
	calendars,
	calendarEvents: fortnight,
	calendarResources: [roadmapResource, standupResource],
});
const desktop = { viewport: { value: "desktop", isRotated: false } };
const phone = { viewport: { value: "mobile", isRotated: false } };

const meta = {
	title: "Playground/Shipped/Calendar/App",
	component: AppStory,
	args: { url: STORY_WEEK },
	parameters: {
		layout: "fullscreen",
		msw: { handlers: mailHandlers(world) },
	},
	globals: desktop,
} satisfies Meta<typeof AppStory>;
export default meta;

type Story = StoryObj<typeof meta>;

const page = () => within(document.body);

export const Week: Story = {
	play: async () => {
		await expect(
			(await page().findAllByText("Roadmap review"))[0],
		).toBeVisible();
		await expect(
			(await page().findAllByRole("link", { name: "Calendar" }))[0],
		).toBeVisible();
	},
};

export const Empty: Story = {
	parameters: { msw: { handlers: mailHandlers(mailWorld()) } },
	play: async () => {
		await expect(
			(await page().findAllByRole("link", { name: "Calendar" }))[0],
		).toBeVisible();
		await expect(page().queryByText("Roadmap review")).toBeNull();
	},
};

export const OpenEvent: Story = {
	args: { url: `${STORY_WEEK}/${ROADMAP_OBJECT}` },
	play: async () => {
		await expect(await page().findByText("Room Zuid")).toBeVisible();
		await expect(
			await page().findByRole("button", { name: "Edit" }),
		).toBeVisible();
	},
};

export const RecurrenceScope: Story = {
	args: { url: `${STORY_WEEK}/${STANDUP_OBJECT}/${STANDUP_RECURRENCE}` },
	play: async () => {
		await userEvent.click(await page().findByRole("button", { name: "Edit" }));
		await expect(
			await page().findByText("What should the change apply to?"),
		).toBeVisible();
	},
};

export const PhoneDay: Story = {
	args: { url: `/calendar/day/${STORY_DATE}` },
	globals: phone,
	play: async () => {
		await expect(
			(await page().findAllByText("Roadmap review"))[0],
		).toBeVisible();
	},
};

export const PhoneEvent: Story = {
	args: { url: `/calendar/day/${STORY_DATE}/${ROADMAP_OBJECT}` },
	globals: phone,
	play: async () => {
		await expect(await page().findByText("Room Zuid")).toBeVisible();
	},
};
