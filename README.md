# Static asset branch — label UX ticketing

Orphan branch holding screenshots embedded in the label-surface UX-design
issues (filed against #325 / #26, plus updated screenshots on #296). Not for
merge into `main`.

Screenshots are captured from Storybook (branch `label-http-api`, PR #323) at
1440x900, light and dark theme where relevant. A few surfaces had no existing
story (the Settings > Labels page, the cascade delete confirmation, the
filters list, label chips on message rows) — those are captured through a
temporary, uncommitted Storybook story that renders the real production
components (`LabelsList`, `FiltersList`, `ConfirmDialog` +
`deleteLabelConfirmCopy`, `message-row`, `label-chip`) with representative
fixture data, not a mockup.
