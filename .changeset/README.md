# Changesets

This directory holds [changesets](https://github.com/changesets/changesets): one
Markdown file per pending change, each declaring which `@remit/*` packages it
bumps and by how much.

Add one with `npx changeset` when a change should reach the published packages.
On merge to `main`, the publish pipeline consumes the accumulated changesets,
versions the affected packages, and publishes them under the public `@remit`
npm org.

`config.json` lists under `ignore` the packages that never publish yet — the
services still coupled to closed platform packages. Private packages (the web
client, workbench, and UI app) are skipped automatically.
