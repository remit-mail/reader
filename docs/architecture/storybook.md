# Storybook structure

One Storybook, `packages/workbench/.storybook`, with two roots. `npm-scripts/check-storybook-titles.mjs` enforces them from `test:scripts`.

## Design System

`Design System/<group>/<component>` holds `packages/ui` stories only: one component per file, one story per component state. It sorts first.

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
