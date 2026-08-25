import { test } from "node:test";
import assert from "node:assert/strict";
import {
  contractDiscoveryProvider, loadPoolAbi, resolveSdkDir, SdkBridgeError,
  PUBLIC_SUBPATHS, INTERNAL_DISCOVERY,
} from "../src/index.ts";

/** A local build of the SDK; the package is not on npm. */
const SDK_DIR = process.env["STRK20_SDK_DIR"] ?? "/tmp/claude-1000/-home-dflame-Documents-strk/f873b594-8958-4e61-a4d6-8ca272031589/scratchpad/sp/sdk";
const fakePool = { get_note: () => 0, channel_exists: () => false, get_version: () => 0 };

test("the exports map genuinely omits the discovery internals", async () => {
  // The premise of this whole bridge. If it ever stops being true, delete it.
  const { readFileSync } = await import("node:fs");
  const pkg = JSON.parse(readFileSync(`${SDK_DIR}/package.json`, "utf8"));
  const subpaths = Object.keys(pkg.exports);
  assert.deepEqual(subpaths.sort(), [...PUBLIC_SUBPATHS].sort(),
    "exports map changed - re-check whether the bridge is still needed");
  assert.ok(!subpaths.includes("./internal/*"), "no internal subpath is published");
});

test("the class is compiled into dist even though it is unreachable", async () => {
  const { existsSync } = await import("node:fs");
  assert.ok(existsSync(`${SDK_DIR}/${INTERNAL_DISCOVERY}`),
    "the file ships; only the exports map hides it");
});

test("it is absent from the package entry", async () => {
  const { pathToFileURL } = await import("node:url");
  const entry = await import(pathToFileURL(`${SDK_DIR}/dist/index.js`).href);
  assert.ok(!("ContractDiscoveryProvider" in entry),
    "if this appears, the SDK fixed it and the bridge should go");
  assert.ok("IndexerDiscoveryProvider" in entry, "the indexer one is exported");
});

test("the bridge constructs a working provider anyway", async () => {
  const d = await contractDiscoveryProvider(fakePool, { sdkDir: SDK_DIR });
  assert.equal(d.constructor.name, "ContractDiscoveryProvider");
  assert.equal(typeof (d as { discoverNotes: unknown }).discoverNotes, "function");
  assert.equal(typeof (d as { discoverChannels: unknown }).discoverChannels, "function");
});

test("rate limiting is passed through", async () => {
  const d = await contractDiscoveryProvider(fakePool,
    { sdkDir: SDK_DIR, rateLimit: { maxConcurrent: 2 } });
  assert.equal(d.constructor.name, "ContractDiscoveryProvider");
});

test("the pool ABI loads from the one internal subpath that is exported", async () => {
  const abi = await loadPoolAbi(SDK_DIR);
  assert.ok(Array.isArray(abi) && abi.length > 50, `expected a full ABI, got ${abi.length}`);
  const names = JSON.stringify(abi);
  // Pool entry points only. `privacy_invoke` belongs to anonymizer contracts —
  // the pool calls it through INVOKE_SELECTOR, it does not expose it.
  for (const fn of ["get_note", "nullifier_exists", "get_fee_amount", "apply_actions"]) {
    assert.ok(names.includes(fn), `ABI should describe ${fn}`);
  }
  assert.ok(!names.includes("privacy_invoke"),
    "privacy_invoke is the helper's entry point, not the pool's");
});

test("a missing SDK fails with an actionable message, not a stack trace", async () => {
  await assert.rejects(
    () => contractDiscoveryProvider(fakePool, { sdkDir: "/nonexistent/sdk" }),
    (e: Error) => e instanceof SdkBridgeError && /npm run build/.test(e.message),
  );
});

test("resolveSdkDir returns an explicit directory untouched", async () => {
  assert.equal(await resolveSdkDir("/some/where"), "/some/where");
});
