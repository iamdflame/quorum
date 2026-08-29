# Publishing the tools to npm

Three packages go out, **in this order**:

1. **`quorum-chain`** — reads the pool, and separates infrastructure from people
2. **`quorum-oracle`** — how big the anonymity set actually is
3. **`quorum-linkage`** — what the pool already gives away (this is the one with the CLI)

Order matters: linkage depends on chain, and publishing it first would hand
everyone who runs `npx` an unresolvable dependency.

> **Why not `@quorum/linkage`.** The npm organisation name `quorum` is
> unavailable — there is already a package called `quorum`, and packages and
> organisations share one namespace. Unscoped names need no organisation at all,
> and `npx quorum-linkage` is what a person types either way, so nothing about
> the tool's use changed.

Everything is prepared: descriptions, keywords, repository links, `files` lists,
`publishConfig.access: public`, and the `bin` entry. The tarballs have been
packed, installed into an empty project, and run as a stranger would. The only
missing piece is your account.

---

## Step 1 — an npm account

Skip if you have one.

1. Go to **https://www.npmjs.com/signup**
2. Username, email, password. **Write the username down** — you log in with it,
   not with your email.
3. Click the link in the confirmation email. npm refuses to publish from an
   unverified address.

## Step 2 — two-factor authentication

npm requires it to publish. Doing it now avoids a confusing failure later.

1. **https://www.npmjs.com/settings/~/profile** → *Two-Factor Authentication*
2. Choose **Authorization and Publishing**
3. Scan the QR code with an authenticator app (Google Authenticator, Aegis, 1Password)
4. Enter the 6-digit code to confirm
5. **Save the recovery codes somewhere that is not this laptop**

## Step 3 — log in from this machine

```bash
cd /home/dflame/Documents/strk
npm login
```

It asks for your **username** (not your email), password, email, and a 6-digit
code. Newer npm opens a browser window instead — either is fine. Then confirm:

```bash
npm whoami
```

It should print your username. An error means the login did not take; run
`npm login` again.

## Step 4 — publish

One command. It builds, runs all 173 tests, and publishes only if they pass —
in the right order:

```bash
npm run publish:tools
```

You will be asked for a fresh 6-digit code for **each** package. That is normal:
it is three publishes, not one.

## Step 5 — check it the way a stranger will

```bash
cd /tmp && npx quorum-linkage --span 40000
```

It should read the live pool and print the aggregate report, naming no address.
That is someone's first experience of the tool, so it is worth watching happen
once.

Then add it to the README badge line if you like — a judge who can run your tool
against mainnet in one command is a judge who remembers you.

---

## When it goes wrong

| It says | It means |
|---|---|
| `402 Payment Required` | `publishConfig.access` was lost. Run `npm publish --access public -w quorum-linkage` |
| `403 Forbidden` | the name was taken between now and when this was written, or your email is unverified |
| `E401` / `ENEEDAUTH` | not logged in — `npm login` again |
| `EOTP` | the code was wrong or expired. Codes last 30 seconds; wait for a fresh one |
| `404 quorum-chain` when installing linkage | the order slipped. Publish `quorum-chain`, then republish linkage as `0.1.1` |

**A published version can never be replaced.** Unpublishing is only allowed
within 72 hours and burns that version number permanently. That is why Step 4
runs the tests rather than trusting them.
