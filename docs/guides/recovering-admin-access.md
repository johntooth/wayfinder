# Recovering admin access

What to do when nobody can sign in to Wayfinder as an administrator.

This is a break-glass runbook. It requires shell access to the deployment and
its database — deliberately, because that is what keeps it from being a way in
for anyone else.

---

## When you need this

**The usual cause is a Microsoft Entra ID outage.**

Entra takes precedence over a password in Wayfinder: the first time an account
signs in through Entra, its email/password credential is deleted. That is
intended, and it is what protects an account from someone who registered a
password against the same address before the real owner arrived.

The consequence is that a deployment which has moved its administrators onto
Entra has no local passwords left. If Entra then stops working, there is nothing
to fall back on:

- the client secret in the Azure app registration expired
- the app registration was deleted, or its redirect URI changed
- the tenant is unreachable, or the app's access to it was revoked
- Entra was enabled with the wrong tenant/client values and saved

Sign-in fails at Microsoft, email/password is either switched off or has no
credential to check, and **Settings → General → Authentication** — the one place
those settings can be changed — sits behind the login that no longer works.

### Symptoms

- **Sign in with Microsoft** returns an error from Microsoft, or bounces back to
  `/login`.
- Email and password are rejected for an administrator who is certain they are
  correct.
- The login page shows only the Microsoft button, with no email/password form.

### When you do *not* need this

| Situation | Do this instead |
|---|---|
| No administrator has ever been created | Open the app — it redirects to the first-run administrator setup |
| An administrator can still sign in | Have them fix Entra in Settings → General → Authentication, or promote a colleague in Settings → Users |
| A user forgot their password, Entra is healthy | They sign in with Microsoft; the password is not needed |

---

## Recovery

Run this on a machine with the repository checked out and the deployment's
`.env` in place — the same environment the app runs in. It needs `DATABASE_URL`
and `SETTINGS_ENCRYPTION_KEY` to be the deployment's real values.

```bash
printf %s 'the-new-password' | pnpm --filter @wayfinder/api recover-admin -- --email admin@example.com
```

Piping the password keeps it out of your shell history and out of the process
list. `--password 'the-new-password'` also works if you would rather pass it
directly.

The command:

1. restores an email/password credential for that account, hashed exactly as a
   normal sign-up would be;
2. signs out every existing session for it;
3. turns email/password sign-in back on if an administrator had switched it off;
4. writes an entry to the audit log — `admin.recovery.password_reset` — which is
   forwarded to your SIEM if one is configured.

### Then restart the application

```bash
./restart.sh
```

**This step is not optional.** Each running instance caches the authentication
configuration in memory for its lifetime, so a change made directly against the
database is invisible until the process restarts. If you skip it, the login page
will still show only the Microsoft button.

Sign in with the address and the new password. Then open **Settings → General →
Authentication** and fix the Entra credentials properly.

---

## What the command will not do

**It never grants administrator rights.** It restores a password for an account
that already exists, and nothing else. A tool that could also make someone an
administrator would be an escalation route, not a recovery one.

If it prints:

```
Warning: that account is not an administrator.
```

then the password was still reset, but for the wrong person — you are not locked
back in. Run it again against an administrator's address.

Other outcomes:

| Message | Meaning |
|---|---|
| `Recovery failed (NOT_FOUND)` | No user has that address. Check the spelling; addresses are matched case-insensitively |
| `Recovery failed (VALIDATION_FAILED)` | No password reached the command — check your pipe or `--password` |
| `Recovery failed (INFRA_FAILURE)` | The database write failed. Check `DATABASE_URL` and that the database is reachable |
| `SETTINGS_ENCRYPTION_KEY must be…` | The environment is not the deployment's. The key must match the one the app runs with, or the stored settings cannot be read |

---

## Afterwards

- **Change the recovery password.** It was typed on a command line by whoever
  ran this. Change it from Settings once you are signed in, or sign in through
  Entra again — which will delete it, as it should.
- **Check the audit log.** `admin.recovery.password_reset` records who was
  recovered and when. It is a legitimate but privileged event, and it should be
  reviewed like one.
- **Keep a second route in.** The reason a single Entra failure could lock out
  an entire deployment is that every administrator depended on the same identity
  provider. Consider leaving email/password enabled, or keeping one
  administrator account that does not sign in through Entra.

---

## Related

- [`setup-admin.md`](setup-admin.md) — first-run setup and common issues
- [ADR-025](../development/adr/025-configurable-auth-methods-and-entra.adr.md) —
  why authentication methods are runtime configuration rather than environment
  variables
