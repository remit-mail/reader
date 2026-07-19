#!/bin/sh
# Write the single-user passdb from the environment, then hand PID 1 to dovecot.
# The image already ships uid/gid 1000 as `vmail`; only the mail root and the
# users file are missing.
set -eu

user="${E2E_IMAP_USER:?E2E_IMAP_USER is required}"
password="${E2E_IMAP_PASSWORD:?E2E_IMAP_PASSWORD is required}"

mkdir -p /srv/mail/Maildir/cur /srv/mail/Maildir/new /srv/mail/Maildir/tmp
printf '%s:{PLAIN}%s:1000:1000::/srv/mail\n' "$user" "$password" >/etc/dovecot/users
chown -R vmail:vmail /srv/mail

exec dovecot -F
