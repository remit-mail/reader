# Storybook structure

One Storybook, `packages/workbench/.storybook`, with two roots. `npm-scripts/check-storybook-titles.mjs` enforces them from `test:scripts`.

## Design System

`Design System/<group>/<component>` holds `packages/ui` stories only: one component per file, one story per component state. It sorts first. A component no web-client source mounts carries the `proposed` tag, so the tag marks what is not live yet.

## Playground

`Playground/Shipped/<route>` holds what the app ships: `packages/web-client` stories, and `packages/ui` compositions a web-client route mounts.

`Playground/Proposed/<feature>` holds screens nobody has built yet: `packages/workbench` prototypes, and `packages/ui` compositions no route mounts. Every story here carries the `proposed` tag in its meta:

```ts
const meta = {
	title: "Playground/Proposed/Drafts",
	tags: ["proposed"],
} satisfies Meta;
```

## Graduation

The PR that ships a route moves its story to `Playground/Shipped/<route>` in web-client. The same PR deletes the workbench prototype and drops the `proposed` tag from the ui parts it now uses.

## The check

A story fails when its title sits outside its package's roots (ui: any root; web-client: `Playground/Shipped`; workbench: `Playground/Proposed`), when its meta has no literal `title`, or when a `Playground/Proposed` story lacks the `proposed` tag.

A `packages/ui` story also fails when its `proposed` tag disagrees with web-client. The check follows every value import of `@remit/ui` in web-client source, less stories, tests, fixtures and `test-support`, through the package exports to a ui module, then through that module's own imports. A story whose component is reached must not carry the tag; one whose component is not reached must. The component is the story's sibling module, or every ui module the story imports when it has none. Comments, strings and type-only imports do not count.

The graph sees imports, not props: a state behind a prop web-client never passes, such as the IntelligencePanel calendar tab, counts as mounted.

## The web-client story frame

A `Playground/Shipped` route story mounts the real app, not a copy of its shell. `AppStory` in `packages/web-client/src/story-frame` builds the app router on a memory history at the story's `url`, with its own query client. The route's loaders and queries run against MSW: `mailHandlers(mailWorld())` answers the API from fixture accounts, folders, threads and outbox messages, and an `/api/*` request without a handler fails with a 501 that names it. Requests outside `/api` pass through untouched.

```tsx
const meta = {
	title: "Playground/Shipped/Mail/Outbox",
	component: AppStory,
	args: { url: "/mail/outbox" },
	parameters: { msw: { handlers: mailHandlers(mailWorld()) } },
} satisfies Meta<typeof AppStory>;
```

A state is a different world (`mailWorld({ outbox: [] })`), a handler option (`withholdCounts`, `pageSize`, `holdLaterPages`), a different address or a play step, never a prop the app does not have. Fixture times sit on a fixed clock. A phone story sets `globals: { viewport: { value: "mobile" } }`, because the shell reads its tier off the viewport.
