/**
 * Which routes mount the compose surface.
 *
 * `FullCompose` is mounted by the mailbox route only, so compose started from
 * anywhere else has to carry the user to a mailbox first — and compose left
 * open when the user walks off those routes has to close. `ComposeProvider`
 * decides both from here, and the mail layout binds `c` off the same answer.
 * A plain function with no React or API dependencies: a divergent second copy
 * is what left the mobile FAB dead on `/mail/flagged` and on the brief.
 */

/** `/mail/<segment>` values that name a view rather than a mailbox. */
const VIRTUAL_MAIL_VIEWS = new Set(["brief", "outbox", "flagged"]);

/**
 * True for `/mail/<id>` where `<id>` is a real mailbox.
 *
 * Compares whole path segments: a mailbox genuinely named `outbox-2024` hosts
 * the surface and must not be read as the virtual outbox.
 */
export const hostsComposeSurface = (pathname: string): boolean => {
	const [, root, view] = pathname.split(/[?#]/)[0].split("/");
	if (root !== "mail" || !view) return false;
	return !VIRTUAL_MAIL_VIEWS.has(view);
};
