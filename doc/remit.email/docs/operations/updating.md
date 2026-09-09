---
title: Updating in depth
description: Snapshot, migrate, gate, and roll back on failure. All of it automatic.
---

# Updating in depth

An update can come from two places, and both run the same sequence: a click in the app, through the `updater` container, or `remit update` at a shell.

## Discovery

Discovery is the manifest and nothing else. The default `REMIT_UPDATE_MANIFEST_URL` is the `stable.json` asset of the latest published GitHub release. A tag present in the registry is not an offer on its own. Clear the URL and no check happens at all; point it at your own HTTPS URL serving the same JSON to hold releases back or run a fork. The updater checks on its own every six hours, and checking only reports.

## The sequence

An update takes the instance offline while it runs; Caddy stays up and serves 502s. In order:

1. The updater fetches and validates the manifest. It refuses a version at or below the running one, and a manifest naming images from outside its own registry.
2. It pulls every image at the target version. A failure here has touched nothing.
3. It snapshots both databases with `VACUUM INTO` while the old version is still live.
4. It writes the new tag to `.env` before anything stops. A host that reboots mid-update comes back on binaries that match the migrated database.
5. Everything stops. Only the queue, the migrator and the backend start, so the stack serves nothing and sends nothing between snapshot and verdict.
6. The gate: migrations exited 0, every recreated service is healthy, and `/health` answers three times in a row, within 300 seconds.
7. On a pass, the held-back services start. On a failure, the updater restores the snapshot and the earlier tag, and the gate runs again.

`remit status` reports the running version and the last run's outcome. The check also reports both schema versions, the running one and the target's, so you know before installing whether this update migrates the database.

## When it goes wrong

A killed updater recovers on its next start: `remit update --recover` reads the breadcrumb and branches on the recorded phase. The lock is an `flock`, so a killed updater never locks out its own recovery.

`rolledBack` means the failed update undid itself. `rollbackFailed` is the one outcome that needs you: the pre-update snapshot is still on the updater's volume under `snapshots/<runId>/`, so restore it over `sqlite_data` as uid 1000, put the earlier tag in `.env`, and `remit restart`.

To go back on purpose, `remit update --tag <the last working tag>`. It takes the same gate and the same rollback. Practise it once before you need it.
