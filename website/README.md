# Reader documentation site

The published documentation at `website/docs`, built by [tinyss](https://www.npmjs.com/package/create-tinyss).

- `npm run build` renders the site to `website/output`.
- `npm run dev` serves it on port 3100.

`.github/workflows/docs-site.yml` builds and deploys it to GitHub Pages on every push to `main` that touches `website/`.
