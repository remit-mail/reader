/**
 * Mail seeded so the deployment's classifier can be measured end to end
 * (issue #45: "only personal and marketing seem to work").
 *
 * Each fixture carries the header set its real sender actually emits, not the
 * single header that happens to trigger a rule. Real bulk senders set several
 * signals at once — a marketing blast is `Precedence: bulk` AND
 * `List-Unsubscribe`, a GitHub notification is `Precedence: list` AND `List-ID`
 * AND an allow-listed domain — and the reported defect was entirely about which
 * of those the classifier looked at first.
 *
 * These are appended before the account is connected, alongside the other seed
 * mail: mail that arrives after onboarding does not reach the API on a
 * triggered sync (see the annotated spec in `sync.spec.ts`), so seeding here is
 * what keeps this suite measuring classification rather than that defect.
 */
import type { Message } from "./imap.js";

export interface ClassificationFixture {
	subject: string;
	expectedCategory: string;
	message: Message;
}

const uniqueSuffix = (): string => Math.random().toString(36).slice(2, 8);

export const buildClassificationFixtures = (): ClassificationFixture[] => {
	const tag = uniqueSuffix();

	const fixtures: ClassificationFixture[] = [
		{
			subject: `Your build failed ${tag}`,
			expectedCategory: "automated",
			message: {
				subject: `Your build failed ${tag}`,
				from: "CircleCI <no-reply@circleci.test>",
				headers: {
					"DKIM-Signature":
						"v=1; a=rsa-sha256; d=circleci.test; s=s1; h=from:to",
				},
			},
		},
		{
			subject: `A new version was published ${tag}`,
			expectedCategory: "automated",
			// The reported npm shape: one-to-one machine mail with no List-* and no
			// Precedence header at all. It used to reach the `personal` fallback.
			message: {
				subject: `A new version was published ${tag}`,
				from: "npm <notifications@npmjs.test>",
				headers: { "Feedback-ID": "1.eu-west-1.abc:AmazonSES" },
			},
		},
		{
			subject: `50% off everything ${tag}`,
			expectedCategory: "marketing",
			// Precedence: bulk used to outrank List-Unsubscribe, which swallowed
			// the whole Marketing bucket into `automated`.
			message: {
				subject: `50% off everything ${tag}`,
				from: "Shop <deals@shop.test>",
				headers: {
					Precedence: "bulk",
					"List-Unsubscribe": "<https://shop.test/unsub>",
					"List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
				},
			},
		},
		{
			subject: `This week's issue ${tag}`,
			expectedCategory: "newsletter",
			message: {
				subject: `This week's issue ${tag}`,
				from: "Some Writer <writer@letter.test>",
				headers: {
					Precedence: "list",
					"List-ID": "<someletter.letter.test>",
					"List-Unsubscribe": "<https://letter.test/unsub>",
				},
			},
		},
		{
			subject: `You have a new invitation ${tag}`,
			expectedCategory: "social",
			// The reported LinkedIn shape: List-Unsubscribe used to match before
			// the social allow-list, so LinkedIn mail was filed as `marketing`.
			message: {
				subject: `You have a new invitation ${tag}`,
				from: "LinkedIn <messages-noreply@linkedin.com>",
				headers: {
					"List-Unsubscribe": "<https://www.linkedin.com/e/unsub>",
				},
			},
		},
		{
			subject: `[org/repo] Fix the thing ${tag}`,
			expectedCategory: "transactional",
			// GitHub sets Precedence: list, so every GitHub mail — security alerts
			// included — used to land in `automated`.
			message: {
				subject: `[org/repo] Fix the thing ${tag}`,
				from: "contributor <notifications@github.com>",
				headers: {
					Precedence: "list",
					"List-ID": "org/repo <repo.org.github.com>",
					"List-Unsubscribe": "<https://github.com/unsub>",
				},
			},
		},
		{
			subject: `Lunch tomorrow ${tag}`,
			expectedCategory: "personal",
			// The control: a person writing to a person must not be swept up by
			// any of the rules above.
			message: {
				subject: `Lunch tomorrow ${tag}`,
				from: "Alice <alice@friends.test>",
			},
		},
	];

	return fixtures;
};
