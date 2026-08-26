//! # QuorumMachine
//!
//! Threshold coordination on the STRK20 pool.
//!
//! ## What this is for
//!
//! There is a class of action nobody can take alone. You cannot unionise
//! publicly — you are fired. You cannot report a serial harasser alone — you are
//! destroyed and they are not. You cannot commit to a boycott alone — it fails
//! and you are marked as the one who tried. You cannot be the first name on a
//! class action.
//!
//! In every case the obstacle is identical and it is not secrecy for its own
//! sake: **the first mover carries all the risk and receives none of the
//! benefit.** So no one moves, and the action that a majority privately wants
//! never happens. Economists call it a collective action problem; everyone else
//! calls it Tuesday.
//!
//! A threshold changes the payoff. If your commitment binds only once enough
//! others have committed, going first costs nothing. That is the whole
//! mechanism, and it has been understood for decades. What has never existed is
//! a way to run it where **the escrow is real money, the count is enforced by
//! something other than trust, and no participant is exposed if it fails.**
//!
//! ## Why the pool is what makes it possible
//!
//! Run this on a public chain and the pledges are public, which defeats it
//! entirely — the employer reads the list. Run it on a server and the operator
//! is a single point of coercion; a subpoena or a bribe unmasks everyone.
//!
//! On the STRK20 pool a pledge is a note. Value moves without naming who moved
//! it, the escrow is held by a contract rather than a company, and settlement is
//! atomic. The privacy is not a feature bolted onto a coordination app. Remove
//! it and there is no product, because there is no coordination.
//!
//! ## The invariant that actually matters
//!
//! Everything here rests on one promise to the person deciding whether to go
//! first: **if the quorum is not reached, you get your money back and you are
//! never revealed.** Take that away and the mechanism collapses back into
//! ordinary crowdfunding, where going first is a donation to a cause that may
//! not happen.
//!
//! So the contract enforces, unconditionally and on-chain:
//!
//!   1. **Threshold enforcement.** A campaign cannot fire below its quorum.
//!      Not "should not" — the transaction reverts.
//!   2. **Refund safety.** Once a campaign expires unfired, the *only* path
//!      left is refunds. Firing late is impossible, so a firer cannot sit on
//!      pledges waiting for a better moment.
//!   3. **Value conservation.** Payouts sum to exactly what was escrowed, in
//!      the token escrowed. The machine cannot mint, burn, or pay in an asset
//!      it never held.
//!   4. **Pledge-set immutability.** Each pledge folds into an order-dependent
//!      root, so the set is fixed the moment it is counted.
//!   5. **Reclaim is per-pledge and single-use.** A refund needs the preimage
//!      of that pledge's own commitment, and burns it.
//!
//! Together these mean a malicious firer — one who knows the fire secret and
//! wants to steal — can misdirect an outcome but cannot create value, cannot
//! fire a campaign that failed, and cannot prevent refunds once it has.
//!
//! Unofficial and unaudited. Own the review if you build on it.

use privacy::objects::OpenNoteDeposit;
use starknet::ContractAddress;

pub mod errors {
    pub const NOT_POOL: felt252 = 'QUORUM: caller not pool';
    pub const EXISTS: felt252 = 'QUORUM: id already used';
    pub const NOT_OPEN: felt252 = 'QUORUM: campaign not open';
    pub const EXPIRED: felt252 = 'QUORUM: campaign expired';
    pub const NOT_EXPIRED: felt252 = 'QUORUM: not expired yet';
    pub const BELOW_QUORUM: felt252 = 'QUORUM: below threshold';
    pub const QUORUM_MET: felt252 = 'QUORUM: quorum was met';
    pub const BAD_FIRE_SECRET: felt252 = 'QUORUM: bad fire secret';
    pub const BAD_PLEDGE_SECRET: felt252 = 'QUORUM: no such pledge';
    pub const ALREADY_CLAIMED: felt252 = 'QUORUM: pledge already back';
    pub const WRONG_TOKEN: felt252 = 'QUORUM: payout token differs';
    pub const NOT_CONSERVED: felt252 = 'QUORUM: value not conserved';
    pub const ZERO_AMOUNT: felt252 = 'QUORUM: zero amount';
    pub const ZERO_THRESHOLD: felt252 = 'QUORUM: threshold is zero';
    pub const DUPLICATE_PLEDGE: felt252 = 'QUORUM: pledge already made';
}

/// Domain separation. A preimage recovered in one context is inert in the others.
pub const PLEDGE_ACC_TAG: felt252 = 'QUORUM_PLEDGE_ACC';
pub const FIRE_TAG: felt252 = 'QUORUM_FIRE';
pub const REFUND_TAG: felt252 = 'QUORUM_REFUND';

/// Strictly monotonic. Void → Open → (Fired | Refunding).
#[derive(Serde, Copy, Drop, PartialEq, Debug, starknet::Store)]
pub enum Phase {
    /// No campaign at this id. The zero value, so an unwritten slot reads Void.
    #[default]
    Void,
    /// Accepting pledges.
    Open,
    /// Quorum reached and the action settled. Terminal.
    Fired,
    /// Expired without firing; pledges are reclaimable. Terminal for the campaign,
    /// though individual pledges are still being returned.
    Refunding,
}

/// The entire public footprint of a campaign.
///
/// Note what is *not* here: no list of pledgers, no per-pledge amounts, no way
/// to enumerate participants. The root fixes the set without describing it.
#[derive(Serde, Copy, Drop, PartialEq, Debug, starknet::Store)]
pub struct Campaign {
    pub phase: Phase,
    /// The single asset pledged and settled in.
    pub token: ContractAddress,
    /// Commitment to what participants are pledging *to*. Held off-chain and
    /// shown to each participant before they commit; on-chain it is only a hash,
    /// so the campaign's subject is not public until someone chooses to publish it.
    pub terms: felt252,
    /// Pledges required before the campaign may fire.
    pub threshold: u32,
    pub pledge_count: u32,
    /// Order-dependent fold over pledge commitments.
    pub pledge_root: felt252,
    /// Total value held for this campaign.
    pub escrowed: u128,
    /// Pledges are rejected from this block on, and refunds open.
    pub expiry_block: u64,
    /// `poseidon(FIRE_TAG, fire_secret)`. Gates who may fire.
    pub fire_commitment: felt252,
}

/// One pledge, stored against its own commitment so it can be refunded without
/// the contract ever knowing who made it.
#[derive(Serde, Copy, Drop, PartialEq, Debug, starknet::Store)]
pub struct Pledge {
    pub campaign_id: felt252,
    pub amount: u128,
    pub claimed: bool,
}

#[derive(Serde, Copy, Drop, PartialEq, Debug)]
pub enum QuorumOp {
    /// Open a campaign.
    Create,
    /// Commit value behind a sealed commitment.
    Commit,
    /// Quorum reached: settle and distribute.
    Fire,
    /// Expired unfired: take your pledge back.
    Reclaim,
}

#[starknet::interface]
pub trait IQuorumMachine<T> {
    /// Public state of a campaign. All fields zero if it does not exist.
    fn get_campaign(self: @T, campaign_id: felt252) -> Campaign;

    /// A pledge by its commitment. Reveals amount and whether it was refunded —
    /// never who made it.
    fn get_pledge(self: @T, commitment: felt252) -> Pledge;

    /// True once the campaign holds enough pledges to fire. Readable by anyone,
    /// which is deliberate: participants need to know the quorum is in reach
    /// without learning who is in it.
    fn quorum_reached(self: @T, campaign_id: felt252) -> bool;

    /// The entry point the privacy pool calls via `INVOKE_SELECTOR`.
    ///
    /// Parameters are unioned across operations, following the Escrow helper's
    /// precedent: each operation reads what it needs and ignores the rest.
    ///
    /// - **Create**  `terms`, `token`, `threshold`, `expiry_block`,
    ///               `fire_commitment`. Returns an empty span.
    /// - **Commit**  `commitment`, `amount`. Parks value; returns an empty span.
    /// - **Fire**    `secret`, `outcome`, `payouts`. Returns `payouts`.
    /// - **Reclaim** `secret`, `note_id`. Returns one deposit to the claimer.
    fn privacy_invoke(
        ref self: T,
        operation: QuorumOp,
        campaign_id: felt252,
        terms: felt252,
        token: ContractAddress,
        threshold: u32,
        expiry_block: u64,
        fire_commitment: felt252,
        commitment: felt252,
        amount: u128,
        secret: felt252,
        note_id: felt252,
        outcome: felt252,
        payouts: Span<OpenNoteDeposit>,
    ) -> Span<OpenNoteDeposit>;
}

#[starknet::contract]
pub mod QuorumMachine {
    use core::num::traits::Zero;
    use core::poseidon::poseidon_hash_span;
    use openzeppelin::interfaces::token::erc20::{IERC20Dispatcher, IERC20DispatcherTrait};
    use privacy::objects::OpenNoteDeposit;
    use starknet::storage::{
        Map, StorageMapReadAccess, StorageMapWriteAccess, StoragePointerReadAccess,
        StoragePointerWriteAccess,
    };
    use starknet::{ContractAddress, get_block_number, get_caller_address};
    use super::{
        Campaign, IQuorumMachine, Phase, Pledge, QuorumOp, errors, FIRE_TAG, PLEDGE_ACC_TAG,
        REFUND_TAG,
    };

    #[storage]
    struct Storage {
        /// The privacy pool. The only address permitted to drive the machine.
        pool: ContractAddress,
        campaigns: Map<felt252, Campaign>,
        /// Pledges by their own commitment. Never by pledger — the contract has
        /// no idea who anyone is, and that is the point rather than a limitation.
        pledges: Map<felt252, Pledge>,
    }

    /// Events carry only what is already public, and deliberately omit per-pledge
    /// amounts: the escrowed total is readable from storage, but emitting each
    /// pledge's size would leak the shape of the participant set one event at a
    /// time — and in a campaign where amounts vary by role or seniority, that is
    /// often enough to identify someone.
    #[event]
    #[derive(Drop, starknet::Event)]
    pub enum Event {
        Created: Created,
        Committed: Committed,
        QuorumReached: QuorumReached,
        Fired: Fired,
        Reclaimed: Reclaimed,
    }

    #[derive(Drop, starknet::Event)]
    pub struct Created {
        #[key]
        pub campaign_id: felt252,
        pub terms: felt252,
        pub threshold: u32,
        pub expiry_block: u64,
    }

    #[derive(Drop, starknet::Event)]
    pub struct Committed {
        #[key]
        pub campaign_id: felt252,
        pub pledge_root: felt252,
        pub pledge_count: u32,
    }

    /// Announced the moment the quorum is met, because participants need to know
    /// the threshold is in reach. It says how many, never who.
    #[derive(Drop, starknet::Event)]
    pub struct QuorumReached {
        #[key]
        pub campaign_id: felt252,
        pub pledge_count: u32,
        pub threshold: u32,
    }

    #[derive(Drop, starknet::Event)]
    pub struct Fired {
        #[key]
        pub campaign_id: felt252,
        pub outcome: felt252,
        pub pledge_count: u32,
    }

    #[derive(Drop, starknet::Event)]
    pub struct Reclaimed {
        #[key]
        pub campaign_id: felt252,
        pub remaining: u128,
    }

    #[constructor]
    fn constructor(ref self: ContractState, pool: ContractAddress) {
        self.pool.write(pool);
    }

    #[abi(embed_v0)]
    pub impl QuorumMachineImpl of IQuorumMachine<ContractState> {
        fn get_campaign(self: @ContractState, campaign_id: felt252) -> Campaign {
            self.campaigns.read(campaign_id)
        }

        fn get_pledge(self: @ContractState, commitment: felt252) -> Pledge {
            self.pledges.read(commitment)
        }

        fn quorum_reached(self: @ContractState, campaign_id: felt252) -> bool {
            let c = self.campaigns.read(campaign_id);
            c.phase != Phase::Void && c.pledge_count >= c.threshold
        }

        fn privacy_invoke(
            ref self: ContractState,
            operation: QuorumOp,
            campaign_id: felt252,
            terms: felt252,
            token: ContractAddress,
            threshold: u32,
            expiry_block: u64,
            fire_commitment: felt252,
            commitment: felt252,
            amount: u128,
            secret: felt252,
            note_id: felt252,
            outcome: felt252,
            payouts: Span<OpenNoteDeposit>,
        ) -> Span<OpenNoteDeposit> {
            // Only the pool may drive a campaign. Without this anyone could
            // advance phases directly and desynchronise state from escrowed value.
            assert(get_caller_address() == self.pool.read(), errors::NOT_POOL);

            match operation {
                QuorumOp::Create => {
                    let existing = self.campaigns.read(campaign_id);
                    assert(existing.phase == Phase::Void, errors::EXISTS);
                    assert(threshold > 0, errors::ZERO_THRESHOLD);
                    self
                        .campaigns
                        .write(
                            campaign_id,
                            Campaign {
                                phase: Phase::Open,
                                token,
                                terms,
                                threshold,
                                pledge_count: 0,
                                pledge_root: 0,
                                escrowed: 0,
                                expiry_block,
                                fire_commitment,
                            },
                        );
                    self.emit(Created { campaign_id, terms, threshold, expiry_block });
                    [].span()
                },

                QuorumOp::Commit => {
                    let mut c = self.campaigns.read(campaign_id);
                    assert(c.phase == Phase::Open, errors::NOT_OPEN);
                    assert(get_block_number() < c.expiry_block, errors::EXPIRED);
                    assert(amount.is_non_zero(), errors::ZERO_AMOUNT);

                    // One pledge per commitment. Reusing one would let a pledger
                    // count twice toward a quorum while escrowing once, and would
                    // make the refund entry ambiguous.
                    let existing = self.pledges.read(commitment);
                    assert(existing.amount.is_zero(), errors::DUPLICATE_PLEDGE);

                    self
                        .pledges
                        .write(commitment, Pledge { campaign_id, amount, claimed: false });

                    // Order-dependent fold: the set is fixed as a sequence, so a
                    // pledge cannot be inserted, removed or reordered after the
                    // fact without changing a root already committed on-chain.
                    c.pledge_root = poseidon_hash_span(
                        array![PLEDGE_ACC_TAG, c.pledge_root, commitment].span(),
                    );
                    c.pledge_count += 1;
                    // The pool has already moved `amount` to this contract before
                    // calling us; we are recording what we now hold.
                    c.escrowed += amount;
                    self.campaigns.write(campaign_id, c);

                    self
                        .emit(
                            Committed {
                                campaign_id, pledge_root: c.pledge_root, pledge_count: c.pledge_count,
                            },
                        );
                    if c.pledge_count == c.threshold {
                        self
                            .emit(
                                QuorumReached {
                                    campaign_id,
                                    pledge_count: c.pledge_count,
                                    threshold: c.threshold,
                                },
                            );
                    };
                    // Empty span: value stays parked. Nothing is credited yet, and
                    // nothing is revealed.
                    [].span()
                },

                QuorumOp::Fire => {
                    let mut c = self.campaigns.read(campaign_id);
                    assert(c.phase == Phase::Open, errors::NOT_OPEN);
                    // Firing after expiry is impossible, so a firer holding the
                    // secret cannot sit on pledges waiting for a better moment.
                    // Once the window closes the money belongs to the pledgers.
                    assert(get_block_number() < c.expiry_block, errors::EXPIRED);
                    // The promise the whole mechanism rests on.
                    assert(c.pledge_count >= c.threshold, errors::BELOW_QUORUM);

                    let offered = poseidon_hash_span(array![FIRE_TAG, secret].span());
                    assert(offered == c.fire_commitment, errors::BAD_FIRE_SECRET);

                    // Value conservation, checked against what we actually hold.
                    // This is what survives a malicious firer: a false outcome can
                    // misdirect value, but it can never create it.
                    let mut total: u128 = 0;
                    for p in payouts {
                        assert(*p.token == c.token, errors::WRONG_TOKEN);
                        total += *p.amount;
                    };
                    assert(total == c.escrowed, errors::NOT_CONSERVED);

                    // Approve, don't transfer: the pool pulls when it applies deposits.
                    IERC20Dispatcher { contract_address: c.token }
                        .approve(spender: self.pool.read(), amount: total.into());

                    c.phase = Phase::Fired;
                    c.escrowed = 0;
                    self.campaigns.write(campaign_id, c);

                    self.emit(Fired { campaign_id, outcome, pledge_count: c.pledge_count });
                    payouts
                },

                QuorumOp::Reclaim => {
                    let mut c = self.campaigns.read(campaign_id);
                    // A fired campaign has already distributed; there is nothing
                    // to reclaim and the phase check says so rather than
                    // silently paying twice.
                    assert(
                        c.phase == Phase::Open || c.phase == Phase::Refunding, errors::NOT_OPEN,
                    );
                    assert(get_block_number() >= c.expiry_block, errors::NOT_EXPIRED);

                    // Prove ownership of this specific pledge. The contract learns
                    // nothing about the claimer beyond the fact that they knew a
                    // secret it never stored.
                    let offered = poseidon_hash_span(array![REFUND_TAG, secret].span());
                    let mut pledge = self.pledges.read(offered);
                    assert(pledge.campaign_id == campaign_id, errors::BAD_PLEDGE_SECRET);
                    assert(pledge.amount.is_non_zero(), errors::BAD_PLEDGE_SECRET);
                    assert(!pledge.claimed, errors::ALREADY_CLAIMED);

                    pledge.claimed = true;
                    self.pledges.write(offered, pledge);

                    c.phase = Phase::Refunding;
                    c.escrowed -= pledge.amount;
                    self.campaigns.write(campaign_id, c);

                    IERC20Dispatcher { contract_address: c.token }
                        .approve(spender: self.pool.read(), amount: pledge.amount.into());

                    self.emit(Reclaimed { campaign_id, remaining: c.escrowed });
                    [OpenNoteDeposit { note_id, token: c.token, amount: pledge.amount }].span()
                },
            }
        }
    }
}
