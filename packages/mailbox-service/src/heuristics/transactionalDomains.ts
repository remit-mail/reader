/**
 * Hand-curated allow-list of domains whose mail is treated as `transactional`.
 *
 * Sources are receipts, billing, security alerts, and similar
 * person-actionable but not promotional mail. GitHub appears here (security
 * alerts, billing receipts) and is intentionally NOT in the social allow-list
 * — we want a GitHub security alert to surface as `transactional`, not
 * `social`.
 *
 * Match is suffix-based on the From-domain (lowercase). `news.example.com`
 * matches an entry of `example.com`. Add new entries lowercase, no leading
 * dot.
 *
 * TODO: We deliberately do NOT seed banks here — the bank landscape is too
 * geographic, and a wrong allow-list entry causes silent mis-classification.
 * Banks should be added per-deployment by the operator.
 */
export const TRANSACTIONAL_DOMAINS = [
	"github.com",
	"stripe.com",
	"paypal.com",
	"square.com",
	"itunes.com",
	"apple.com",
	"google.com",
] as const;
