import type { PoolTransaction, PoolEvent } from "@shoal/chain";

/**
 * THE LINKAGE GRAPH.
 *
 * The anonymity set answers "how many people could I have been?". This answers
 * a harder and more damaging question: **which private notes are already tied
 * to a public address, right now, with no cryptography broken at all?**
 *
 * The mechanism is co-occurrence. Each pool event is carefully anonymous on its
 * own — a nullifier reveals nothing, an encrypted note reveals nothing. But
 * every event sharing a transaction hash was caused by *one actor*, and some of
 * those events name a public address. So a transaction containing both a
 * `Deposit` (which names `user_addr` in the clear) and an `EncNoteCreated`
 * binds that address to that note. No key material required, no viewing key,
 * no proof broken. Just a join on transaction hash.
 *
 * This is invisible if you read the pool one selector at a time, which is how
 * every explorer reads it.
 *
 * Four distinct failures, each independently sufficient:
 *
 *   binding      a deposit and a note creation in one transaction
 *   round-trip   shield and unshield in one transaction; the pool hop
 *                protected nothing, and the entry and exit are both public
 *   onboarding   a viewing-key registration alongside value movement — the
 *                exact "channel-open linkability" the STRK20 docs warn about
 *   exit         a nullifier spent alongside a public withdrawal, tying the
 *                spent note to a public destination
 *
 * None of these are protocol flaws. All of them are things wallets and users do
 * because nothing tells them not to.
 */

export type LinkageKind = "binding" | "round-trip" | "onboarding" | "exit";

export interface Linkage {
  readonly kind: LinkageKind;
  readonly tx: string;
  readonly block: number;
  /** Public addresses exposed by this transaction. */
  readonly addresses: readonly string[];
  /** Note ids bound to those addresses, where the failure binds notes. */
  readonly notes: readonly string[];
  /**
   * True when an anonymizer took part. A private swap legitimately withdraws to
   * a helper, so these must be separated or the count measures plumbing rather
   * than people — the error that contaminated our first pass entirely.
   */
  readonly viaAnonymizer: boolean;
  readonly detail: string;
}

export interface LinkageReport {
  readonly transactions: number;
  readonly linkages: readonly Linkage[];
  /** Distinct public addresses bound to at least one note. */
  readonly exposedAddresses: ReadonlySet<string>;
  /** Distinct notes attributable to a public address. */
  readonly exposedNotes: ReadonlySet<string>;
  /** Counts per failure, split by whether an anonymizer was involved. */
  readonly byKind: Readonly<Record<LinkageKind, { user: number; viaAnonymizer: number }>>;
  /** Addresses ranked by how many of their notes are attributable. */
  readonly worst: readonly { address: string; notes: number }[];
}

const has = (events: readonly PoolEvent[], kind: string) => events.some((e) => e.kind === kind);
const pick = (events: readonly PoolEvent[], kind: string) => events.filter((e) => e.kind === kind);

/**
 * The note id carried by a note-creating event.
 * `EncNoteCreated(note_id key, packed_value)` puts it at keys[1];
 * `OpenNoteCreated(enc_recipient_addr, token key, note_id key)` at keys[2].
 */
function noteIdOf(e: PoolEvent): string | undefined {
  if (e.kind === "EncNoteCreated") return e.keys[1];
  if (e.kind === "OpenNoteCreated") return e.keys[2];
  if (e.kind === "OpenNoteDeposited") return e.keys[3];
  return undefined;
}

/**
 * Addresses that are plumbing, excluded from attribution.
 *
 * `ExternalContractInvoked` catches a transaction that *calls* a helper, but not
 * one that merely *pays* one. A relayer or fee sink receives withdrawals in
 * ordinary-looking transactions, and attributing those notes to it produces a
 * single "most exposed address" holding hundreds of notes — plumbing wearing a
 * person's shape. Pass the sinks identified from chain state alongside the
 * per-transaction check; neither catches everything alone.
 */
export interface LinkageOptions {
  readonly infrastructure?: ReadonlySet<string>;
}

/** Compare addresses by numeric value: felts are written with inconsistent padding. */
const norm = (a: string): string => {
  try { return BigInt(a).toString(16); } catch { return a.toLowerCase(); }
};

export function analyseLinkage(
  txs: readonly PoolTransaction[], opts: LinkageOptions = {},
): LinkageReport {
  const infra = new Set([...(opts.infrastructure ?? [])].map(norm));
  const linkages: Linkage[] = [];
  const exposedAddresses = new Set<string>();
  const exposedNotes = new Set<string>();
  const perAddress = new Map<string, Set<string>>();
  const byKind: Record<LinkageKind, { user: number; viaAnonymizer: number }> = {
    binding: { user: 0, viaAnonymizer: 0 },
    "round-trip": { user: 0, viaAnonymizer: 0 },
    onboarding: { user: 0, viaAnonymizer: 0 },
    exit: { user: 0, viaAnonymizer: 0 },
  };

  for (const tx of txs) {
    const ev = tx.events;
    const viaAnonymizer = has(ev, "ExternalContractInvoked");
    const isInfra = (a: string) => infra.has(norm(a));
    const record = (
      kind: LinkageKind, addresses: string[], notes: string[], detail: string,
    ) => {
      linkages.push({ kind, tx: tx.hash, block: tx.block, addresses, notes, viaAnonymizer, detail });
      byKind[kind][viaAnonymizer ? "viaAnonymizer" : "user"]++;
      if (viaAnonymizer) return;
      for (const a of addresses) {
        // A note "belonging" to a fee sink is not a person's exposure.
        if (isInfra(a)) continue;
        exposedAddresses.add(a);
        const set = perAddress.get(a) ?? new Set<string>();
        for (const n of notes) { set.add(n); exposedNotes.add(n); }
        perAddress.set(a, set);
      }
    };

    const deposits = pick(ev, "Deposit");
    const created = [
      ...pick(ev, "EncNoteCreated"), ...pick(ev, "OpenNoteCreated"), ...pick(ev, "OpenNoteDeposited"),
    ];
    const noteIds = created.map(noteIdOf).filter((n): n is string => n !== undefined);
    const depositors = deposits.map((d) => d.keys[1]).filter((a): a is string => a !== undefined);

    if (depositors.length > 0 && noteIds.length > 0) {
      record("binding", depositors, noteIds,
        `${depositors.length} depositor(s) named in the clear alongside ${noteIds.length} note(s) ` +
        `created in the same transaction; each note is attributable to the address that funded it.`);
    }

    if (has(ev, "Deposit") && has(ev, "Withdrawal")) {
      const to = pick(ev, "Withdrawal").map((w) => w.keys[1])
        .filter((a): a is string => a !== undefined);
      record("round-trip", [...depositors, ...to], noteIds,
        `Shielded and unshielded in one transaction. Both the entry and the exit are public ` +
        `legs of the same atomic action, so the pool hop between them protected nothing.`);
    }

    if (has(ev, "ViewingKeySet") && (has(ev, "Deposit") || has(ev, "Withdrawal"))) {
      const users = pick(ev, "ViewingKeySet").map((v) => v.keys[1])
        .filter((a): a is string => a !== undefined);
      record("onboarding", [...users, ...depositors], noteIds,
        `A viewing key was registered in the same transaction as value movement. The STRK20 ` +
        `docs name this exactly and advise spreading setup and movement over time.`);
    }

    if (has(ev, "NoteUsed") && has(ev, "Withdrawal")) {
      const to = pick(ev, "Withdrawal").map((w) => w.keys[1])
        .filter((a): a is string => a !== undefined);
      const nullifiers = pick(ev, "NoteUsed").map((n) => n.keys[1])
        .filter((n): n is string => n !== undefined);
      record("exit", to, nullifiers,
        `${nullifiers.length} nullifier(s) published in the same transaction as a public ` +
        `withdrawal, tying the spent notes to the destination address.`);
    }
  }

  const worst = [...perAddress.entries()]
    .map(([address, notes]) => ({ address, notes: notes.size }))
    .sort((a, b) => b.notes - a.notes);

  return {
    transactions: txs.length,
    linkages,
    exposedAddresses,
    exposedNotes,
    byKind,
    worst,
  };
}
