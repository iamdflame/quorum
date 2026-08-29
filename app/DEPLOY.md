# Deploying the app

```bash
cd app
npm run build          # sanity-check locally first
vercel build --prod    # build HERE, in the monorepo
vercel deploy --prebuilt --prod --yes
```

**Do not run a plain `vercel deploy`.** It uploads only `app/` and builds there, and `app/` depends on `quorum-protocol` through `file:../packages/protocol` — a path that does not exist inside the upload. Rollup fails with `failed to resolve import "quorum-protocol"`, the deployment errors in about three seconds, and **the production alias silently stays on the previous build**.

That last part is what makes it dangerous rather than merely annoying: the site keeps serving, nothing looks broken, and the change simply never appears. Two deployments failed this way before anyone noticed the page had not changed.

`vercel build` runs in this working tree, where the workspace link resolves, and `--prebuilt` uploads the finished output instead of rebuilding it. What was tested locally is then exactly what ships.
