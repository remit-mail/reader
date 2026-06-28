/**
 * The rescue banner appears above a folder only when it's the Spam folder AND
 * the loaded pages hold suspected-safe messages. This pins the gate MailboxList
 * uses (`isSpamFolder && rescueCandidates.length > 0`) by composing the real
 * candidate builder with the real banner, no app providers needed.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { RemitImapThreadMessageResponse } from "@remit/api-http-client/types.gen.ts";
import { RescueBanner } from "@remit/ui";
import React, { createElement } from "react";
import { renderToString } from "react-dom/server";
import { buildRescueCandidates } from "@/lib/rescue-candidates";

(globalThis as { React?: typeof React }).React = React;

const noop = () => {};

function thread(
	overrides: Partial<RemitImapThreadMessageResponse> &
		Pick<RemitImapThreadMessageResponse, "messageId" | "senderTrust">,
): RemitImapThreadMessageResponse {
	return {
		threadMessageId: `tm-${overrides.messageId}`,
		threadId: `t-${overrides.messageId}`,
		accountConfigId: "acc",
		mailboxId: "mb-junk",
		sentDate: 1,
		isRead: false,
		hasAttachment: false,
		hasStars: false,
		isDeleted: false,
		createdAt: 1,
		updatedAt: 1,
		fromName: "Anna",
		fromEmail: "anna@x.nl",
		subject: "Hi",
		snippet: "...",
		...overrides,
	} as RemitImapThreadMessageResponse;
}

const renderBanner = (
	threads: RemitImapThreadMessageResponse[],
	isSpamFolder: boolean,
): string => {
	const candidates = buildRescueCandidates(threads, isSpamFolder);
	if (candidates.length === 0) return "";
	return renderToString(
		createElement(RescueBanner, { count: candidates.length, onReview: noop }),
	);
};

describe("rescue banner visibility gate", () => {
	const verified = [
		thread({ messageId: "m1", senderTrust: "wellknown" }),
		thread({ messageId: "m2", senderTrust: "vip" }),
	];

	it("shows the banner with the candidate count on the Spam folder", () => {
		const html = renderBanner(verified, true);
		assert.match(html, /2 messages here/);
	});

	it("stays hidden on the Spam folder when no message is safe", () => {
		const onlyNoise = [thread({ messageId: "m3", senderTrust: "unknown" })];
		assert.equal(renderBanner(onlyNoise, true), "");
	});

	it("stays hidden off the Spam folder even with verified senders", () => {
		assert.equal(renderBanner(verified, false), "");
	});
});
