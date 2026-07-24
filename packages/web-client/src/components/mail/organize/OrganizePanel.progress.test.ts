/**
 * The back-apply progress copy. On a deployment without the vector pipeline the
 * "all like these" job moves the sender-matched set, so the in-progress line must
 * state the sender semantics — never "similar mail" (#250's honesty
 * requirement). The semantic path keeps the "similar mail" wording.
 */

import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { mailboxOperationsListMailboxesQueryKey } from "@remit/api-http-client/@tanstack/react-query.gen.ts";
import { createElement } from "react";
import type { OrganizeMatchPredicate } from "../../../lib/organize/sender-fallback";
import { createDomHarness, type DomHarness } from "../../../test-support/dom";
import { makeMailbox } from "../../../test-support/fixtures";
import { type HttpMock, mockFetch } from "../../../test-support/http";
import { OrganizePanel } from "./OrganizePanel";

let harness: DomHarness | undefined;
let http: HttpMock | undefined;

afterEach(() => {
	harness?.close();
	harness = undefined;
	http?.restore();
	http = undefined;
});

const ACCOUNT_ID = "acc-1";

const MAILBOXES = [
	makeMailbox({ mailboxId: "mbx-inbox", fullPath: "INBOX" }),
	makeMailbox({ mailboxId: "mbx-archive", fullPath: "Archive" }),
];

const SEMANTIC_PREDICATE: OrganizeMatchPredicate = {
	anchorMessageId: "msg-1",
	matchOperator: "And",
	literalClauses: [],
};

const SENDER_PREDICATE: OrganizeMatchPredicate = {
	matchOperator: "Or",
	literalClauses: [{ field: "From", value: "npm@github.com" }],
};

const mount = (
	props: Partial<Parameters<typeof OrganizePanel>[0]>,
): DomHarness => {
	http = mockFetch((call) => {
		if (call.path.endsWith("/organize") && call.method === "POST") {
			return { organizeJobId: "job-1", state: "Processing" };
		}
		if (call.path.endsWith("/organize/job-1") && call.method === "GET") {
			return {
				organizeJobId: "job-1",
				state: "Processing",
				matchedCount: 128,
				appliedCount: 0,
				failedCount: 0,
			};
		}
		return {};
	});
	harness = createDomHarness();
	harness.queryClient.setQueryData(
		mailboxOperationsListMailboxesQueryKey({ path: { accountId: ACCOUNT_ID } }),
		{ items: MAILBOXES },
	);
	harness.renderApp(
		createElement(OrganizePanel, {
			accountId: ACCOUNT_ID,
			mailboxId: "mbx-inbox",
			selectedMessageIds: ["msg-1", "msg-2"],
			matchPredicate: SEMANTIC_PREDICATE,
			matchedCount: 128,
			seedMailboxId: "mbx-archive",
			onClose: () => undefined,
			...props,
		}),
	);
	return harness;
};

async function startJob(dom: DomHarness): Promise<void> {
	dom.click(dom.byText("button", "Organize"));
	for (let attempt = 0; attempt < 20; attempt += 1) {
		await dom.flush();
		if (/Organizing/.test(dom.text())) return;
		await dom.wait(1);
	}
}

describe("OrganizePanel back-apply progress copy", () => {
	it("states the sender semantics while organizing in the sender fallback", async () => {
		const dom = mount({
			matchPredicate: SENDER_PREDICATE,
			semanticUnavailable: true,
			senders: ["npm@github.com"],
		});
		await startJob(dom);

		assert.match(dom.text(), /Organizing mail from these senders/);
		assert.doesNotMatch(dom.text(), /Organizing similar mail/);
	});

	it("keeps the similar-mail wording on the semantic path", async () => {
		const dom = mount({});
		await startJob(dom);

		assert.match(dom.text(), /Organizing similar mail/);
		assert.doesNotMatch(dom.text(), /from these senders/);
	});
});
