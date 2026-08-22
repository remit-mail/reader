/**
 * The ceremony behind one press (#887): appoint the folder, wait for the 200,
 * invalidate and await `/config`, then re-issue the action that was refused.
 * Driven against the real fetch seam, so the order the requests actually leave
 * in is what is pinned — D16 item 1 exists because `useTrashByAccount` reads at
 * `staleTime: Infinity` and would otherwise word the retry from the answer the
 * appointment just replaced.
 */
import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { QueryClientProvider } from "@tanstack/react-query";
import { createElement } from "react";
import { createDomHarness, type DomHarness } from "../../test-support/dom";
import { type HttpMock, mockFetch } from "../../test-support/http";
import {
	type AppointmentRequest,
	RoleAppointmentPromptProvider,
	useRoleAppointmentPrompt,
} from "./RoleAppointmentPromptProvider";

const ACCOUNT = "acc-1";
const OTHER_ACCOUNT = "acc-2";
const PICK_TRASH = "Set Prullenbak, 3 messages, as Trash";
const CONFIRM = "Set as Trash and delete 2 messages";

let harness: DomHarness | undefined;
let http: HttpMock;

const CONFIG = {
	accounts: [ACCOUNT, OTHER_ACCOUNT].map((accountId) => ({
		accountId,
		email: `${accountId}@example.com`,
		folderAppointments: [{ role: "Trash", source: "None" }],
	})),
};

const MAILBOXES = {
	items: [
		{
			mailboxId: "mbx-inbox",
			accountId: ACCOUNT,
			fullPath: "INBOX",
			hierarchyDelimiter: "/",
			messageCount: 12,
		},
		{
			mailboxId: "mbx-trash",
			accountId: ACCOUNT,
			fullPath: "Prullenbak",
			hierarchyDelimiter: "/",
			messageCount: 3,
		},
	],
};

/** Everything answers; a test that needs a failure re-mocks the seam. */
const respond = (path: string): unknown => {
	if (path.endsWith("/config")) return CONFIG;
	if (path.endsWith("/mailboxes")) return MAILBOXES;
	return {};
};

const mountProvider = (): ((next: AppointmentRequest) => void) => {
	let request: ((next: AppointmentRequest) => void) | undefined;
	const Probe = () => {
		request = useRoleAppointmentPrompt().requestAppointment;
		return null;
	};
	harness = createDomHarness();
	harness.render(
		createElement(
			QueryClientProvider,
			{ client: harness.queryClient },
			createElement(RoleAppointmentPromptProvider, null, createElement(Probe)),
		),
	);
	if (!request) throw new Error("the provider did not render");
	return request;
};

/**
 * Two writes, a query invalidation and the refetch it waits on all sit behind
 * one press, and each hop is a real fetch. Rounds are bounded and the loop
 * stops as soon as `done` holds, so a slow machine costs turns, never a pass.
 */
const settle = async (done: () => boolean = () => false): Promise<void> => {
	if (!harness) throw new Error("nothing mounted");
	for (let round = 0; round < 40; round += 1) {
		await harness.flush();
		await harness.wait(0);
		if (done()) return;
	}
};

const press = async (label: string, done?: () => boolean): Promise<void> => {
	if (!harness) throw new Error("nothing mounted");
	harness.click(harness.byText("button", label));
	await settle(done);
};

const refusedDelete = (
	over: Partial<AppointmentRequest> = {},
): AppointmentRequest => ({
	accountId: ACCOUNT,
	role: "Trash",
	reason: "none",
	action: { kind: "delete", count: 2 },
	onAppointed: async () => {},
	...over,
});

const onScreen = (label: string): boolean =>
	(harness?.queryAll("button") ?? []).some(
		(button) => button.textContent === label,
	);

/** Pick the Trash folder in the picker, then press the confirm. */
const confirmWith = async (done?: () => boolean): Promise<void> => {
	if (!harness) throw new Error("nothing mounted");
	harness.click(harness.byLabel(PICK_TRASH));
	await settle(() => onScreen(CONFIRM));
	await press(CONFIRM, done);
};

beforeEach(() => {
	http = mockFetch((call) => respond(call.path));
});

afterEach(() => {
	harness?.close();
	harness = undefined;
	http.restore();
});

describe("the appointment ceremony", () => {
	it("asks nothing of the server until an action is refused", async () => {
		mountProvider();
		await settle();
		assert.deepEqual(http.calls, []);
	});

	it("puts the account's folders, with their counts, in the picker", async () => {
		const request = mountProvider();
		request(refusedDelete());
		await settle();

		assert.match(harness?.text() ?? "", /No folder is set as Trash/);
		assert.ok(
			harness?.query(`[aria-label="${PICK_TRASH}"]`),
			"the count is part of the row's own accessible name",
		);
	});

	it("names the account only where the instance holds more than one", async () => {
		const request = mountProvider();
		request(refusedDelete());
		await settle();
		assert.match(harness?.text() ?? "", /acc-1@example\.com/);
	});

	it("appoints, re-reads /config, and only then re-issues the action", async () => {
		const order: string[] = [];
		http.restore();
		http = mockFetch((call) => {
			order.push(`${call.method} ${call.path}`);
			return respond(call.path);
		});

		const request = mountProvider();
		request(
			refusedDelete({
				onAppointed: async () => {
					order.push("replay");
				},
			}),
		);
		await settle();
		await confirmWith(() => order.includes("replay"));

		const appointAt = order.findIndex((entry) =>
			entry.startsWith(`PUT /accounts/${ACCOUNT}/folder-roles/Trash`),
		);
		const replayAt = order.indexOf("replay");
		const refetchAt = order.findIndex(
			(entry, index) => index > appointAt && entry.endsWith("/config"),
		);

		assert.ok(appointAt >= 0, "the appointment is written");
		assert.ok(refetchAt > appointAt, "/config is re-read after the 200");
		assert.ok(
			replayAt > refetchAt,
			"the action is re-issued only once the fresh answer is in",
		);
	});

	it("takes the ceremony down once the replay has run", async () => {
		const request = mountProvider();
		request(refusedDelete());
		await settle();
		await confirmWith(
			() => !(harness?.text() ?? "").includes("No folder is set as Trash"),
		);

		assert.doesNotMatch(harness?.text() ?? "", /No folder is set as Trash/);
	});

	it("keeps the ceremony up, with the selection, when the appointment fails", async () => {
		http.restore();
		http = mockFetch((call) => {
			if (!call.path.includes("/folder-roles/")) return respond(call.path);
			return new Response(
				JSON.stringify({
					code: "mailbox_not_settled",
					message: "not settled",
					details: { mailboxId: "mbx-trash", syncStatus: "pending" },
				}),
				{ status: 409, headers: { "content-type": "application/json" } },
			);
		});

		let replayed = 0;
		const request = mountProvider();
		request(
			refusedDelete({
				onAppointed: async () => {
					replayed += 1;
				},
			}),
		);
		await settle();
		await confirmWith();

		assert.equal(replayed, 0, "nothing is re-issued over a failed appointment");
		assert.match(
			harness?.text() ?? "",
			/still being created on the mail server/,
			"a wait is worded as a wait, not as a retry",
		);
		assert.ok(
			onScreen(CONFIRM),
			"the confirm is still pressable — retry in place",
		);
	});

	/**
	 * The blocking case. A selection spanning two accounts that both lack a
	 * Trash is refused a second time the moment the replay runs, and that
	 * refusal raises its own prompt. Tearing the finished ceremony down
	 * unconditionally would destroy it in the same tick, leaving the rows rolled
	 * back and no account of why.
	 */
	it("leaves a prompt the replay raised alone", async () => {
		const request = mountProvider();
		request(
			refusedDelete({
				onAppointed: async () => {
					request(
						refusedDelete({
							accountId: OTHER_ACCOUNT,
							reason: "stale",
							staleFolderLabel: "INBOX/Weg",
						}),
					);
				},
			}),
		);
		await settle();
		await confirmWith(() =>
			(harness?.text() ?? "").includes("The Trash folder you chose is gone"),
		);

		assert.match(
			harness?.text() ?? "",
			/The Trash folder you chose is gone/,
			"the second refusal is on screen, not swallowed",
		);
		assert.match(harness?.text() ?? "", /INBOX\/Weg/);
	});

	it("closes on cancel, and writes nothing", async () => {
		const request = mountProvider();
		request(refusedDelete());
		await settle();
		await press("Cancel");

		assert.doesNotMatch(harness?.text() ?? "", /No folder is set as Trash/);
		assert.deepEqual(
			http.calls.filter((call) => call.path.includes("/folder-roles/")),
			[],
		);
	});
});
