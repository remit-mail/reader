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
import { afterEach, describe, it } from "node:test";
import { QueryClientProvider } from "@tanstack/react-query";
import { act, createElement } from "react";
import { RoleAppointmentPromptProvider } from "@/components/mail/RoleAppointmentPromptProvider";
import { ErrorBannerProvider } from "@/components/ui/ErrorBannerProvider";
import { createDomHarness, type DomHarness } from "../test-support/dom";
import { type HttpMock, mockFetch } from "../test-support/http";
import {
	type UseEscalatedActionsResult,
	useEscalatedActions,
} from "./useEscalatedActions";

const INBOX = "mbx-inbox";
const ACCOUNT = "acc-1";
const TRASH = "mbx-trash";

let harness: DomHarness | undefined;
let http: HttpMock | undefined;
let hook: UseEscalatedActionsResult | undefined;

afterEach(() => {
	harness?.close();
	harness = undefined;
	http?.restore();
	http = undefined;
	hook = undefined;
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

const settle = async (): Promise<void> => {
	if (!harness) throw new Error("nothing mounted");
	for (let round = 0; round < 40; round += 1) {
		await harness.flush();
		await harness.wait(0);
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
					createElement(Probe),
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
				return new Response(
					JSON.stringify({
						status: 409,
						message: "boom",
						code: "mailbox_not_settled",
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
