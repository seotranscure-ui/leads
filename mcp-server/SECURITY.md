# Security notes

What this server does to stay safe, and what it still cannot protect you from.

---

## 1. It signs in as a person, not as the database owner

The previous version of this server used the Supabase **service_role** key. That key bypasses Row
Level Security entirely: anything holding it can read, rewrite or drop every row in the project,
and nothing it does is attributable to anyone. It sat in a plain-text JSON config in a home
directory.

This version refuses to accept one. It signs in with an ordinary tracker account instead, so:

- **RLS still applies.** The server can do exactly what that person can do in the browser, no more.
- **Writes are attributed.** `manual_updated_by`, `started_by` and `uploaded_by` get a real user id,
  so the app shows who changed what.
- **Access is revocable without a password change** — `npm run logout`, or sign the user out from
  the Supabase dashboard.

If `SUPABASE_SERVICE_ROLE_KEY` or `SUPABASE_SECRET_KEY` is present in the environment, the server
exits rather than starting with it. Accepting it quietly would disable every guarantee above.

## 2. The password is never stored

`npm run login` reads the password without echoing it, exchanges it for a session, and keeps only
the **refresh token**. The file is created at mode `0600` before anything is written to it, so the
secret is never briefly readable under a laxer umask, and the server refuses to start if the
permissions have since been loosened (POSIX only — Windows reports a synthetic mode that says
nothing about its real ACLs, so there the check is skipped and the README says to check it
yourself).

The publishable ("anon") key alongside it is public by design: it is already in the website's
JavaScript bundle. It is not a secret and is not treated as one.

## 3. Capability is decided before the conversation starts

`LEADS_MCP_MODE` is `read`, `write` or `admin`, and it decides which tools are **registered**, not
which tools refuse. In `read` mode the write tools do not exist in the protocol at all, so no
phrasing, no misunderstanding and nothing smuggled into a lead's notes can reach them. Changing the
mode needs an edit to the Claude config and a restart — something a person does deliberately.

The default is `read`.

## 4. There is no SQL tool

The single most common way to make an MCP server dangerous is a `run_query` tool. It is convenient,
and it hands whoever can influence the conversation the entire database — RLS or not, it will
happily run `delete from leads`.

Every operation here goes through a typed function in `src/repo.ts` that knows which table it
touches and what shape the data has. If Claude needs something this server cannot express, the
answer is a new tool with a schema, not an escape hatch.

## 5. Destructive actions have to be named twice

`leads_delete`, `leads_import` and a real `leads_run_reminders` send are confirmation-gated. The
first call writes nothing; it reports exactly what would happen and returns a phrase naming the
specific target — `DELETE mac:17421`, not "yes". Only a second call quoting that phrase proceeds.

This is not a cryptographic control. It is there so a destructive action cannot be the result of a
vague instruction or an ambiguous pronoun, and so an instruction that arrived inside somebody's
lead notes cannot satisfy it.

Alongside it:

- Deletes are one lead per call. There is no bulk delete.
- Writes are capped at `LEADS_MCP_MAX_BATCH` leads (200 by default).
- An import preview shows the row counts and stage distribution before anything is written.

## 6. Lead text is treated as data

Lead names, practices, CRM comments, form messages and search queries are written by strangers —
anyone who can fill in a web form, and anyone with CRM access. When that text is read by a model
that also holds write tools, it is an instruction-injection channel.

Two mitigations, both cheap:

- Control characters that let text fake structure — C0 controls, zero-width characters, bidi
  overrides, line and paragraph separators — are stripped from every free-text field before it is
  rendered, and before anything is written back.
- Output containing that text carries a line saying it is supplied by outside parties and is data,
  not instructions.

**This is a mitigation, not a guarantee.** A sufficiently convincing instruction inside a lead's
notes could still influence a model. That is precisely why `read` is the default mode and why
deletes need a target-specific phrase: the layers are there because this layer is imperfect.

## 7. Every write is journaled locally

`~/.config/leads-mcp/audit.log` gets one JSON line per write: timestamp, tool, action, workspace,
the record ids touched, and whether it succeeded.

It records **what was touched, not what was in it**. A journal full of lead contact details would
be a second, unprotected copy of the data sitting in a home directory. Record ids are enough to
reconstruct a sequence of actions and to spot one nobody asked for.

Set `LEADS_MCP_AUDIT=0` to turn it off.

## 8. The transport has no network surface

stdio only. Claude launches the server as a child process and talks to it over pipes. There is no
port, no HTTP endpoint, no authentication of its own to get wrong, and nothing for anything else on
the machine or network to connect to.

## 9. Secrets stay out of errors and logs

Errors are mapped to messages that say what to do next, not what the internals look like. The smoke
test asserts that a failed sign-in does not echo the token back in the error text. Logging goes to
stderr — stdout carries the JSON-RPC stream, and writing to it would corrupt the protocol.

---

## What this does **not** protect you from

- **Anyone with your user account.** The server's reach is that account's reach. If the account is
  an admin in the tracker, so is the server.
- **A compromised machine.** The refresh token is readable by your own user, which is the same
  account that can read your browser's session anyway.
- **A determined injection in `write` or `admin` mode.** See §6. The confirmation gate covers
  deletes, imports and sends; ordinary edits are not gated. If you are running `admin` unattended,
  you are trusting the model with that account.
- **Mistakes you asked for.** "Re-map the funnel" will re-stage hundreds of leads, as instructed.
  The tools say what they did; the app's import history and this audit log are the record.

## Reporting

Credential exposure: `npm run logout`, then rotate the password in Supabase, which invalidates every
other session too.
