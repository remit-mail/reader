/**
 * A coded 409 must reach the surface that answers it and nothing else (#1004).
 *
 * Both delete paths raise through `useMutation`, and the app wires the global
 * fail-fast sink on the `MutationCache` (`shell/index.tsx`), where a 409 with
 * no `meta` escalates to the full-screen fatal overlay. The prompt then opens
 * underneath a red page nobody can see past — the refusal is handled and still
 * never reaches the user. Every other test mounts on the harness's plain
 * `QueryClient`, which has no such sink, so none of them can see this.
 *
 * Mounted here on the client the app actually builds, with the error
 * interceptor registered.
 */

import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import {
	MutationCache,
	QueryCache,
	QueryClient,
	QueryClientProvider,
} from "@tanstack/react-query";
import { act, createElement } from "react";
import { RoleAppointmentPromptProvider } from "@/components/mail/RoleAppointmentPromptProvider";
import { ErrorBannerProvider } from "@/components/ui/ErrorBannerProvider";
import { __resetFatalError, getCurrentFatalError } from "@/lib/fatal-error";
import {
	handleMutationCacheError,
	handleQueryCacheError,
} from "@/lib/query-error-handler";
import { createDomHarness, type DomHarness } from "../test-support/dom";
import { type HttpMock, mockFetch } from "../test-support/http";
import { useDeleteMessages } from "./useDeleteMessages";
import { type EmptyTrashState, useEmptyTrash } from "./useEmptyTrash";
import { useMoveMessages } from "./useMoveMessages";
import "@/lib/client";

const ACCOUNT = "acc-1";
const INBOX = "mbx-inbox";
const TRASH = "mbx-trash";
const ARCHIVE = "mbx-archive";

let harness: DomHarness | undefined;
let http: HttpMock | undefined;
let deleteMessages: ((messageIds: string[]) => void) | undefined;
let moveMessages:
	| ((messageIds: string[], destinationMailboxId: string) => void)
	| undefined;
let trash: EmptyTrashState | undefined;

afterEach(() => {
	harness?.close();
	harness = undefined;
	http?.restore();
	http = undefined;
	deleteMessages = undefined;
	moveMessages = undefined;
	trash = undefined;
	__resetFatalError();
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

/** The move gate's own coded 409: the row's folder and uid disagree (#665). */
const unsettled = (): Response =>
	new Response(
		JSON.stringify({
			status: 409,
			message:
				"Message msg-1 was not acted on: its folder and uid do not name the same message",
			code: "message_placement_unsettled",
			details: { accountId: ACCOUNT, messageId: "msg-1", reason: "in_flight" },
		}),
		{ status: 409, headers: { "content-type": "application/json" } },
	);

const broken = (): Response =>
	new Response(JSON.stringify({ message: "boom" }), {
		status: 500,
		headers: { "content-type": "application/json" },
	});

const Probe = () => {
	deleteMessages = useDeleteMessages({
		mailboxId: INBOX,
		accountId: ACCOUNT,
	}).deleteMessages;
	moveMessages = useMoveMessages({
		mailboxId: INBOX,
		accountId: ACCOUNT,
	}).moveMessages;
	trash = useEmptyTrash({ accountId: ACCOUNT, mailboxId: TRASH });
	return null;
};

/** The client `shell/index.tsx` builds: the real global escalation sink. */
const appQueryClient = (): QueryClient =>
	new QueryClient({
		queryCache: new QueryCache({ onError: handleQueryCacheError }),
		mutationCache: new MutationCache({ onError: handleMutationCacheError }),
		defaultOptions: {
			queries: { retry: false },
			mutations: { retry: false },
		},
	});

const settle = async (): Promise<void> => {
	if (!harness) throw new Error("nothing mounted");
	for (let round = 0; round < 40; round += 1) {
		await harness.flush();
		await harness.wait(0);
	}
};

const mount = async (respond: (path: string) => unknown): Promise<void> => {
	http = mockFetch((call) => respond(call.path));
	harness = createDomHarness({ queryClient: appQueryClient() });
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

const responder =
	(endpoint: string, answer: () => Response) =>
	(path: string): unknown => {
		if (path.endsWith("/config")) return CONFIG;
		if (path.endsWith(endpoint)) return answer();
		return {};
	};

describe("a delete refused for its folder role", () => {
	it("opens the appointment prompt without taking the screen", async () => {
		await mount(responder("/messages/delete", refusal));

		await act(async () => {
			deleteMessages?.(["msg-1"]);
		});
		await settle();

		assert.match(harness?.text() ?? "", /Confirm this account's Trash folder/);
		assert.equal(
			getCurrentFatalError(),
			null,
			"a refusal the prompt answers is not a fatal error",
		);
	});

	it("still escalates a 500 on the same delete", async () => {
		await mount(responder("/messages/delete", broken));

		await act(async () => {
			deleteMessages?.(["msg-1"]);
		});
		await settle();

		assert.ok(
			getCurrentFatalError(),
			"the 409 opt-out must not cover anything else",
		);
	});
});

describe("a move refused for an unsettled placement", () => {
	it("states the wait in a banner without taking the screen", async () => {
		await mount(responder("/messages/move", unsettled));

		await act(async () => {
			moveMessages?.(["msg-1"], ARCHIVE);
		});
		await settle();

		assert.equal(
			getCurrentFatalError(),
			null,
			"a refusal the banner answers is not a fatal error",
		);
		assert.match(harness?.text() ?? "", /Couldn't move this message yet/);
		assert.match(harness?.text() ?? "", /Try again in a moment/);
	});

	it("still escalates a 500 on the same move", async () => {
		await mount(responder("/messages/move", broken));

		await act(async () => {
			moveMessages?.(["msg-1"], ARCHIVE);
		});
		await settle();

		assert.ok(
			getCurrentFatalError(),
			"the 409 opt-out must not cover anything else",
		);
	});
});

describe("an empty Trash refused for its folder role", () => {
	it("states the refusal in the pane without taking the screen", async () => {
		await mount(responder("/trash/empty", refusal));

		await act(async () => {
			trash?.emptyTrash();
		});
		await settle();

		assert.equal(trash?.refusal?.reason, "unconfirmed");
		assert.equal(getCurrentFatalError(), null);
	});
});
