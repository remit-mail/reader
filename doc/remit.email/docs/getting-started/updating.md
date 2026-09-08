---
title: Updating
description: One click in the app, or one command at a shell.
---

# Updating

Reader ships versioned releases. When one is available, any signed-in user of the instance sees the offer in the app and installs it with a click. Nothing updates without that consent: the instance checks for releases on its own, and checking only reports.

The same update runs from a shell:

```bash
remit update            # install the current release
remit update --check    # report what is available, change nothing
```

An update takes the instance offline while it runs. Before anything stops, the updater snapshots both databases; after the new version starts, a gate checks migrations, health and the API before the full stack comes back. A failed update restores the snapshot and the earlier version on its own.

`remit status` reports the running version, the last check and the last update's outcome.

That is all an operator needs day to day. The full sequence, the rollback mechanics and how to pin or hold back releases are in [operations: updating](../../operations/updating/).
