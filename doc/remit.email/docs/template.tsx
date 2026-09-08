import type { Page, TemplateProps } from "create-tinyss/src/core/types.ts";
import { h, type JSX } from "preact";

interface NavGroup {
	section: string;
	items: string[];
}

const CSS = `
:root {
	--sidebar: 17rem;
	--measure: 44rem;
	--bg: #ffffff;
	--bg-soft: #f6f7f8;
	--text: #16181d;
	--muted: #5b6270;
	--rule: #dfe3e8;
	--link: #1c4fd8;
	--code-bg: #f0f2f4;
	--font: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
	--mono: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace;
	color-scheme: light dark;
}

@media (prefers-color-scheme: dark) {
	:root {
		--bg: #14161a;
		--bg-soft: #191c21;
		--text: #e6e8ec;
		--muted: #9aa2b1;
		--rule: #2b3038;
		--link: #8fb4ff;
		--code-bg: #22262d;
	}
}

* { box-sizing: border-box; }

body {
	margin: 0;
	background: var(--bg);
	color: var(--text);
	font-family: var(--font);
	font-size: 1rem;
	line-height: 1.65;
	-webkit-text-size-adjust: 100%;
}

a { color: var(--link); }

.skip {
	position: absolute;
	left: -9999px;
}

.skip:focus {
	left: 1rem;
	top: 1rem;
	z-index: 20;
	background: var(--bg);
	border: 1px solid var(--rule);
	padding: 0.5rem 0.75rem;
}

.layout {
	display: flex;
	align-items: flex-start;
	gap: 0;
}

.sidebar {
	position: sticky;
	top: 0;
	flex: 0 0 var(--sidebar);
	width: var(--sidebar);
	height: 100vh;
	overflow-y: auto;
	padding: 2rem 1.25rem;
	background: var(--bg-soft);
	border-right: 1px solid var(--rule);
}

.brand {
	display: inline-block;
	font-size: 1.05rem;
	font-weight: 650;
	letter-spacing: -0.01em;
	color: var(--text);
	text-decoration: none;
	margin-bottom: 1.5rem;
}

.nav-group {
	margin-bottom: 1.5rem;
}

.nav-heading {
	margin: 0 0 0.4rem;
	font-size: 0.7rem;
	font-weight: 650;
	text-transform: uppercase;
	letter-spacing: 0.08em;
	color: var(--muted);
}

.nav-list {
	list-style: none;
	margin: 0;
	padding: 0;
}

.nav-list a {
	display: block;
	padding: 0.25rem 0.5rem;
	margin-left: -0.5rem;
	border-radius: 4px;
	font-size: 0.925rem;
	color: var(--text);
	text-decoration: none;
}

.nav-list a:hover { background: var(--code-bg); }

.nav-list a[aria-current="page"] {
	color: var(--link);
	font-weight: 600;
}

.nav-group-elsewhere {
	padding-top: 1rem;
	border-top: 1px solid var(--rule);
}

.main {
	flex: 1 1 auto;
	min-width: 0;
	padding: 2.5rem 2rem 5rem;
}

.prose {
	max-width: var(--measure);
}

.prose > :first-child { margin-top: 0; }

.prose h1 {
	font-size: 1.9rem;
	line-height: 1.2;
	letter-spacing: -0.02em;
	margin: 0 0 1.25rem;
}

.prose h2 {
	font-size: 1.3rem;
	margin: 2.5rem 0 0.75rem;
	padding-bottom: 0.3rem;
	border-bottom: 1px solid var(--rule);
}

.prose h3 {
	font-size: 1.05rem;
	margin: 1.75rem 0 0.5rem;
}

.prose p, .prose ul, .prose ol { margin: 0 0 1rem; }
.prose li { margin-bottom: 0.25rem; }

.prose code {
	font-family: var(--mono);
	font-size: 0.875em;
	background: var(--code-bg);
	padding: 0.1em 0.35em;
	border-radius: 3px;
}

.prose pre {
	background: var(--code-bg);
	padding: 0.9rem 1rem;
	border-radius: 6px;
	overflow-x: auto;
	line-height: 1.5;
	margin: 0 0 1.25rem;
}

.prose pre code {
	background: none;
	padding: 0;
	font-size: 0.85rem;
}

.prose blockquote {
	margin: 0 0 1rem;
	padding-left: 1rem;
	border-left: 3px solid var(--rule);
	color: var(--muted);
}

.prose table {
	width: 100%;
	border-collapse: collapse;
	margin: 0 0 1.25rem;
	font-size: 0.925rem;
	display: block;
	overflow-x: auto;
}

.prose th, .prose td {
	border: 1px solid var(--rule);
	padding: 0.45rem 0.7rem;
	text-align: left;
	vertical-align: top;
}

.prose th { background: var(--bg-soft); }

.prose hr {
	border: 0;
	border-top: 1px solid var(--rule);
	margin: 2rem 0;
}

.prose img { max-width: 100%; height: auto; }

.footer {
	max-width: var(--measure);
	margin-top: 3rem;
	padding-top: 1rem;
	border-top: 1px solid var(--rule);
	font-size: 0.85rem;
	color: var(--muted);
}

@media (max-width: 52rem) {
	.layout { display: block; }

	.sidebar {
		position: static;
		width: auto;
		height: auto;
		border-right: 0;
		border-bottom: 1px solid var(--rule);
		padding: 1.25rem 1rem;
	}

	.nav-group { margin-bottom: 1rem; }
	.main { padding: 1.75rem 1rem 3rem; }
}
`;

const pagePath = (href: string): string => href.replace(/index\.html$/, "");

const prefixFor = (href: string): string => {
	const segments = pagePath(href).split("/").filter(Boolean);
	return "../".repeat(segments.length);
};

const isNavGroup = (value: unknown): value is Partial<NavGroup> =>
	typeof value === "object" && value !== null && "items" in value;

const readNav = (config: Record<string, unknown>): NavGroup[] => {
	const nav = config.nav;
	if (!Array.isArray(nav)) return [];
	return nav.filter(isNavGroup).map((group) => ({
		section: typeof group.section === "string" ? group.section : "",
		items: Array.isArray(group.items) ? group.items.map(String) : [],
	}));
};

const findBySource = (pages: Page[], item: string): Page | undefined =>
	pages.find(
		(page) => page.source === item || page.source.endsWith(`/${item}`),
	);

const NavLink = (page: Page, prefix: string, current: string): JSX.Element =>
	h(
		"li",
		null,
		h(
			"a",
			{
				href: `${prefix}${pagePath(page.href)}` || "./",
				"aria-current": page.href === current ? "page" : undefined,
			},
			page.title,
		),
	);

const NavGroupView = (
	group: NavGroup,
	pages: Page[],
	prefix: string,
	current: string,
): JSX.Element =>
	h(
		"div",
		{ class: "nav-group" },
		group.section ? h("h2", { class: "nav-heading" }, group.section) : null,
		h(
			"ul",
			{ class: "nav-list" },
			...group.items
				.map((item) => findBySource(pages, item))
				.filter((page): page is Page => page !== undefined)
				.map((page) => NavLink(page, prefix, current)),
		),
	);

// The Storybook is published to `storybook/` on the same Pages branch this
// site's root is published to, so a relative href from the current page's depth
// reaches it whatever prefix the site is served under.
const ElsewhereView = (prefix: string, repository: string): JSX.Element =>
	h(
		"div",
		{ class: "nav-group nav-group-elsewhere" },
		h("h2", { class: "nav-heading" }, "Elsewhere"),
		h(
			"ul",
			{ class: "nav-list" },
			h("li", null, h("a", { href: `${prefix}storybook/` }, "Storybook")),
			repository ? h("li", null, h("a", { href: repository }, "GitHub")) : null,
		),
	);

export default function ReaderDocsTemplate({
	title,
	body,
	config,
	pages,
}: TemplateProps): JSX.Element {
	const siteTitle = typeof config.title === "string" ? config.title : "Reader";
	const repository =
		typeof config.repository === "string" ? config.repository : "";
	const current = pages.find((page) => page.title === title);
	const currentHref = current?.href ?? "index.html";
	const prefix = prefixFor(currentHref);
	const description = current?.extensions?.description;

	return h(
		"html",
		{ lang: "en" },
		h(
			"head",
			null,
			h("meta", { charset: "utf-8" }),
			h("meta", {
				name: "viewport",
				content: "width=device-width,initial-scale=1",
			}),
			h(
				"title",
				null,
				title === siteTitle ? siteTitle : `${title} — ${siteTitle}`,
			),
			typeof description === "string"
				? h("meta", { name: "description", content: description })
				: null,
			h("style", { dangerouslySetInnerHTML: { __html: CSS } }),
		),
		h(
			"body",
			null,
			h("a", { class: "skip", href: "#content" }, "Skip to content"),
			h(
				"div",
				{ class: "layout" },
				h(
					"nav",
					{ class: "sidebar", "aria-label": "Documentation" },
					h(
						"a",
						{
							class: "brand",
							href: prefix || "./",
							"aria-current": prefix === "" ? "page" : undefined,
						},
						siteTitle,
					),
					...readNav(config).map((group) =>
						NavGroupView(group, pages, prefix, currentHref),
					),
					ElsewhereView(prefix, repository),
				),
				h(
					"main",
					{ class: "main", id: "content" },
					h("article", {
						class: "prose",
						dangerouslySetInnerHTML: { __html: body },
					}),
					repository
						? h(
								"footer",
								{ class: "footer" },
								"Source and issues: ",
								h("a", { href: repository }, repository),
							)
						: null,
				),
			),
		),
	);
}
