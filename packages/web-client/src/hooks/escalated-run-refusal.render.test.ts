/**
 * A select-all delete refused for its folder role is answered by the
 * appointment prompt, not by a banner (#876).
 *
 * The escalated path had no branch for the coded 409, so the refusal arrived as
 * the API's own sentence — "Appoint one under Settings › Folder roles" — under a
 * "Couldn't delete these messages" banner. That asks a user who has just
 * selected three thousand messages to go to another screen and rebuild the
 * selection, which is the outcome the prompt exists to remove; the single-row
 * path has answered it in place since #887.
 */

import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { QueryClientProvider } from "@tanstack/react-query";
import { act, createElement, type ReactNode, useEffect, useRef } from "react";
import { BulkRunProvider } from "@/components/mail/BulkRunProvider";
import { RoleAppointmentPromptProvider } from "@/components/mail/RoleAppointmentPromptProvider";
import { ErrorBannerProvider } from "@/components/ui/ErrorBannerProvider";
import type { BulkRunOutcome, EscalatedAction } from "../lib/bulk-actions";
import { createDomHarness, type DomHarness } from "../test-support/dom";
import { type HttpCall, type HttpMock, mockFetch } from "../test-support/http";
import {
	type UseEscalatedActionsResult,
	useEscalatedActions,
} from "./useEscalatedActions";

const INBOX = "mbx-inbox";
const ELSEWHERE = "mbx-archive";
const ACCOUNT = "acc-1";
const TRASH = "mbx-trash";
/** The one id whose delete is never answered, so a run holds the slot. */
const HELD = "msg-held";
const CONFIRM = "Set as Trash and delete";
const PICK_TRASH = "Set Prullenbak, 3 messages, as Trash";

let harness: DomHarness | undefined;
let http: HttpMock | undefined;
let hook: UseEscalatedActionsResult | undefined;

/** Endings the run's owner stated once no screen was left to state them. */
let endings: Array<{
	kind: EscalatedAction["kind"];
	matched: number;
	outcome: BulkRunOutcome;
}> = [];

interface MountedScreen {
	hook: UseEscalatedActionsResult;
	/** Passed to the run this screen starts, the way the wizard's does. */
	claimEnding: (release: () => void) => void;
}

const screens = new Map<string, MountedScreen>();

beforeEach(() => {
	endings = [];
	screens.clear();
});

afterEach(() => {
	harness?.close();
	harness = undefined;
	http?.restore();
	http = undefined;
	hook = undefined;
	screens.clear();
});

const CONFIG = {
	accounts: [
		{
			accountId: ACCOUNT,
			email: "you@example.com",
			folderAppointments: [
				{ role: "Trash", mailboxId: TRASH, source: "Proposed" },
			],
		},
	],
};

/** Fresh every call — a `Response` body can only be read once. */
const refusal = (): Response =>
	new Response(
		JSON.stringify({
			status: 409,
			message: "Nobody has confirmed which folder is this account's Trash",
			code: "folder_role_unresolved",
			details: { reason: "unconfirmed", role: "Trash", accountId: ACCOUNT },
		}),
		{ status: 409, headers: { "content-type": "application/json" } },
	);

const Probe = () => {
	hook = useEscalatedActions({
		mailboxId: INBOX,
		accountId: ACCOUNT,
		enabled: true,
		predicateKey: "npm",
		searchQuery: { query: "npm" },
	});
	return null;
};

const settle = async (done: () => boolean = () => false): Promise<void> => {
	if (!harness) throw new Error("nothing mounted");
	for (let round = 0; round < 40; round += 1) {
		await harness.flush();
		await harness.wait(0);
		if (done()) return;
	}
};

const mount = async (respond: (path: string) => unknown): Promise<void> => {
	http = mockFetch((call) => respond(call.path));
	harness = createDomHarness();
	await harness.renderAsync(
		createElement(
			QueryClientProvider,
			{ client: harness.queryClient as never },
			createElement(
				ErrorBannerProvider,
				null,
				createElement(
					RoleAppointmentPromptProvider,
					null,
					createElement(BulkRunProvider, null, createElement(Probe)),
				),
			),
		),
	);
	await settle();
};

const runDelete = async (): Promise<void> => {
	await act(async () => {
		await hook?.runAction({ kind: "delete" }, [
			{ id: "msg-1", accountId: ACCOUNT },
		]);
	});
	await settle();
};

describe("a bulk delete refused for its folder role", () => {
	it("opens the appointment prompt instead of bannering the API's sentence", async () => {
		await mount((path) => {
			if (path.endsWith("/config")) return CONFIG;
			if (path.endsWith("/messages/delete")) return refusal();
			return {};
		});

		await runDelete();

		const text = harness?.text() ?? "";
		assert.match(text, /Confirm this account's Trash folder/);
		assert.doesNotMatch(text, /Couldn't delete these messages/);
		assert.doesNotMatch(
			text,
			/Settings › Folder roles/,
			"the raw API sentence is what the prompt replaces",
		);
	});

	it("keeps today's banner for a 409 that is somebody else's", async () => {
		await mount((path) => {
			if (path.endsWith("/config")) return CONFIG;
			if (path.endsWith("/messages/delete"))
				// A conflict with no code this prompt knows: the status class's own,
				// which is what every refusal that names nothing more specific
				// answers with.
				return new Response(
					JSON.stringify({
						status: 409,
						message: "boom",
						code: "conflict",
					}),
					{ status: 409, headers: { "content-type": "application/json" } },
				);
			return {};
		});

		await runDelete();

		const text = harness?.text() ?? "";
		assert.match(text, /Couldn't delete these messages/);
		assert.doesNotMatch(text, /Confirm this account's Trash folder/);
	});
});

const MAILBOXES = {
	items: [
		{
			mailboxId: INBOX,
			accountId: ACCOUNT,
			fullPath: "INBOX",
			hierarchyDelimiter: "/",
			messageCount: 12,
		},
		{
			mailboxId: TRASH,
			accountId: ACCOUNT,
			fullPath: "Prullenbak",
			hierarchyDelimiter: "/",
			messageCount: 3,
		},
	],
};

/**
 * A mailbox screen that states a run's ending in place while it is up, and
 * releases that claim when it goes — the wizard's own arrangement.
 */
const screenFor = (mailboxId: string): ReactNode => {
	const Screen = () => {
		const release = useRef<(() => void) | undefined>(undefined);
		useEffect(
			() => () => {
				release.current?.();
				release.current = undefined;
			},
			[],
		);
		const live = useEscalatedActions({
			mailboxId,
			accountId: ACCOUNT,
			enabled: true,
			predicateKey: `${mailboxId}|npm`,
			searchQuery: { query: "npm" },
			reportEnding: (kind, matched, outcome) => {
				endings.push({ kind, matched, outcome });
			},
		});
		screens.set(mailboxId, {
			hook: live,
			claimEnding: (next) => {
				release.current?.();
				release.current = next;
			},
		});
		return null;
	};
	return createElement(Screen, { key: mailboxId });
};

const screen = (mailboxId: string): MountedScreen => {
	const mounted = screens.get(mailboxId);
	if (!mounted) throw new Error(`no screen is mounted for ${mailboxId}`);
	return mounted;
};

const mountApp = async (
	respond: (call: HttpCall) => unknown,
	element: ReactNode,
): Promise<void> => {
	http = mockFetch(respond);
	harness = createDomHarness();
	harness.renderApp(element);
	await settle();
};

const deleteOne = (mailboxId: string, id: string, claimed: boolean): void => {
	const mounted = screen(mailboxId);
	void mounted.hook.runAction(
		{ kind: "delete" },
		[{ id, accountId: ACCOUNT }],
		claimed ? mounted.claimEnding : undefined,
	);
};

const promptIsUp = (): boolean =>
	(harness?.text() ?? "").includes("Confirm this account's Trash folder");

/** The confirm mounts only once the account's folders have arrived. */
const confirmIsUp = (): boolean =>
	(harness?.queryAll("button") ?? []).some((button) =>
		(button.textContent ?? "").includes(CONFIRM),
	);

/** Pick the account's real Trash in the picker, then press the confirm. */
const pressConfirm = async (): Promise<void> => {
	await settle(() => !!harness?.query(`[aria-label="${PICK_TRASH}"]`));
	if (!harness) throw new Error("nothing mounted");
	harness.click(harness.byLabel(PICK_TRASH));
	await settle(confirmIsUp);
	harness.click(harness.byText("button", CONFIRM));
};

/**
 * The replay is a new run and claims nothing (#112). The claim the refused run
 * was started under belongs to the screen that started it, and that screen has
 * usually gone by the time the folder is appointed — its release has already
 * fired, so a replay re-claiming under it would be held back by nobody and end
 * in silence.
 */
describe("the run replayed once the folder is appointed", () => {
	it("states its ending, once, with the screen that started it gone", async () => {
		let stillRefusing = true;
		await mountApp((call) => {
			if (call.path.endsWith("/config")) return CONFIG;
			if (call.path.endsWith("/mailboxes")) return MAILBOXES;
			if (call.path.endsWith("/messages/delete")) {
				if (!stillRefusing) return { successCount: 1, failureCount: 0 };
				stillRefusing = false;
				return refusal();
			}
			return {};
		}, screenFor(INBOX));

		await act(async () => {
			deleteOne(INBOX, "msg-1", true);
		});
		await settle(promptIsUp);
		assert.ok(promptIsUp(), "the refusal opened the appointment prompt");

		// The user closes the wizard and leaves the mailbox while the prompt is up.
		// The prompt and the run's owner are above the route, so both stay.
		harness?.renderApp(createElement("div", null, "somewhere else"));
		assert.equal(endings.length, 0, "nothing has ended yet");

		await pressConfirm();
		await settle(() => endings.length > 0);

		assert.equal(endings.length, 1, "the replay's ending is said exactly once");
		assert.equal(endings[0]?.kind, "delete");
		assert.equal(endings[0]?.outcome.done, 1);
		assert.equal(endings[0]?.outcome.error, undefined);
	});

	it("banners a replay refused because another run holds the slot", async () => {
		let stillRefusing = true;
		await mountApp(
			(call) => {
				if (call.path.endsWith("/config")) return CONFIG;
				if (call.path.endsWith("/mailboxes")) return MAILBOXES;
				if (call.path.endsWith("/messages/delete")) {
					const ids =
						(call.body as { messageIds?: string[] } | undefined)?.messageIds ??
						[];
					if (ids.includes(HELD)) return new Promise<never>(() => {});
					if (stillRefusing) {
						stillRefusing = false;
						return refusal();
					}
					return { successCount: 1, failureCount: 0 };
				}
				return {};
			},
			createElement("div", null, screenFor(INBOX), screenFor(ELSEWHERE)),
		);

		await act(async () => {
			deleteOne(INBOX, "msg-1", false);
		});
		await settle(promptIsUp);

		// Another mailbox takes the one run slot while the prompt is still open.
		await act(async () => {
			deleteOne(ELSEWHERE, HELD, false);
		});
		await settle(() => screen(ELSEWHERE).hook.isRunning);

		await pressConfirm();
		await settle(() => (harness?.text() ?? "").includes("still running"));

		const text = harness?.text() ?? "";
		assert.match(text, /Couldn't delete these messages/);
		assert.match(
			text,
			/still running/,
			"a replay with nowhere to run says so instead of vanishing",
		);
	});
});
