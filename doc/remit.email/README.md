# remit.email documentation site

The published documentation at `doc/remit.email/docs`, built by [tinyss](https://www.npmjs.com/package/create-tinyss).

A workspace of the root manifest, so it installs with the rest of the repository and its template is compiled by `npm run typecheck`.

- `npm run build -w @remit/docs-site` renders the site to `doc/remit.email/output`.
- `npm run dev -w @remit/docs-site` serves it on port 3100.

`.github/workflows/docs-site.yml` builds it on every push to `main` that touches `doc/remit.email/`, and publishes it to the root of the `gh-pages` branch. The Storybook lives beside it under `storybook/`, published by `.github/workflows/storybook-pages.yml`; neither publisher touches the other's tree.
