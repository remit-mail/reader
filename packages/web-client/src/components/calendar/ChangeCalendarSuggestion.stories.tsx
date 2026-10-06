import type { RemitImapCalendarSuggestionResponse } from "@remit/api-http-client/types.gen.ts";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, within } from "storybook/test";
import { useCalendarNavigation, useChangingSuggestionId } from "@/routing";
import { ChangeCalendarSuggestion } from "./ChangeCalendarSuggestion";
import { calendars, STORY_WEEK } from "./calendar-story-fixtures";
import {
	type CalendarServer,
	CalendarStory,
	json,
} from "./calendar-story-server";
import { PendingSuggestions } from "./PendingSuggestions";

const SUGGESTION = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

const suggestion = (
	overrides: Partial<RemitImapCalendarSuggestionResponse> = {},
): RemitImapCalendarSuggestionResponse => ({
	suggestionId: SUGGESTION,
	accountConfigId: "cfg-1",
	messageId: "msg-1",
	bodyPartId: "part-1",
	icalUid: "uid-kickoff",
	sequence: 0,
	method: "Request",
	source: "IcalendarPart",
	state: "Pending",
	summary: "Billing migration kickoff",
	dtStart: "2026-06-11T14:00:00+02:00",
	dtEnd: "2026-06-11T15:00:00+02:00",
	endsAtUtc: "2026-06-11T13:00:00Z",
	allDay: false,
	location: "Room Noord",
	organizer: "priya@example.invalid",
	zoneCertainty: "Explicit",
	acceptedCalendarObjectId: "",
	supersededByMessageId: "",
	supersededByThreadId: "",
	createdAt: 0,
	updatedAt: 0,
	answerOvertakenBy: "None",
	...overrides,
});

const serverWith =
	(pending: RemitImapCalendarSuggestionResponse[]): CalendarServer =>
	(request) => {
		const url = new URL(request.url);
		if (url.pathname.endsWith("/calendars")) return json({ items: calendars });
		if (url.pathname.endsWith("/calendar-suggestions"))
			return json({ items: pending });
		if (url.pathname.endsWith("/accept"))
			return json({ ...pending[0], state: "Accepted" });
		return json({ items: [] });
	};

function WaitingThenEditor() {
	const { changeSuggestionFirst, closeEvent } = useCalendarNavigation();
	const changing = useChangingSuggestionId();
	return (
		<div className="flex h-dvh bg-canvas">
			<PendingSuggestions onChangeFirst={changeSuggestionFirst} />
			<div className="min-w-0 flex-1 border-l border-line">
				{changing !== undefined && (
					<ChangeCalendarSuggestion
						suggestionId={changing}
						onClose={closeEvent}
					/>
				)}
			</div>
		</div>
	);
}

function Editor({
	pending,
	openedFrom = "address",
}: {
	pending: RemitImapCalendarSuggestionResponse[];
	openedFrom?: "address" | "card";
}) {
	if (openedFrom === "card")
		return (
			<CalendarStory
				entry={STORY_WEEK}
				server={serverWith(pending)}
				pane={<WaitingThenEditor />}
			/>
		);
	return (
		<div className="h-dvh max-w-2xl border-l border-line bg-canvas">
			<CalendarStory
				entry={`${STORY_WEEK}/suggestion/${SUGGESTION}`}
				server={serverWith(pending)}
				pane={
					<ChangeCalendarSuggestion
						suggestionId={SUGGESTION}
						onClose={() => undefined}
					/>
				}
			/>
		</div>
	);
}

const meta: Meta<typeof Editor> = {
	title: "Playground/Shipped/Calendar/Change a suggestion first",
	component: Editor,
	parameters: { layout: "fullscreen" },
};
export default meta;

type Story = StoryObj<typeof Editor>;

export const SeededFromTheMail: Story = {
	args: { pending: [suggestion()] },
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await expect(await canvas.findByLabelText("Title")).toHaveValue(
			"Billing migration kickoff",
		);
		await expect(canvas.getByLabelText("Location")).toHaveValue("Room Noord");
		await expect(canvas.getByLabelText("Date")).toHaveValue("2026-06-11");
		await expect(canvas.getByRole("button", { name: "Add" })).toBeVisible();
	},
};

export const ZoneNobodyCouldPlace: Story = {
	args: {
		pending: [
			suggestion({
				dtStart: "2026-06-11T09:00:00+00:00",
				dtEnd: "2026-06-11T10:00:00+00:00",
				endsAtUtc: "2026-06-11T10:00:00Z",
				zoneCertainty: "Ambiguous",
			}),
		],
	},
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await expect(await canvas.findByLabelText("Start time")).toHaveValue(
			"09:00",
		);
		await expect(
			canvas.getByText(/named a time zone nothing could resolve/),
		).toBeVisible();
	},
};

export const NoLongerWaiting: Story = {
	args: { pending: [] },
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await expect(
			await canvas.findByText(/no longer waiting on you/),
		).toBeVisible();
	},
};

export const SaysWhatIsMissing: Story = {
	args: { pending: [suggestion()] },
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		const title = await canvas.findByLabelText("Title");
		await userEvent.clear(title);
		await userEvent.click(canvas.getByRole("button", { name: "Add" }));
		await expect(await canvas.findByRole("alert")).toHaveTextContent(
			"Give the event a title",
		);
	},
};

export const OpenedFromTheWaitingCard: Story = {
	args: { pending: [suggestion()], openedFrom: "card" },
	globals: { viewport: { value: "desktop" } },
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await userEvent.click(
			await canvas.findByRole("button", { name: "Change first" }),
		);
		await expect(await canvas.findByLabelText("Title")).toHaveValue(
			"Billing migration kickoff",
		);
		await expect(canvas.getByLabelText("Location")).toHaveValue("Room Noord");
		await expect(canvas.getByLabelText("Date")).toHaveValue("2026-06-11");
	},
};
