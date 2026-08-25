/**
 * Indexer-free note discovery on the STRK20 pool.
 *
 * ## The gap
 *
 * The Privacy SDK ships two discovery providers. `IndexerDiscoveryProvider`
 * wants a hosted indexer. `ContractDiscoveryProvider` reads the same notes from
 * the pool contract over ordinary Starknet RPC — slower, but no service to wait
 * for, and no third party learning which notes you asked about.
 *
 * As of `@starkware-libs/starknet-privacy-sdk@0.14.3-rc.5` the second one is
 * unreachable. It is written, it is compiled into `dist/internal/`, and it is
 * neither re-exported from the package entry nor exposed by the `exports` map,
 * which lists only `.`, `./testing`, `./browser`, `./browser/testing` and
 * `./abi`. Node honours that map, so a deep import is refused even though the
 * file is sitting right there. Reported by the Aperture team in
 * starkience/strk20-hackathon#121.
 *
 * That matters more than it sounds. Without it, every SDK-route team needs a
 * hosted indexer they have not been given, on top of a proving service that has
 * not been published — so the honest state of the mainnet SDK route is
 * *blocked*, and this removes one of the two blocks.
 *
 * ## The way through
 *
 * An `exports` map constrains specifier resolution, not the loader. Resolve the
 * package's own entry point, walk to its directory, and import the built file by
 * absolute `file://` URL: the map never enters the picture. Nothing is patched,
 * nothing is vendored, and the code that runs is the package's own build.
 *
 * This is a workaround for a packaging omission, not a way around a boundary
 * anyone drew on purpose — the class is public, documented, and Apache-2.0. When
 * the SDK exports it, delete this file and import it normally.
 */

/** Minimal shape of the pool contract the discovery provider needs. */
export interface PoolContractLike {
  get_note(noteId: unknown): unknown;
  channel_exists(marker: unknown): unknown;
  get_version(): unknown;
}

export interface DiscoveryBridgeOptions {
  /**
   * Directory of the built SDK, if it is not resolvable as a bare specifier.
   * The package is not on npm — it publishes to GitHub Packages, and the docs
   * also sanction installing from git — so a local build path is the normal
   * case rather than the exception.
   */
  readonly sdkDir?: string;
  /** Rate limiting passed through to the provider's RPC calls. */
  readonly rateLimit?: { readonly intervalMs?: number; readonly maxConcurrent?: number };
}

/** Thrown when the SDK cannot be located or its build is incomplete. */
export class SdkBridgeError extends Error {}

/** Subpaths the SDK's `exports` map does publish, so they import normally. */
export const PUBLIC_SUBPATHS = [".", "./testing", "./browser", "./browser/testing", "./abi"] as const;

/** Files we reach past the map, relative to the SDK package root. */
export const INTERNAL_DISCOVERY = "dist/internal/contract-discovery.js";
export const INTERNAL_ABI = "dist/internal/abi.js";

async function importAbsolute(dir: string, relative: string): Promise<Record<string, unknown>> {
  const { pathToFileURL } = await import("node:url");
  const { join } = await import("node:path");
  const { existsSync } = await import("node:fs");
  const full = join(dir, relative);
  if (!existsSync(full)) {
    throw new SdkBridgeError(
      `${relative} not found under ${dir}. The SDK ships TypeScript only — run ` +
      `\`npm ci && npm run build\` in its \`sdk/\` directory first.`,
    );
  }
  return (await import(pathToFileURL(full).href)) as Record<string, unknown>;
}

/** Locate the built SDK: an explicit directory, or resolve the bare specifier. */
export async function resolveSdkDir(explicit?: string): Promise<string> {
  if (explicit !== undefined) return explicit;
  const { createRequire } = await import("node:module");
  const { dirname } = await import("node:path");
  const require = createRequire(import.meta.url);
  try {
    // Resolves through the `.` export, then walks up out of dist/.
    const entry = require.resolve("@starkware-libs/starknet-privacy-sdk");
    return dirname(dirname(entry));
  } catch {
    throw new SdkBridgeError(
      "Could not resolve @starkware-libs/starknet-privacy-sdk. It is not on npm — " +
      "install it from GitHub Packages, or build it from a clone of " +
      "starkware-libs/starknet-privacy and pass `sdkDir`.",
    );
  }
}

/** The pool ABI, from the one internal subpath the SDK does export. */
export async function loadPoolAbi(sdkDir: string): Promise<unknown[]> {
  const mod = await importAbsolute(sdkDir, INTERNAL_ABI);
  const abi = mod["PrivacyPoolABI"] ?? Object.values(mod).find((v) => Array.isArray(v));
  if (!Array.isArray(abi)) {
    throw new SdkBridgeError("PrivacyPoolABI not found in the SDK's abi module.");
  }
  return abi;
}

/**
 * Build a `ContractDiscoveryProvider` bound to `pool`.
 *
 * Returned as `unknown`-typed because the SDK gives us no public type for it —
 * declaring a hand-written interface here would be a second source of truth that
 * silently drifts from the SDK's own. Pass it straight to `createPrivateTransfers`
 * as `discoveryProvider`, which is the only thing it is for.
 */
export async function contractDiscoveryProvider(
  pool: PoolContractLike,
  opts: DiscoveryBridgeOptions = {},
): Promise<object> {
  const dir = await resolveSdkDir(opts.sdkDir);
  const mod = await importAbsolute(dir, INTERNAL_DISCOVERY);
  const Ctor = mod["ContractDiscoveryProvider"];
  if (typeof Ctor !== "function") {
    throw new SdkBridgeError(
      "ContractDiscoveryProvider is missing from the SDK build. If a newer SDK " +
      "exports it from the package entry, drop this bridge and import it directly.",
    );
  }
  const C = Ctor as new (p: PoolContractLike, o?: unknown) => object;
  return opts.rateLimit ? new C(pool, { rateLimit: opts.rateLimit }) : new C(pool);
}
