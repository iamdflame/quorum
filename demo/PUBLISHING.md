# Publishing the linkage tool to npm

Two packages go out: **`@quorum/chain`** and **`@quorum/linkage`**. They must go
in that order — linkage depends on chain, and publishing linkage alone would hand
everyone who runs `npx` an unresolvable dependency.

Both are already prepared: descriptions, keywords, repository links, `files`
lists, `publishConfig.access: public`, and a `bin` entry. Both tarballs have been
packed, installed into an empty project, and run as a stranger would. The only
thing missing is your account.

---

## Step 1 — make an npm account

Skip if you have one.

1. Go to **https://www.npmjs.com/signup**
2. Fill in username, email, password. **Write the username down** — it becomes
   part of your package's public identity.
3. Open the confirmation email and click the link. npm will refuse to publish
   from an unverified email.

## Step 2 — turn on two-factor authentication

npm requires 2FA to publish. Doing it now avoids a confusing failure later.

1. **https://www.npmjs.com/settings/~/profile** → *Two-Factor Authentication*
2. Choose **Authorization and Publishing**
3. Scan the QR code with an authenticator app (Google Authenticator, Aegis, 1Password)
4. Type the 6-digit code to confirm
5. **Save the recovery codes somewhere that is not this laptop**

## Step 3 — claim the `@quorum` scope

A scoped package like `@quorum/linkage` needs an organisation of that name.
Organisations are **free** as long as the packages are public.

1. Go to **https://www.npmjs.com/org/create**
2. Organisation name: `quorum`
3. Plan: **Free** (unlimited public packages)
4. Create it

**If npm says the name is taken**, do not fight it. Fall back to unscoped names,
which need no organisation at all:

```bash
cd /home/dflame/Documents/strk
npm pkg set name=quorum-chain   -w @quorum/chain
npm pkg set name=quorum-linkage -w @quorum/linkage
npm pkg set dependencies.quorum-chain=0.1.0 -w @quorum/linkage
npm pkg delete dependencies.@quorum/chain    -w @quorum/linkage
grep -rl '@quorum/chain\|@quorum/linkage' packages/*/src packages/*/README.md README.md \
  | xargs sed -i 's|@quorum/chain|quorum-chain|g; s|@quorum/linkage|quorum-linkage|g'
npm install && npm run build && npm test
```

The command in Step 5 stays the same either way — it publishes by workspace
folder, not by name.

## Step 4 — log in from this machine

In a terminal, in the project folder:

```bash
cd /home/dflame/Documents/strk
npm login
```

It will ask for:

- **Username** — the one from Step 1 (not your email)
- **Password**
- **Email** — the address you verified
- **One-time password** — the 6-digit code from your authenticator app

Newer npm opens a browser window instead and asks you to click *Sign in*. Either
way is fine.

Check it worked:

```bash
npm whoami
```

It should print your username. If it prints an error, the login did not take —
run `npm login` again.

## Step 5 — publish

One command. It builds, runs all 88 tests, and only publishes if they pass:

```bash
npm run publish:tools
```

You will be asked for a fresh 6-digit code for **each** package. That is normal —
it is two publishes.

## Step 6 — check it from the outside

```bash
cd /tmp && npx @quorum/linkage --span 40000
```

If you took the unscoped fallback, that is `npx quorum-linkage` instead.

It should read the pool and print the aggregate report. That is a stranger's
first experience of the tool, so it is worth watching it happen once.

---

## Things that go wrong

| What it says | What it means |
|---|---|
| `402 Payment Required` | you made the org on a paid plan, or `publishConfig.access` got lost. Run `npm publish --access public -w @quorum/linkage` |
| `403 Forbidden` | the name is taken by someone else, or your email is unverified |
| `E401` / `ENEEDAUTH` | not logged in. `npm login` again |
| `EOTP` | the 6-digit code was wrong or expired. Codes last 30 seconds — wait for a fresh one |
| `npm ERR! 404 @quorum/chain` when installing linkage | you published linkage first. Publish chain, then republish linkage as `0.1.1` |

**A published version can never be replaced.** If you publish something broken,
you bump the version and publish again — `npm unpublish` is only allowed within
72 hours and leaves the version number permanently burned. So let Step 5 run the
tests rather than skipping them.
