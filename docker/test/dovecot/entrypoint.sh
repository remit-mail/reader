#!/bin/sh
# Generate the passdb from the environment, then hand PID 1 to dovecot. The
# image already ships uid/gid 1000 as `vmail`; only the mail root and the
# generated passdb are missing.
#
# Every username authenticates with the same password and gets its own maildir
# (see dovecot.conf) — the suite relies on that for per-run isolation.
set -eu

password="${E2E_IMAP_PASSWORD:?E2E_IMAP_PASSWORD is required}"

cat >/etc/dovecot/e2e-passdb.conf <<EOF
passdb {
  driver = static
  args = password=$password allow_all_users=yes
}
EOF

mkdir -p /srv/mail
chown -R vmail:vmail /srv/mail

exec dovecot -F
