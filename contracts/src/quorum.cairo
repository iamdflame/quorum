//! # QuorumMachine
//!
//! An information escrow with money as the bond.
//!
//! ## What this is for
//!
//! There is a class of action nobody can take alone. You cannot unionise
//! publicly — you are fired. You cannot report a serial harasser alone — you are
//! destroyed and they are not. You cannot be the first name on a class action.
//! The obstacle is always the same and it is not secrecy for its own sake:
//! **the first mover carries all the risk and receives none of the benefit.**
//!
//! A threshold inverts that. If your commitment binds only once enough others
//! have committed, going first costs nothing. Ayres and Nalebuff called the
//! shape an *information escrow*; Callisto built one for campus assault reports
//! that opens only when a second report names the same person.
//!
//! Callisto's own threat model has the hole every version of this has had: the
//! operator can read the set. A subpoena, a bribe, or one disgruntled engineer
//! unmasks everyone. **This contract is an attempt to build the same mechanism
//! with nobody in that position.**
//!
//! ## The organiser is not a superuser
//!
//! An earlier version of this contract let whoever held a fire secret choose the
//! payout destinations at fire time. Conservation checked that the sums matched;
//! nothing checked where the money went. That is not an information escrow. It
//! is a private pot with a threshold and a keyholder, and it fails for the exact
//! reason Callisto fails if the campus admin can redirect the reports.
//!
//! So the organiser is gone:
//!
//! - **Destinations are fixed at creation.** `BoundTreasury` campaigns commit to
//!   a `payout_root` before a single pledge arrives; fire must reproduce that set
//!   exactly. `RefundAll` campaigns cannot move value at all — every pledge
//!   returns to the pledger, and the only thing that happens at quorum is that
//!   the set becomes readable to the people in it.
//! - **Firing is permissionless.** Once the quorum is met and the window is open,
//!   anyone may fire. There is no key to lose, no key to steal, and nobody who
//!   can sit on a signed list as leverage.
//!
//! There is no privileged party left. The organiser can start a campaign and
//! that is the whole of their power.
//!
//! ## Sybil, and why every pledge is the same size
//!
//! A count threshold with free pledges is not a threshold. One person with forty
//! secrets is forty pledges.
//!
//! The pool will not tell a helper contract who is calling — that is precisely
//! what it is for — so identity cannot be bound here. What can be bound is
//! **price**: every pledge in a campaign must be exactly `unit`. Forty fake
//! pledges cost forty units, so the threshold means something again, and the
//! attack is bounded by money rather than by imagination.
//!
//! It buys a second thing. Every pledge being identical means the public transfer
//! into this contract carries no information: an observer sees `unit`, which they
//! already knew from the campaign. Variable pledges would have leaked seniority,
//! salary, and conviction, one transfer at a time.
//!
//! ## Value is measured, never taken on trust
//!
//! The pool moves tokens to this contract and *then* calls it, so a helper that
//! believes the amount in its own calldata is trusting a number it was handed.
//! Under-report and the surplus is stranded here forever; over-report and the
//! campaign can never fire, because its escrow will never match its balance.
//!
//! Every operation therefore measures the ERC-20 balance and works from the
//! delta. `held` tracks what the contract knows it holds, so the difference
//! between that and the true balance is exactly what just arrived.
//!
//! ## What is public, stated exactly
//!
//! | | |
//! |---|---|
//! | who pledged | **hidden** — a pledge is a note in the pool |
//! | how much | **uninformative** — every pledge is `unit`, published at creation |
//! | how many, live | **not emitted** — no event carries a running count |
//! | how many, on demand | **readable** — `get_campaign` is a public view |
//! | that a campaign exists | **public** — terms hash, threshold, unit, expiry |
//! | when each pledge landed | **public** — one pool transaction per pledge |
//!
//! The count is deliberately kept out of events so an employer watching the chain
//! sees ordinary pool traffic rather than a live counter climbing toward a strike.
//! Anyone who calls the view still learns it. That is a real limit, not a
//! rounding error, and it is written down rather than implied away.
//!
//! Unaudited. Own the review if you build on it.

use privacy::objects::OpenNoteDeposit;
use starknet::ContractAddress;

pub mod errors {
    pub const NOT_POOL: felt252 = 'QUORUM: caller not pool';
    pub const EXISTS: felt252 = 'QUORUM: id already used';
    pub const NOT_OPEN: felt252 = 'QUORUM: campaign not open';
    pub const EXPIRED: felt252 = 'QUORUM: campaign expired';
    pub const NOT_EXPIRED: felt252 = 'QUORUM: not expired yet';
    pub const BELOW_QUORUM: felt252 = 'QUORUM: below threshold';
    pub const BAD_PLEDGE_SECRET: felt252 = 'QUORUM: no such pledge';
    pub const ALREADY_CLAIMED: felt252 = 'QUORUM: pledge already back';
    pub const WRONG_TOKEN: felt252 = 'QUORUM: payout token differs';
    pub const NOT_CONSERVED: felt252 = 'QUORUM: value not conserved';
    pub const UNBOUND_PAYOUT: felt252 = 'QUORUM: payouts not committed';
    pub const NO_PAYOUTS_ALLOWED: felt252 = 'QUORUM: refund-all moves none';
    pub const WRONG_UNIT: felt252 = 'QUORUM: pledge must be the unit';
    pub const ZERO_UNIT: felt252 = 'QUORUM: unit is zero';
    pub const ZERO_THRESHOLD: felt252 = 'QUORUM: threshold below two';
    pub const ZERO_TOKEN: felt252 = 'QUORUM: token is zero';
    pub const PAST_EXPIRY: felt252 = 'QUORUM: expiry not in future';
    pub const WINDOW_TOO_SHORT: felt252 = 'QUORUM: window too short';
    pub const NO_PAYOUT_ROOT: felt252 = 'QUORUM: no payout root';
    pub const DUPLICATE_PLEDGE: felt252 = 'QUORUM: pledge already made';
    pub const NOT_FIRED: felt252 = 'QUORUM: not fired';
    pub const ALREADY_UNSEALED: felt252 = 'QUORUM: already unsealed';
    pub const NOT_REFUND_ALL: felt252 = 'QUORUM: not a refund campaign';
}

/// Domain separation. A preimage recovered in one context is inert in the others.
pub const PLEDGE_ACC_TAG: felt252 = 'QUORUM_PLEDGE_ACC';
pub const PAYOUT_ACC_TAG: felt252 = 'QUORUM_PAYOUT_ACC';
pub const REFUND_TAG: felt252 = 'QUORUM_REFUND';

/// The shortest window a campaign may have.
///
/// Starknet produces a block roughly every 1.7 seconds, so this is about fifteen
/// minutes. Expiry cannot be changed after creation, and a window set on a 30s
/// block assumption closes seventeen times too early — silently, in the one
/// direction that looks exactly like nobody wanted to join.
pub const MIN_WINDOW_BLOCKS: u64 = 530;

#[derive(Serde, Copy, Drop, PartialEq, Debug, starknet::Store)]
pub enum Phase {
    #[default]
    Void,
    Open,
    /// Quorum reached and settled. Payloads may now be unsealed.
    Fired,
    /// Expired below quorum. Pledges are reclaimable; nothing else can happen.
    Refunding,
}

/// Where value may go, decided before anyone pledges.
#[derive(Serde, Copy, Drop, PartialEq, Debug, starknet::Store)]
pub enum PayoutPolicy {
    /// Value never moves. Every pledge returns to the pledger, and the only
    /// consequence of quorum is that the set opens to the people inside it.
    /// This is the pure information escrow, and the mode with no way to steal.
    #[default]
    RefundAll,
    /// Value goes to a set of notes fixed at creation. Fire must reproduce that
    /// set exactly, so the destinations are known to every pledger before they
    /// commit and cannot be chosen afterwards by anybody.
    BoundTreasury,
}

/// The entire public footprint of a campaign. No participant list, no per-pledge
/// amounts, no way to enumerate anyone — the root fixes the set without
/// describing it.
#[derive(Serde, Copy, Drop, PartialEq, Debug, starknet::Store)]
pub struct Campaign {
    pub phase: Phase,
    pub token: ContractAddress,
    /// Commitment to what people are pledging to. Held off-chain; a campaign's
    /// subject is often more dangerous than its participant list.
    pub terms: felt252,
    pub policy: PayoutPolicy,
    /// Fold over the committed payout set. Zero for `RefundAll`.
    pub payout_root: felt252,
    /// Exact size of every pledge.
    pub unit: u128,
    pub threshold: u32,
    pub pledge_count: u32,
    pub pledge_root: felt252,
    pub escrowed: u128,
    pub expiry_block: u64,
}

/// One pledge, stored against its own commitment so it can be refunded and can
/// speak after quorum without the contract ever learning who made it.
#[derive(Serde, Copy, Drop, PartialEq, Debug, starknet::Store)]
pub struct Pledge {
    pub campaign_id: felt252,
    pub amount: u128,
    pub claimed: bool,
    /// Posted only after fire. Zero until then.
    pub payload: felt252,
}

#[derive(Serde, Copy, Drop, PartialEq, Debug)]
pub enum QuorumOp {
    Create,
    Commit,
    /// Permissionless once the quorum is met and the window is open.
    Fire,
    /// Take a pledge back: after expiry below quorum, or after a RefundAll fire.
    Reclaim,
    /// Publish a sealed payload. Only possible once the campaign has fired, so
    /// the chain itself refuses to accept a disclosure below quorum.
    Unseal,
}

#[starknet::interface]
pub trait IQuorumMachine<T> {
    fn get_campaign(self: @T, campaign_id: felt252) -> Campaign;
    fn get_pledge(self: @T, commitment: felt252) -> Pledge;
    fn quorum_reached(self: @T, campaign_id: felt252) -> bool;
    /// What this contract believes it holds of a token, for reconciling against
    /// the real ERC-20 balance. Stranded value is visible rather than invisible.
    fn held(self: @T, token: ContractAddress) -> u128;

    /// The entry point the privacy pool calls via `INVOKE_SELECTOR`.
    fn privacy_invoke(
        ref self: T,
        operation: QuorumOp,
        campaign_id: felt252,
        terms: felt252,
        token: ContractAddress,
        policy: PayoutPolicy,
        payout_root: felt252,
        unit: u128,
        threshold: u32,
        expiry_block: u64,
        commitment: felt252,
        secret: felt252,
        note_id: felt252,
        payload: felt252,
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
    use starknet::{ContractAddress, get_block_number, get_caller_address, get_contract_address};
    use super::{
        Campaign, IQuorumMachine, PayoutPolicy, Phase, Pledge, QuorumOp, errors, MIN_WINDOW_BLOCKS,
        PAYOUT_ACC_TAG, PLEDGE_ACC_TAG, REFUND_TAG,
    };

    #[storage]
    struct Storage {
        pool: ContractAddress,
        campaigns: Map<felt252, Campaign>,
        pledges: Map<felt252, Pledge>,
        /// What we believe we hold, per token. The gap between this and the real
        /// ERC-20 balance is exactly what the pool just moved in, which is how
        /// every amount here is measured rather than believed.
        held: Map<ContractAddress, u128>,
    }

    /// Events carry only what is already public and deliberately omit the running
    /// count. An employer watching this contract should see ordinary pool traffic,
    /// not a counter climbing toward a strike. The count is still readable through
    /// the view — this narrows the audience, it does not hide it, and pretending
    /// otherwise would be the kind of claim this contract exists to avoid.
    #[event]
    #[derive(Drop, starknet::Event)]
    pub enum Event {
        Created: Created,
        Committed: Committed,
        Fired: Fired,
        Reclaimed: Reclaimed,
        Unsealed: Unsealed,
    }

    #[derive(Drop, starknet::Event)]
    pub struct Created {
        #[key]
        pub campaign_id: felt252,
        pub terms: felt252,
        pub threshold: u32,
        pub unit: u128,
        pub expiry_block: u64,
        pub payout_root: felt252,
    }

    /// No count, no root, no amount. A pledge happened; that is all it says.
    #[derive(Drop, starknet::Event)]
    pub struct Committed {
        #[key]
        pub campaign_id: felt252,
    }

    #[derive(Drop, starknet::Event)]
    pub struct Fired {
        #[key]
        pub campaign_id: felt252,
        pub pledge_count: u32,
        pub pledge_root: felt252,
    }

    #[derive(Drop, starknet::Event)]
    pub struct Reclaimed {
        #[key]
        pub campaign_id: felt252,
    }

    #[derive(Drop, starknet::Event)]
    pub struct Unsealed {
        #[key]
        pub campaign_id: felt252,
        pub payload: felt252,
    }

    #[constructor]
    fn constructor(ref self: ContractState, pool: ContractAddress) {
        self.pool.write(pool);
    }

    #[generate_trait]
    impl Internal of InternalTrait {
        /// What arrived since we last looked. The pool transfers before it calls,
        /// so this is the only honest way to learn a pledge's size.
        fn take_delta(ref self: ContractState, token: ContractAddress) -> u128 {
            let actual: u256 = IERC20Dispatcher { contract_address: token }
                .balance_of(get_contract_address());
            let actual_u128: u128 = actual.try_into().unwrap();
            let known = self.held.read(token);
            let delta = actual_u128 - known;
            self.held.write(token, actual_u128);
            delta
        }

        /// Approve the pool to pull, and drop our accounting by the same amount so
        /// the next delta is measured from the right baseline.
        fn release(ref self: ContractState, token: ContractAddress, amount: u128) {
            IERC20Dispatcher { contract_address: token }
                .approve(spender: self.pool.read(), amount: amount.into());
            self.held.write(token, self.held.read(token) - amount);
        }
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
        fn held(self: @ContractState, token: ContractAddress) -> u128 {
            self.held.read(token)
        }

        fn privacy_invoke(
            ref self: ContractState,
            operation: QuorumOp,
            campaign_id: felt252,
            terms: felt252,
            token: ContractAddress,
            policy: PayoutPolicy,
            payout_root: felt252,
            unit: u128,
            threshold: u32,
            expiry_block: u64,
            commitment: felt252,
            secret: felt252,
            note_id: felt252,
            payload: felt252,
            payouts: Span<OpenNoteDeposit>,
        ) -> Span<OpenNoteDeposit> {
            assert(get_caller_address() == self.pool.read(), errors::NOT_POOL);
            let now = get_block_number();

            match operation {
                QuorumOp::Create => {
                    assert(self.campaigns.read(campaign_id).phase == Phase::Void, errors::EXISTS);
                    // A threshold of one fires on the first pledge, which is a
                    // donation with extra steps, not coordination.
                    assert(threshold >= 2, errors::ZERO_THRESHOLD);
                    assert(unit.is_non_zero(), errors::ZERO_UNIT);
                    assert(token.is_non_zero(), errors::ZERO_TOKEN);
                    assert(expiry_block > now, errors::PAST_EXPIRY);
                    // Expiry cannot be changed later, so a window too short to
                    // gather anyone is a mistake the contract refuses to make.
                    assert(expiry_block - now >= MIN_WINDOW_BLOCKS, errors::WINDOW_TOO_SHORT);
                    if policy == PayoutPolicy::BoundTreasury {
                        // Destinations must exist before the first pledge, or the
                        // campaign is a pot with a keyholder again.
                        assert(payout_root.is_non_zero(), errors::NO_PAYOUT_ROOT);
                    }

                    self
                        .campaigns
                        .write(
                            campaign_id,
                            Campaign {
                                phase: Phase::Open,
                                token,
                                terms,
                                policy,
                                payout_root,
                                unit,
                                threshold,
                                pledge_count: 0,
                                pledge_root: 0,
                                escrowed: 0,
                                expiry_block,
                            },
                        );
                    self
                        .emit(
                            Created {
                                campaign_id, terms, threshold, unit, expiry_block, payout_root,
                            },
                        );
                    [].span()
                },

                QuorumOp::Commit => {
                    let mut c = self.campaigns.read(campaign_id);
                    assert(c.phase == Phase::Open, errors::NOT_OPEN);
                    assert(now < c.expiry_block, errors::EXPIRED);
                    assert(self.pledges.read(commitment).amount.is_zero(), errors::DUPLICATE_PLEDGE);

                    // Measured, not claimed. Every pledge is the same size, so a
                    // fake pledge costs a real unit and the public transfer says
                    // nothing an observer did not already know.
                    let delta = self.take_delta(c.token);
                    assert(delta == c.unit, errors::WRONG_UNIT);

                    self
                        .pledges
                        .write(
                            commitment,
                            Pledge { campaign_id, amount: delta, claimed: false, payload: 0 },
                        );

                    c.pledge_root = poseidon_hash_span(
                        array![PLEDGE_ACC_TAG, c.pledge_root, commitment].span(),
                    );
                    c.pledge_count += 1;
                    c.escrowed += delta;
                    self.campaigns.write(campaign_id, c);

                    self.emit(Committed { campaign_id });
                    [].span()
                },

                QuorumOp::Fire => {
                    let mut c = self.campaigns.read(campaign_id);
                    assert(c.phase == Phase::Open, errors::NOT_OPEN);
                    // Firing late is impossible, so nobody can hold a met quorum
                    // as leverage. Anyone may fire, so nobody's absence can bury it.
                    assert(now < c.expiry_block, errors::EXPIRED);
                    assert(c.pledge_count >= c.threshold, errors::BELOW_QUORUM);

                    match c.policy {
                        PayoutPolicy::RefundAll => {
                            // Value cannot move. The consequence of quorum is that
                            // the set opens, not that money changes hands.
                            assert(payouts.len() == 0, errors::NO_PAYOUTS_ALLOWED);
                            c.phase = Phase::Fired;
                            self.campaigns.write(campaign_id, c);
                            self
                                .emit(
                                    Fired {
                                        campaign_id,
                                        pledge_count: c.pledge_count,
                                        pledge_root: c.pledge_root,
                                    },
                                );
                            [].span()
                        },
                        PayoutPolicy::BoundTreasury => {
                            // Fold the offered payouts and require the exact root
                            // committed at creation. This is what makes theft
                            // impossible rather than merely detectable: a payout to
                            // an address nobody agreed to produces a different root.
                            let mut root: felt252 = 0;
                            let mut total: u128 = 0;
                            for p in payouts {
                                assert(*p.token == c.token, errors::WRONG_TOKEN);
                                total += *p.amount;
                                root =
                                    poseidon_hash_span(
                                        array![
                                            PAYOUT_ACC_TAG,
                                            root,
                                            *p.note_id,
                                            (*p.token).into(),
                                            (*p.amount).into(),
                                        ]
                                            .span(),
                                    );
                            };
                            assert(root == c.payout_root, errors::UNBOUND_PAYOUT);
                            assert(total == c.escrowed, errors::NOT_CONSERVED);

                            self.release(c.token, total);
                            c.phase = Phase::Fired;
                            c.escrowed = 0;
                            self.campaigns.write(campaign_id, c);
                            self
                                .emit(
                                    Fired {
                                        campaign_id,
                                        pledge_count: c.pledge_count,
                                        pledge_root: c.pledge_root,
                                    },
                                );
                            payouts
                        },
                    }
                },

                QuorumOp::Reclaim => {
                    let mut c = self.campaigns.read(campaign_id);
                    // Two ways a pledge comes home: the campaign failed, or it
                    // succeeded and never moved value in the first place.
                    let failed = (c.phase == Phase::Open || c.phase == Phase::Refunding)
                        && now >= c.expiry_block;
                    let refund_all_fired = c.phase == Phase::Fired
                        && c.policy == PayoutPolicy::RefundAll;
                    assert(failed || refund_all_fired, errors::NOT_EXPIRED);

                    let offered = poseidon_hash_span(array![REFUND_TAG, secret].span());
                    let mut pledge = self.pledges.read(offered);
                    assert(pledge.campaign_id == campaign_id, errors::BAD_PLEDGE_SECRET);
                    assert(pledge.amount.is_non_zero(), errors::BAD_PLEDGE_SECRET);
                    assert(!pledge.claimed, errors::ALREADY_CLAIMED);

                    pledge.claimed = true;
                    self.pledges.write(offered, pledge);

                    if c.phase == Phase::Open {
                        c.phase = Phase::Refunding;
                    }
                    c.escrowed -= pledge.amount;
                    self.campaigns.write(campaign_id, c);

                    self.release(c.token, pledge.amount);
                    self.emit(Reclaimed { campaign_id });
                    [OpenNoteDeposit { note_id, token: c.token, amount: pledge.amount }].span()
                },

                QuorumOp::Unseal => {
                    let c = self.campaigns.read(campaign_id);
                    // The escrow itself. Below quorum this entry point reverts, so
                    // the chain will not accept a disclosure even from someone who
                    // has decided to make one — which is what protects the person
                    // who would otherwise be first.
                    assert(c.phase == Phase::Fired, errors::NOT_FIRED);

                    let offered = poseidon_hash_span(array![REFUND_TAG, secret].span());
                    let mut pledge = self.pledges.read(offered);
                    assert(pledge.campaign_id == campaign_id, errors::BAD_PLEDGE_SECRET);
                    assert(pledge.amount.is_non_zero(), errors::BAD_PLEDGE_SECRET);
                    assert(pledge.payload.is_zero(), errors::ALREADY_UNSEALED);

                    pledge.payload = payload;
                    self.pledges.write(offered, pledge);

                    // The payload is a commitment the pledgers can open among
                    // themselves. It names nobody on chain.
                    self.emit(Unsealed { campaign_id, payload });
                    [].span()
                },
            }
        }
    }
}
