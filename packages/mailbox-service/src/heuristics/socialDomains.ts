/**
 * Hand-curated allow-list of domains whose mail is treated as `social`.
 *
 * Sources are notifications from social/communication platforms. Match is
 * suffix-based on the From-domain (lowercase). `news.linkedin.com` matches
 * an entry of `linkedin.com`. Add new entries lowercase, no leading dot.
 *
 * Note: GitHub deliberately does NOT appear here. It is in
 * `transactionalDomains.ts` because the EDD prioritises receipts and
 * security alerts. The transactional rule fires before the social rule, so
 * placing GitHub in the transactional list ensures all GitHub mail surfaces
 * as `transactional`.
 */
export const SOCIAL_DOMAINS = [
	"linkedin.com",
	"x.com",
	"twitter.com",
	"facebook.com",
	"instagram.com",
	"meetup.com",
	"discord.com",
	"slack.com",
] as const;
