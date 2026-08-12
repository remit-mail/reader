import { NavLinkSurface } from "@remit/ui";
import type {
	AnyRouter,
	CreateLinkProps,
	LinkComponentProps,
	RegisteredRouter,
} from "@tanstack/react-router";
import { createLink } from "@tanstack/react-router";
import type { ReactElement } from "react";
import { type PanelFragment, useRetainOpenPanels } from "./fragment";

const RouterNavLink = createLink(NavLinkSurface);

/**
 * The router's own link props, minus the raw `hash`: the fragment tier is a
 * closed union of panel names, so `fragment` is the only way to write it.
 */
export type NavLinkProps<
	TRouter extends AnyRouter = RegisteredRouter,
	TFrom extends string = string,
	TTo extends string | undefined = undefined,
	TMaskFrom extends string = TFrom,
	TMaskTo extends string = "",
> = LinkComponentProps<
	typeof NavLinkSurface,
	TRouter,
	TFrom,
	TTo,
	TMaskFrom,
	TMaskTo
> & {
	fragment?: PanelFragment;
	/**
	 * Closed off rather than omitted: `Omit` over these props is a mapped type,
	 * and the router's `to` / `params` / `search` inference cannot see through
	 * one.
	 */
	hash?: never;
};

/**
 * The application's only navigation link. `createLink` keeps the router's `to` /
 * `params` / `search` inference, so a route that does not exist or a param set
 * that does not match it fails to compile instead of rendering a blank pane.
 *
 * A link that names no panel carries the open panes across: the rail is up
 * until the reader puts it down, and every row in a list is a link. Overlays
 * are left behind, because going somewhere is what dismisses one — and below
 * desktop so is the rail, which is a drawer over the message there.
 */
export function NavLink<
	TRouter extends AnyRouter = RegisteredRouter,
	const TFrom extends string = string,
	const TTo extends string | undefined = undefined,
	const TMaskFrom extends string = TFrom,
	const TMaskTo extends string = "",
>(props: NavLinkProps<TRouter, TFrom, TTo, TMaskFrom, TMaskTo>): ReactElement;
export function NavLink({
	fragment,
	...props
}: CreateLinkProps & { fragment?: PanelFragment }): ReactElement {
	const retainPanels = useRetainOpenPanels();
	return <RouterNavLink {...props} hash={fragment ?? retainPanels} />;
}
