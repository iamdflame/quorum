import type { PoolTransaction, PoolEvent } from "@quorum/chain";

/**
 * ENTITY CLUSTERING.
 *
 * Linkage names addresses. Clustering names *people*.
 *
 * An address that appears once is a fact about one transaction. Several
 * addresses provably controlled by one party is a fact about a person — and it
 * is strictly worse for them, because their exposure is the union of every
 * address in their cluster, not the exposure of whichever address they were
 * using at the time.
 *
 * Three joining rules, all of them structural rather than statistical. Each one
 * is a claim the chain forces, not a correlation we noticed:
 *
 *   round-trip    a transaction holding both a `Deposit` naming A and a
 *                 `Withdrawal` paying B is one atomic action by one actor, so A
 *                 and B are the same party. This is the strongest link in the
 *                 system and the single relationship the pool exists to hide.
 *
 *   co-deposit    several `Deposit` events in one transaction were funded and
 *                 authorised together. Bitcoin's common-input-ownership
 *                 heuristic, and it transfers intact.
 *
 *   shared-note   two addresses bound to the same note id are the same party;
 *                 a note has exactly one owner.
 *
 * Deliberately excluded: timing proximity, amount similarity, gas-price
 * fingerprints. Those are real signals and real attacks, but they are
 * probabilistic, and a privacy tool that reports a guess with the same
 * confidence as a proof is lying to the person relying on it. Everything here
 * is a link the chain itself makes.
 */

export interface Entity {
  /** Every address proven to be the same party. */
  readonly addresses: readonly string[];
  /** Notes attributable to the entity as a whole. */
  readonly notes: readonly string[];
  /** Which rules produced this cluster, in the order they fired. */
  readonly evidence: readonly ClusterEvidence[];
}

export interface ClusterEvidence {
  readonly rule: "round-trip" | "co-deposit" | "shared-note";
  readonly tx: string;
  readonly block: number;
  readonly joined: readonly string[];
  readonly detail: string;
}

export interface ClusterReport {
  readonly entities: readonly Entity[];
  /** Distinct addresses seen. */
  readonly addresses: number;
  /** Entities they collapse into — the honest population of the pool. */
  readonly entityCount: number;
  /** Entities controlling more than one address. */
  readonly multiAddress: number;
  /** The largest cluster, which is the worst single case in the pool. */
  readonly largest: Entity | null;
  readonly evidence: readonly ClusterEvidence[];
}

/** Felts are written with inconsistent padding; compare by value. */
const norm = (a: string): string => {
  try { return BigInt(a).toString(16); } catch { return a.toLowerCase(); }
};

/** Union-find over addresses. Small, and the joins are the whole result. */
class Union {
  private parent = new Map<string, string>();

  find(a: string): string {
    const p = this.parent.get(a);
    if (p === undefined) { this.parent.set(a, a); return a; }
    if (p === a) return a;
    const root = this.find(p);
    this.parent.set(a, root); // path compression
    return root;
  }

  join(a: string, b: string): boolean {
    const ra = this.find(a), rb = this.find(b);
    if (ra === rb) return false;
    this.parent.set(ra, rb);
    return true;
  }

  groups(): Map<string, string[]> {
    const out = new Map<string, string[]>();
    for (const a of this.parent.keys()) {
      const r = this.find(a);
      const g = out.get(r) ?? [];
      g.push(a);
      out.set(r, g);
    }
    return out;
  }
}

const pick = (ev: readonly PoolEvent[], kind: string) => ev.filter((e) => e.kind === kind);

function noteIdOf(e: PoolEvent): string | undefined {
  if (e.kind === "EncNoteCreated") return e.keys[1];
  if (e.kind === "OpenNoteCreated") return e.keys[2];
  if (e.kind === "OpenNoteDeposited") return e.keys[3];
  return undefined;
}

export function clusterEntities(
  txs: readonly PoolTransaction[],
  opts: { infrastructure?: ReadonlySet<string> } = {},
): ClusterReport {
  const infra = new Set([...(opts.infrastructure ?? [])].map(norm));
  const skip = (a: string) => infra.has(norm(a));

  const union = new Union();
  const evidence: ClusterEvidence[] = [];
  const notesByAddress = new Map<string, Set<string>>();
  const addressesByNote = new Map<string, Set<string>>();

  for (const tx of txs) {
    const ev = tx.events;
    // A helper flow is one party's plumbing, not a link between people.
    if (ev.some((e) => e.kind === "ExternalContractInvoked")) continue;

    const depositors = pick(ev, "Deposit").map((d) => d.keys[1])
      .filter((a): a is string => a !== undefined && !skip(a)).map(norm);
    const recipients = pick(ev, "Withdrawal").map((w) => w.keys[1])
      .filter((a): a is string => a !== undefined && !skip(a)).map(norm);
    const noteIds = [
      ...pick(ev, "EncNoteCreated"), ...pick(ev, "OpenNoteCreated"), ...pick(ev, "OpenNoteDeposited"),
    ].map(noteIdOf).filter((n): n is string => n !== undefined).map(norm);

    // Register every party seen, joined or not. An address no rule touches is a
    // singleton entity, not an absent one — dropping them would undercount the
    // pool's population, which is the figure this whole report turns on.
    for (const a of [...depositors, ...recipients]) union.find(a);

    // round-trip: shield from A and unshield to B in one atomic action.
    if (depositors.length > 0 && recipients.length > 0) {
      const joined: string[] = [];
      for (const d of depositors) {
        for (const r of recipients) {
          if (d !== r && union.join(d, r)) joined.push(d, r);
        }
      }
      if (joined.length > 0) {
        evidence.push({
          rule: "round-trip", tx: tx.hash, block: tx.block, joined: [...new Set(joined)],
          detail:
            `A deposit and a withdrawal in one transaction. The funding address and the ` +
            `destination are the same party — the one relationship the pool exists to hide.`,
        });
      }
    }

    // co-deposit: funded and authorised together.
    if (depositors.length > 1) {
      const joined: string[] = [];
      for (let i = 1; i < depositors.length; i++) {
        if (union.join(depositors[0]!, depositors[i]!)) joined.push(depositors[0]!, depositors[i]!);
      }
      if (joined.length > 0) {
        evidence.push({
          rule: "co-deposit", tx: tx.hash, block: tx.block, joined: [...new Set(joined)],
          detail: `${depositors.length} deposits authorised in one transaction share a payer.`,
        });
      }
    }

    // Record note ownership for the shared-note rule and for entity exposure.
    for (const a of [...depositors, ...recipients]) {
      const set = notesByAddress.get(a) ?? new Set<string>();
      for (const n of noteIds) {
        set.add(n);
        const owners = addressesByNote.get(n) ?? new Set<string>();
        owners.add(a);
        addressesByNote.set(n, owners);
      }
      notesByAddress.set(a, set);
    }
  }

  // shared-note: a note has exactly one owner.
  for (const [note, owners] of addressesByNote) {
    if (owners.size < 2) continue;
    const list = [...owners];
    const joined: string[] = [];
    for (let i = 1; i < list.length; i++) {
      if (union.join(list[0]!, list[i]!)) joined.push(list[0]!, list[i]!);
    }
    if (joined.length > 0) {
      evidence.push({
        rule: "shared-note", tx: "", block: 0, joined: [...new Set(joined)],
        detail: `Note ${note.slice(0, 14)}… is bound to ${owners.size} addresses; a note has one owner.`,
      });
    }
  }

  const groups = union.groups();
  const entities: Entity[] = [...groups.values()].map((addresses) => {
    const notes = new Set<string>();
    for (const a of addresses) for (const n of notesByAddress.get(a) ?? []) notes.add(n);
    return {
      addresses,
      notes: [...notes],
      evidence: evidence.filter((e) => e.joined.some((j) => addresses.includes(j))),
    };
  }).sort((a, b) => b.addresses.length - a.addresses.length || b.notes.length - a.notes.length);

  return {
    entities,
    addresses: groups.size === 0 ? 0 : [...groups.values()].reduce((s, g) => s + g.length, 0),
    entityCount: entities.length,
    multiAddress: entities.filter((e) => e.addresses.length > 1).length,
    largest: entities[0] ?? null,
    evidence,
  };
}
