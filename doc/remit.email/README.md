# remit.email documentation site

The published documentation at `doc/remit.email/docs`, built by [tinyss](https://www.npmjs.com/package/create-tinyss).

- `npm run build` renders the site to `doc/remit.email/output`.
- `npm run dev` serves it on port 3100.

`.github/workflows/docs-site.yml` builds it on every push to `main` that touches `doc/remit.email/`, and publishes it to the root of the `gh-pages` branch. The Storybook lives beside it under `storybook/`, published by `.github/workflows/storybook-pages.yml`; neither publisher touches the other's tree.
