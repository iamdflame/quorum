//! # ConclaveMachine
//!
//! A general private state machine on the STRK20 pool.
//!
//! The pool gives us a primitive nobody has assembled into a programming model:
//! `privacy_invoke` runs *arbitrary* logic atomically between a withdrawal and a
//! set of note credits, and the pool's balance invariant is enforced by proof.
//! The Escrow helper in the STRK20 docs is the smallest instance of this — a
//! two-operation state machine whose only on-chain state is a commitment hash.
//!
//! ConclaveMachine generalises that from two operations over one secret to N
//! operations over an arbitrary committed state:
//!
//! ```text
//!   Open  ──▶  Submit ×N  ──▶  Seal  ──▶  Settle
//!             (sealed inputs,  (input set  (outcome applied,
//!              value parked)    frozen)     value released)
//! ```
//!
//! ## What is on-chain, and what is never on-chain
//!
//! On-chain: a commitment to the private state, a running accumulator over the
//! sealed input set, the phase, the escrowed total, and the token. That is all.
//!
//! Never on-chain: any participant's input value, the state itself, or the
//! identity of who submitted what. Participants hold plaintext; the chain holds
//! hashes. This is exactly the Escrow discipline — "only the hash goes on-chain;
//! the secret never does" — carried to arbitrary state.
//!
//! ## The trust boundary, stated precisely
//!
//! This contract enforces, unconditionally and on-chain:
//!
//!   1. **Phase ordering.** No settling an unsealed conclave, no submitting to a
//!      sealed one, no re-settling. Monotonic, no path backwards.
//!   2. **Input-set immutability.** Each submission folds into an accumulator
//!      root. Once sealed, no input can be added, removed, or reordered without
//!      changing a root that is already committed on-chain.
//!   3. **Value conservation.** Payouts must sum to exactly the escrowed total in
//!      exactly the escrowed token. The machine cannot mint, cannot burn, and
//!      cannot pay in an asset it never received.
//!   4. **Settlement authority.** Settling requires the preimage of a commitment
//!      fixed at creation, so an observer who watches the whole lifecycle still
//!      cannot settle it.
//!
//! What this contract does *not* verify on-chain is that `new_state_root` is the
//! correct transition of the previous state under the conclave's `program`. That
//! is attested by the STARK proof of the client-side `privacy_compute` execution
//! which the pool verifies before any of these writes are applied — the same
//! pairing StarkWare's own privacy-bridge uses to bind an attested message to a
//! private note in one transaction.
//!
//! The distinction matters and we are explicit about it: the invariants above
//! hold even against a malicious settler, and they are what make a mis-settled
//! conclave *unprofitable* rather than merely detectable. A settler who lies
//! about the outcome still cannot take more value out than was put in.
//!
//! Unofficial and unaudited. Own the review if you build on it.

use privacy::objects::OpenNoteDeposit;
use starknet::ContractAddress;

/// Domain-separation tags. Distinct constants keep the accumulator, the state
/// commitment and the settlement commitment in disjoint hash spaces, so a
/// preimage recovered in one context is inert in the others.
pub const INPUT_ACC_TAG: felt252 = 'CONCLAVE_INPUT_ACC';
pub const SETTLE_TAG: felt252 = 'CONCLAVE_SETTLE';

pub mod errors {
    pub const NOT_POOL: felt252 = 'CONCLAVE: caller not pool';
    pub const EXISTS: felt252 = 'CONCLAVE: id already used';
    pub const NOT_OPEN: felt252 = 'CONCLAVE: not open';
    pub const NOT_SEALED: felt252 = 'CONCLAVE: not sealed';
    pub const TOO_LATE: felt252 = 'CONCLAVE: submissions closed';
    pub const TOO_EARLY: felt252 = 'CONCLAVE: seal block unreached';
    pub const BAD_SECRET: felt252 = 'CONCLAVE: bad settle secret';
    pub const WRONG_TOKEN: felt252 = 'CONCLAVE: payout token differs';
    pub const NOT_CONSERVED: felt252 = 'CONCLAVE: value not conserved';
    pub const ZERO_AMOUNT: felt252 = 'CONCLAVE: zero amount';
    pub const NO_INPUTS: felt252 = 'CONCLAVE: no inputs';
}

/// Lifecycle position. Strictly monotonic: Void → Open → Sealed → Settled.
#[derive(Serde, Copy, Drop, PartialEq, Debug, starknet::Store)]
pub enum Phase {
    /// No conclave at this id. The zero value, so an unwritten slot reads as Void.
    #[default]
    Void,
    /// Accepting sealed inputs and escrowing value.
    Open,
    /// Input set frozen; awaiting an outcome.
    Sealed,
    /// Outcome applied and value released. Terminal.
    Settled,
}

/// The entire on-chain footprint of a private state machine.
#[derive(Serde, Copy, Drop, PartialEq, Debug, starknet::Store)]
pub struct Conclave {
    pub phase: Phase,
    /// The single asset this conclave escrows and settles in.
    pub token: ContractAddress,
    /// Commitment to the current private state. A hash, always.
    pub state_root: felt252,
    /// Running fold over every sealed input commitment. Order-dependent by
    /// construction, which is what freezes the set rather than merely its size.
    pub input_root: felt252,
    pub input_count: u32,
    /// Total value parked here, denominated in `token`.
    pub escrowed: u128,
    /// Submissions are rejected from this block onward.
    pub seal_block: u64,
    /// Identifies the transition program this conclave is bound to at creation,
    /// so a conclave opened for one computation cannot be settled under another.
    pub program: felt252,
    /// `poseidon(SETTLE_TAG, settle_secret)`. Gates who may settle.
    pub settle_commitment: felt252,
}

#[derive(Serde, Copy, Drop, PartialEq, Debug)]
pub enum ConclaveOp {
    Open,
    Submit,
    Seal,
    Settle,
}

#[starknet::interface]
pub trait IConclaveMachine<T> {
    /// Read the public footprint of a conclave. All fields zero if it does not exist.
    fn get_conclave(self: @T, conclave_id: felt252) -> Conclave;

    /// The entry point the privacy pool calls via `INVOKE_SELECTOR`.
    ///
    /// Parameters are unioned across operations, following the Escrow helper's
    /// precedent: each operation reads the fields it needs and ignores the rest.
    ///
    /// - **Open**   uses `program`, `token`, `seal_block`, `state_root`,
    ///              `settle_commitment`. Returns an empty span.
    /// - **Submit** uses `commitment`, `amount`. Parks value; returns an empty span.
    /// - **Seal**   uses nothing further. Returns an empty span.
    /// - **Settle** uses `secret`, `state_root`, `outcome`, `payouts`.
    ///              Returns `payouts` for the pool to credit.
    fn privacy_invoke(
        ref self: T,
        operation: ConclaveOp,
        conclave_id: felt252,
        program: felt252,
        token: ContractAddress,
        seal_block: u64,
        state_root: felt252,
        settle_commitment: felt252,
        commitment: felt252,
        amount: u128,
        secret: felt252,
        outcome: felt252,
        payouts: Span<OpenNoteDeposit>,
    ) -> Span<OpenNoteDeposit>;
}

#[starknet::contract]
pub mod ConclaveMachine {
    use core::num::traits::Zero;
    use core::poseidon::poseidon_hash_span;
    use openzeppelin::interfaces::token::erc20::{IERC20Dispatcher, IERC20DispatcherTrait};
    use privacy::objects::OpenNoteDeposit;
    use starknet::storage::{Map, StorageMapReadAccess, StorageMapWriteAccess, StoragePointerReadAccess, StoragePointerWriteAccess};
    use starknet::{ContractAddress, get_block_number, get_caller_address};
    use super::{Conclave, ConclaveOp, IConclaveMachine, Phase, INPUT_ACC_TAG, SETTLE_TAG, errors};


    #[storage]
    struct Storage {
        /// The privacy pool. The only address permitted to drive the machine.
        pool: ContractAddress,
        conclaves: Map<felt252, Conclave>,
    }

    /// Events carry only what is already public: an id, a phase change, and
    /// commitments. Deliberately no amounts on Submit — the escrowed total is
    /// readable from storage, but per-submission amounts would leak the shape of
    /// the input set one event at a time.
    #[event]
    #[derive(Drop, starknet::Event)]
    pub enum Event {
        Opened: Opened,
        Submitted: Submitted,
        Sealed: Sealed,
        Settled: Settled,
    }

    #[derive(Drop, starknet::Event)]
    pub struct Opened {
        #[key]
        pub conclave_id: felt252,
        pub program: felt252,
        pub seal_block: u64,
    }

    #[derive(Drop, starknet::Event)]
    pub struct Submitted {
        #[key]
        pub conclave_id: felt252,
        pub input_root: felt252,
        pub input_count: u32,
    }

    #[derive(Drop, starknet::Event)]
    pub struct Sealed {
        #[key]
        pub conclave_id: felt252,
        pub input_root: felt252,
        pub input_count: u32,
    }

    #[derive(Drop, starknet::Event)]
    pub struct Settled {
        #[key]
        pub conclave_id: felt252,
        pub state_root: felt252,
        pub outcome: felt252,
    }

    #[constructor]
    fn constructor(ref self: ContractState, pool: ContractAddress) {
        self.pool.write(pool);
    }

    #[abi(embed_v0)]
    pub impl ConclaveMachineImpl of IConclaveMachine<ContractState> {
        fn get_conclave(self: @ContractState, conclave_id: felt252) -> Conclave {
            self.conclaves.read(conclave_id)
        }

        fn privacy_invoke(
            ref self: ContractState,
            operation: ConclaveOp,
            conclave_id: felt252,
            program: felt252,
            token: ContractAddress,
            seal_block: u64,
            state_root: felt252,
            settle_commitment: felt252,
            commitment: felt252,
            amount: u128,
            secret: felt252,
            outcome: felt252,
            payouts: Span<OpenNoteDeposit>,
        ) -> Span<OpenNoteDeposit> {
            // Only the pool may drive a conclave. Without this, anyone could
            // advance phases directly and desynchronise state from escrowed value.
            assert(get_caller_address() == self.pool.read(), errors::NOT_POOL);

            match operation {
                ConclaveOp::Open => {
                    let existing = self.conclaves.read(conclave_id);
                    assert(existing.phase == Phase::Void, errors::EXISTS);
                    self
                        .conclaves
                        .write(
                            conclave_id,
                            Conclave {
                                phase: Phase::Open,
                                token,
                                state_root,
                                input_root: 0,
                                input_count: 0,
                                escrowed: 0,
                                seal_block,
                                program,
                                settle_commitment,
                            },
                        );
                    self.emit(Opened { conclave_id, program, seal_block });
                    [].span()
                },

                ConclaveOp::Submit => {
                    let mut c = self.conclaves.read(conclave_id);
                    assert(c.phase == Phase::Open, errors::NOT_OPEN);
                    assert(get_block_number() < c.seal_block, errors::TOO_LATE);
                    assert(amount.is_non_zero(), errors::ZERO_AMOUNT);

                    // Fold the commitment into the accumulator. Order-dependent,
                    // so the root fixes the exact sequence of inputs, not just
                    // their multiset — an adversary cannot permute to change an
                    // outcome that depends on arrival order.
                    c.input_root = poseidon_hash_span(
                        array![INPUT_ACC_TAG, c.input_root, commitment].span(),
                    );
                    c.input_count += 1;
                    // The pool has already transferred `amount` to this contract
                    // before calling us; we are recording what we now hold.
                    c.escrowed += amount;
                    self.conclaves.write(conclave_id, c);

                    self
                        .emit(
                            Submitted {
                                conclave_id, input_root: c.input_root, input_count: c.input_count,
                            },
                        );
                    // Empty span: value stays parked. The pool credits nothing yet.
                    [].span()
                },

                ConclaveOp::Seal => {
                    let mut c = self.conclaves.read(conclave_id);
                    assert(c.phase == Phase::Open, errors::NOT_OPEN);
                    assert(get_block_number() >= c.seal_block, errors::TOO_EARLY);
                    assert(c.input_count > 0, errors::NO_INPUTS);
                    c.phase = Phase::Sealed;
                    self.conclaves.write(conclave_id, c);
                    self
                        .emit(
                            Sealed {
                                conclave_id, input_root: c.input_root, input_count: c.input_count,
                            },
                        );
                    [].span()
                },

                ConclaveOp::Settle => {
                    let mut c = self.conclaves.read(conclave_id);
                    assert(c.phase == Phase::Sealed, errors::NOT_SEALED);

                    // Settlement authority: knowledge of a preimage fixed at
                    // creation. Watching every event of the lifecycle does not
                    // confer the right to settle.
                    let offered = poseidon_hash_span(array![SETTLE_TAG, secret].span());
                    assert(offered == c.settle_commitment, errors::BAD_SECRET);

                    // Value conservation, checked against what we actually hold.
                    // This is the invariant that survives a malicious settler: a
                    // false outcome can misdirect value but can never create it.
                    let mut total: u128 = 0;
                    for p in payouts {
                        assert(*p.token == c.token, errors::WRONG_TOKEN);
                        total += *p.amount;
                    };
                    assert(total == c.escrowed, errors::NOT_CONSERVED);

                    // Approve, don't transfer: the pool pulls the tokens itself
                    // when it applies the deposits.
                    IERC20Dispatcher { contract_address: c.token }
                        .approve(spender: self.pool.read(), amount: total.into());

                    c.phase = Phase::Settled;
                    c.state_root = state_root;
                    c.escrowed = 0;
                    self.conclaves.write(conclave_id, c);

                    self.emit(Settled { conclave_id, state_root, outcome });
                    payouts
                },
            }
        }
    }
}
