/**
 * Classification against realistic mail, drawn from the senders reported in
 * issue #45 ("only personal and marketing seem to work").
 *
 * The rule table is easy to satisfy with synthetic one-header fixtures and
 * still wrong on real mail, because real bulk senders set several signals at
 * once. Every case here carries the full header set the sender actually emits,
 * so the test fails when rule ORDER regresses even though each individual rule
 * still works.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { MessageCategory } from "@remit/domain-enums";
import { simpleParser } from "mailparser";
import { classifyByHeaders } from "./classifyByHeaders.js";

const classify = async (lines: string[]) =>
	classifyByHeaders(await simpleParser(Buffer.from(lines.join("\r\n"))));

describe("classifyByHeaders on realistic mail", () => {
	describe("platform notifications", () => {
		it("classifies an npm publish notification as automated", async () => {
			const category = await classify([
				"From: npm <notifications@npmjs.com>",
				"To: me@example.com",
				"Subject: A new version of left-pad was published",
				"DKIM-Signature: v=1; a=rsa-sha256; d=npmjs.com; s=s1; h=from:to",
				"Content-Type: text/plain",
				"",
				"published",
			]);
			assert.equal(category, MessageCategory.automated);
		});

		it("classifies an npm mail relayed through SES as automated", async () => {
			const category = await classify([
				"Return-Path: <bounces@amazonses.com>",
				"From: npm <support@npmjs.com>",
				"To: me@example.com",
				"Subject: A new device signed in to your npm account",
				"Feedback-ID: 1.eu-west-1.abc:AmazonSES",
				"DKIM-Signature: v=1; a=rsa-sha256; d=amazonses.com; s=x; h=from:to",
				"Content-Type: text/html",
				"",
				"<p>signed in</p>",
			]);
			assert.equal(category, MessageCategory.automated);
		});

		it("classifies a no-reply notification with no bulk headers as automated", async () => {
			// The reported npm case: one-to-one machine mail, aligned DKIM, and no
			// List-* or Precedence header at all. It used to reach the `personal`
			// fallback and sit among real correspondence.
			const category = await classify([
				"From: CircleCI <no-reply@circleci.com>",
				"To: me@example.com",
				"Subject: Your build failed",
				"DKIM-Signature: v=1; a=rsa-sha256; d=circleci.com; s=s1; h=from:to",
				"Content-Type: text/plain",
				"",
				"build failed",
			]);
			assert.equal(category, MessageCategory.automated);
		});

		it("classifies X-Auto-Response-Suppress mail as automated", async () => {
			const category = await classify([
				"From: Helpdesk <ticketing@corp.example>",
				"To: me@example.com",
				"Subject: Ticket 4711 updated",
				"X-Auto-Response-Suppress: All",
				"Content-Type: text/plain",
				"",
				"updated",
			]);
			assert.equal(category, MessageCategory.automated);
		});
	});

	describe("allow-listed sender domains outrank bulk headers", () => {
		it("classifies a GitHub pull-request notification as transactional", async () => {
			// GitHub sets List-ID, List-Unsubscribe AND Precedence: list. Before the
			// reorder, Precedence matched first and every GitHub mail — security
			// alerts and receipts included — landed in `automated`, contradicting
			// the reason GitHub is on the transactional allow-list at all.
			const category = await classify([
				"From: contributor <notifications@github.com>",
				"To: me@example.com",
				"Subject: Re: [org/repo] Fix the thing (PR #45)",
				"List-ID: org/repo <repo.org.github.com>",
				"List-Unsubscribe: <https://github.com/unsub>",
				"Precedence: list",
				"DKIM-Signature: v=1; a=rsa-sha256; d=github.com; s=pf2014; h=from:to",
				"Content-Type: text/plain",
				"",
				"comment",
			]);
			assert.equal(category, MessageCategory.transactional);
		});

		it("classifies a GitHub security alert as transactional", async () => {
			const category = await classify([
				"From: GitHub <noreply@github.com>",
				"To: me@example.com",
				"Subject: [org/repo] Dependabot alert",
				"Precedence: bulk",
				"Content-Type: text/plain",
				"",
				"alert",
			]);
			assert.equal(category, MessageCategory.transactional);
		});

		it("classifies a LinkedIn notification as social", async () => {
			// The reported LinkedIn case. List-Unsubscribe matched before the social
			// allow-list, so LinkedIn mail was filed as generic `marketing` and the
			// Social bucket stayed empty.
			const category = await classify([
				"Return-Path: <s-hbhcfzp@bounce.linkedin.com>",
				"From: LinkedIn <messages-noreply@linkedin.com>",
				"To: me@example.com",
				"Subject: You have a new invitation",
				"List-Unsubscribe: <https://www.linkedin.com/e/unsub>",
				"DKIM-Signature: v=1; a=rsa-sha256; d=linkedin.com; s=proddkim; h=from:to",
				"Content-Type: text/html",
				"",
				"<p>invitation</p>",
			]);
			assert.equal(category, MessageCategory.social);
		});

		it("classifies a LinkedIn job alert from a subdomain as social", async () => {
			const category = await classify([
				"From: LinkedIn Job Alerts <jobalerts-noreply@e.linkedin.com>",
				"To: me@example.com",
				"Subject: 20 new jobs for you",
				"Precedence: bulk",
				"List-Unsubscribe: <https://www.linkedin.com/e/unsub>",
				"Content-Type: text/html",
				"",
				"<p>jobs</p>",
			]);
			assert.equal(category, MessageCategory.social);
		});
	});

	describe("bulk mail keeps its intent bucket", () => {
		it("classifies a marketing blast that also sets Precedence: bulk as marketing", async () => {
			// Nearly every marketing platform sets Precedence: bulk. Matching it
			// first swallowed the whole Marketing bucket into `automated`.
			const category = await classify([
				"From: Shop <deals@shop.example>",
				"To: me@example.com",
				"Subject: 50% off everything",
				"Precedence: bulk",
				"List-Unsubscribe: <https://shop.example/unsub>",
				"List-Unsubscribe-Post: List-Unsubscribe=One-Click",
				"Content-Type: text/html",
				"",
				"<p>sale</p>",
			]);
			assert.equal(category, MessageCategory.marketing);
		});

		it("classifies a newsletter that also sets Precedence: list as newsletter", async () => {
			const category = await classify([
				"From: Some Writer <writer@substack.example>",
				"To: me@example.com",
				"Subject: This week's issue",
				"Precedence: list",
				"List-ID: <someletter.substack.example>",
				"List-Unsubscribe: <https://substack.example/unsub>",
				"Content-Type: text/html",
				"",
				"<p>news</p>",
			]);
			assert.equal(category, MessageCategory.newsletter);
		});

		it("classifies a mailing-list post as newsletter, not automated", async () => {
			const category = await classify([
				"From: Contributor <dev@lists.example>",
				"To: dev@lists.example",
				"Subject: [PATCH v2] fix the parser",
				"Precedence: list",
				"List-ID: <dev.lists.example>",
				"List-Unsubscribe: <mailto:dev-unsubscribe@lists.example>",
				"Content-Type: text/plain",
				"",
				"patch",
			]);
			assert.equal(category, MessageCategory.newsletter);
		});
	});

	describe("personal mail stays personal", () => {
		it("classifies a person writing from Gmail as personal", async () => {
			const category = await classify([
				"From: Alice <alice@gmail.com>",
				"To: me@example.com",
				"Subject: lunch?",
				"DKIM-Signature: v=1; a=rsa-sha256; d=gmail.com; s=20230601; h=from:to",
				"Content-Type: text/plain",
				"",
				"lunch tomorrow?",
			]);
			assert.equal(category, MessageCategory.personal);
		});

		it("does not treat a human support mailbox as a machine sender", async () => {
			// `support@` is answered by people. Adding it to the machine local-parts
			// would quietly bury real correspondence in `automated`.
			const category = await classify([
				"From: Acme Support <support@acme.example>",
				"To: me@example.com",
				"Subject: Re: your question",
				"Content-Type: text/plain",
				"",
				"answering your question",
			]);
			assert.equal(category, MessageCategory.personal);
		});

		it("classifies a calendar invite from a colleague as transactional", async () => {
			const category = await classify([
				"From: Bob <bob@corp.example>",
				"To: me@example.com",
				"Subject: Invitation: standup",
				'Content-Type: multipart/mixed; boundary="b1"',
				"",
				"--b1",
				"Content-Type: text/calendar; method=REQUEST",
				"",
				"BEGIN:VCALENDAR",
				"END:VCALENDAR",
				"--b1--",
			]);
			assert.equal(category, MessageCategory.transactional);
		});
	});
});
