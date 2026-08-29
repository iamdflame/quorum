//! Invariant tests for QuorumMachine.
//!
//! The contract makes one promise to a person deciding whether to be the first
//! name on a list that could cost them their job: **below quorum nothing
//! happens, and nobody — including whoever started the campaign — can make it
//! happen or take the money.**
//!
//! Everything below tries to break that. The happy path is almost incidental.

use conclave::mock_erc20::{IMockERC20Dispatcher, IMockERC20DispatcherTrait};
use conclave::quorum::{
    Campaign, IQuorumMachineDispatcher, IQuorumMachineDispatcherTrait, PayoutPolicy, Phase,
    QuorumOp, PAYOUT_ACC_TAG, REFUND_TAG,
};
use core::poseidon::poseidon_hash_span;
use privacy::objects::OpenNoteDeposit;
use snforge_std::{
    ContractClassTrait, DeclareResultTrait, declare, start_cheat_block_number_global,
    start_cheat_caller_address,
};
use starknet::ContractAddress;

fn POOL() -> ContractAddress { 0x9001.try_into().unwrap() }
fn STRANGER() -> ContractAddress { 0xbad.try_into().unwrap() }
fn THIEF() -> felt252 { 0xf00d }

const ID: felt252 = 'walkout-2026';
const TERMS: felt252 = 'terms-hash';
const THRESHOLD: u32 = 5;
const UNIT: u128 = 100;
const START: u64 = 10;
const EXPIRY: u64 = 10_000;

fn refund_commitment(secret: felt252) -> felt252 {
    poseidon_hash_span(array![REFUND_TAG, secret].span())
}
fn none() -> Span<OpenNoteDeposit> { array![].span() }
fn zero_addr() -> ContractAddress { 0.try_into().unwrap() }

/// Fold a payout set exactly as the contract does.
fn payout_root(deposits: Span<OpenNoteDeposit>) -> felt252 {
    let mut root: felt252 = 0;
    for p in deposits {
        root = poseidon_hash_span(
            array![PAYOUT_ACC_TAG, root, *p.note_id, (*p.token).into(), (*p.amount).into()].span(),
        );
    };
    root
}

fn setup() -> (IQuorumMachineDispatcher, IMockERC20Dispatcher, ContractAddress) {
    let token_class = declare("MockERC20").unwrap().contract_class();
    let (token_addr, _) = token_class.deploy(@array![]).unwrap();
    let class = declare("QuorumMachine").unwrap().contract_class();
    let (addr, _) = class.deploy(@array![POOL().into()]).unwrap();
    (
        IQuorumMachineDispatcher { contract_address: addr },
        IMockERC20Dispatcher { contract_address: token_addr },
        token_addr,
    )
}

fn create(
    m: IQuorumMachineDispatcher, token: ContractAddress, policy: PayoutPolicy, root: felt252,
) {
    m
        .privacy_invoke(
            QuorumOp::Create, ID, TERMS, token, policy, root, UNIT, THRESHOLD, EXPIRY, 0, 0, 0, 0,
            none(),
        );
}

/// The pool moves tokens in, then calls. Mirrored exactly so the contract's
/// balance-delta accounting is exercised the way the chain will exercise it.
fn commit(
    m: IQuorumMachineDispatcher, t: IMockERC20Dispatcher, secret: felt252, amount: u128,
) {
    t.mint(m.contract_address, amount.into());
    m
        .privacy_invoke(
            QuorumOp::Commit, ID, 0, zero_addr(), PayoutPolicy::RefundAll, 0, 0, 0, 0,
            refund_commitment(secret), 0, 0, 0, none(),
        );
}

fn fire(m: IQuorumMachineDispatcher, payouts: Span<OpenNoteDeposit>) -> Span<OpenNoteDeposit> {
    m
        .privacy_invoke(
            QuorumOp::Fire, ID, 0, zero_addr(), PayoutPolicy::RefundAll, 0, 0, 0, 0, 0, 0, 0, 0,
            payouts,
        )
}

fn reclaim(m: IQuorumMachineDispatcher, secret: felt252, note: felt252) -> Span<OpenNoteDeposit> {
    m
        .privacy_invoke(
            QuorumOp::Reclaim, ID, 0, zero_addr(), PayoutPolicy::RefundAll, 0, 0, 0, 0, 0, secret,
            note, 0, none(),
        )
}

fn unseal(m: IQuorumMachineDispatcher, secret: felt252, payload: felt252) {
    m
        .privacy_invoke(
            QuorumOp::Unseal, ID, 0, zero_addr(), PayoutPolicy::RefundAll, 0, 0, 0, 0, 0, secret, 0,
            payload, none(),
        );
}

/// A RefundAll campaign at exactly quorum.
fn met_refund() -> (IQuorumMachineDispatcher, IMockERC20Dispatcher, ContractAddress) {
    let (m, t, addr) = setup();
    start_cheat_caller_address(m.contract_address, POOL());
    start_cheat_block_number_global(START);
    create(m, addr, PayoutPolicy::RefundAll, 0);
    commit(m, t, 'a', UNIT); commit(m, t, 'b', UNIT); commit(m, t, 'c', UNIT);
    commit(m, t, 'd', UNIT); commit(m, t, 'e', UNIT);
    (m, t, addr)
}

/// A BoundTreasury campaign at quorum, whose payouts were fixed at creation.
fn met_treasury() -> (IQuorumMachineDispatcher, IMockERC20Dispatcher, ContractAddress, Span<OpenNoteDeposit>) {
    let (m, t, addr) = setup();
    let agreed = array![
        OpenNoteDeposit { note_id: 'strike-fund', token: addr, amount: 500 },
    ].span();
    start_cheat_caller_address(m.contract_address, POOL());
    start_cheat_block_number_global(START);
    create(m, addr, PayoutPolicy::BoundTreasury, payout_root(agreed));
    commit(m, t, 'a', UNIT); commit(m, t, 'b', UNIT); commit(m, t, 'c', UNIT);
    commit(m, t, 'd', UNIT); commit(m, t, 'e', UNIT);
    (m, t, addr, agreed)
}

// ============================================================ the fatal one

#[test]
#[should_panic(expected: 'QUORUM: payouts not committed')]
fn a_firer_cannot_redirect_payouts_to_themselves() {
    // The test the previous version of this contract could not pass. Quorum is
    // met, the campaign is fireable, and the caller sends the entire pot to an
    // address of their choosing. Conservation is satisfied - the sums match
    // exactly - and it still reverts, because destinations were fixed before the
    // first pledge and this is not that set.
    let (m, _, addr, _) = met_treasury();
    let stolen = array![
        OpenNoteDeposit { note_id: THIEF(), token: addr, amount: 500 },
    ].span();
    fire(m, stolen);
}

#[test]
#[should_panic(expected: 'QUORUM: payouts not committed')]
fn a_firer_cannot_skim_a_slice_to_themselves() {
    // Subtler: pay the agreed treasury most of it and quietly take the rest.
    // Still a different fold, still refused.
    let (m, _, addr, _) = met_treasury();
    let skimmed = array![
        OpenNoteDeposit { note_id: 'strike-fund', token: addr, amount: 450 },
        OpenNoteDeposit { note_id: THIEF(), token: addr, amount: 50 },
    ].span();
    fire(m, skimmed);
}

#[test]
#[should_panic(expected: 'QUORUM: payouts not committed')]
fn payout_order_is_part_of_the_commitment() {
    let (m, t, addr) = setup();
    let agreed = array![
        OpenNoteDeposit { note_id: 'fund-a', token: addr, amount: 200 },
        OpenNoteDeposit { note_id: 'fund-b', token: addr, amount: 300 },
    ].span();
    start_cheat_caller_address(m.contract_address, POOL());
    start_cheat_block_number_global(START);
    create(m, addr, PayoutPolicy::BoundTreasury, payout_root(agreed));
    commit(m, t, 'a', UNIT); commit(m, t, 'b', UNIT); commit(m, t, 'c', UNIT);
    commit(m, t, 'd', UNIT); commit(m, t, 'e', UNIT);
    // Same amounts, same destinations, swapped. A different fold.
    fire(m, array![
        OpenNoteDeposit { note_id: 'fund-b', token: addr, amount: 300 },
        OpenNoteDeposit { note_id: 'fund-a', token: addr, amount: 200 },
    ].span());
}

#[test]
fn the_agreed_payout_set_fires() {
    let (m, t, addr, agreed) = met_treasury();
    let out = fire(m, agreed);
    assert(out.len() == 1, 'payouts returned to pool');
    assert(t.allowance(m.contract_address, POOL()) == 500_u256, 'pool approved for the total');
    let c: Campaign = m.get_campaign(ID);
    assert(c.phase == Phase::Fired, 'fired');
    assert(c.escrowed == 0, 'escrow released');
}

#[test]
#[should_panic(expected: 'QUORUM: refund-all moves none')]
fn a_refund_all_campaign_cannot_move_value_at_all() {
    // The mode with no way to steal, because there is no payout path.
    let (m, _, addr) = met_refund();
    fire(m, array![OpenNoteDeposit { note_id: THIEF(), token: addr, amount: 500 }].span());
}

// ================================================== permissionless firing

#[test]
fn fire_is_permissionless_once_quorum_is_met() {
    // No fire secret exists. Anyone may fire, so an organiser who loses a key,
    // is arrested, or simply changes their mind cannot bury a met quorum.
    let (m, _, _) = met_refund();
    let out = fire(m, none());
    assert(out.len() == 0, 'refund-all moves nothing');
    assert(m.get_campaign(ID).phase == Phase::Fired, 'anyone could fire it');
}

#[test]
#[should_panic(expected: 'QUORUM: below threshold')]
fn nobody_can_fire_below_quorum() {
    let (m, t, addr) = setup();
    start_cheat_caller_address(m.contract_address, POOL());
    start_cheat_block_number_global(START);
    create(m, addr, PayoutPolicy::RefundAll, 0);
    commit(m, t, 'a', UNIT); commit(m, t, 'b', UNIT);
    fire(m, none());
}

#[test]
#[should_panic(expected: 'QUORUM: campaign expired')]
fn a_met_quorum_still_cannot_fire_late() {
    let (m, _, _) = met_refund();
    start_cheat_block_number_global(EXPIRY + 1);
    fire(m, none());
}

// ================================================= measured, not believed

#[test]
fn commit_uses_the_balance_delta_not_the_calldata() {
    // The pool moves tokens and then calls. A helper that trusts a number in its
    // own calldata strands surplus forever or bricks the campaign; this measures.
    let (m, t, addr) = setup();
    start_cheat_caller_address(m.contract_address, POOL());
    start_cheat_block_number_global(START);
    create(m, addr, PayoutPolicy::RefundAll, 0);
    commit(m, t, 'a', UNIT);
    assert(m.get_campaign(ID).escrowed == UNIT, 'escrow is the delta');
    assert(m.held(addr) == UNIT, 'held tracks the balance');
}

#[test]
#[should_panic(expected: 'QUORUM: pledge must be the unit')]
fn a_pledge_below_the_unit_reverts() {
    // Dust would otherwise buy a place in a count threshold.
    let (m, t, addr) = setup();
    start_cheat_caller_address(m.contract_address, POOL());
    start_cheat_block_number_global(START);
    create(m, addr, PayoutPolicy::RefundAll, 0);
    commit(m, t, 'a', 1);
}

#[test]
#[should_panic(expected: 'QUORUM: pledge must be the unit')]
fn a_pledge_above_the_unit_reverts() {
    // Every pledge identical is what makes the public transfer uninformative.
    let (m, t, addr) = setup();
    start_cheat_caller_address(m.contract_address, POOL());
    start_cheat_block_number_global(START);
    create(m, addr, PayoutPolicy::RefundAll, 0);
    commit(m, t, 'a', UNIT + 1);
}

#[test]
fn held_falls_back_to_zero_once_everything_is_returned() {
    // Stranded value would show up here as a non-zero remainder.
    let (m, _, addr) = met_refund();
    fire(m, none());
    reclaim(m, 'a', 1); reclaim(m, 'b', 2); reclaim(m, 'c', 3);
    reclaim(m, 'd', 4); reclaim(m, 'e', 5);
    assert(m.held(addr) == 0, 'nothing stranded');
    assert(m.get_campaign(ID).escrowed == 0, 'escrow empty');
}

// ============================================== creation is not permissive

#[test]
#[should_panic(expected: 'QUORUM: expiry not in future')]
fn a_campaign_cannot_be_born_expired() {
    let (m, _, addr) = setup();
    start_cheat_caller_address(m.contract_address, POOL());
    // Past the expiry the campaign would be created with: pledges could never
    // be made, and never refunded.
    start_cheat_block_number_global(EXPIRY + 1);
    create(m, addr, PayoutPolicy::RefundAll, 0);
}

#[test]
#[should_panic(expected: 'QUORUM: window too short')]
fn a_window_too_short_to_gather_anyone_reverts() {
    // Expiry cannot be changed later, and a window computed on a 30s block
    // assumption closes seventeen times too early.
    let (m, _, addr) = setup();
    start_cheat_caller_address(m.contract_address, POOL());
    start_cheat_block_number_global(EXPIRY - 100);
    create(m, addr, PayoutPolicy::RefundAll, 0);
}

#[test]
#[should_panic(expected: 'QUORUM: no payout root')]
fn a_treasury_campaign_must_commit_its_destinations_up_front() {
    let (m, _, addr) = setup();
    start_cheat_caller_address(m.contract_address, POOL());
    start_cheat_block_number_global(START);
    create(m, addr, PayoutPolicy::BoundTreasury, 0);
}

#[test]
#[should_panic(expected: 'QUORUM: threshold below two')]
fn a_threshold_of_one_is_not_coordination() {
    let (m, _, addr) = setup();
    start_cheat_caller_address(m.contract_address, POOL());
    start_cheat_block_number_global(START);
    m.privacy_invoke(
        QuorumOp::Create, ID, TERMS, addr, PayoutPolicy::RefundAll, 0, UNIT, 1, EXPIRY, 0, 0, 0, 0,
        none(),
    );
}

#[test]
#[should_panic(expected: 'QUORUM: unit is zero')]
fn a_zero_unit_reverts() {
    let (m, _, addr) = setup();
    start_cheat_caller_address(m.contract_address, POOL());
    start_cheat_block_number_global(START);
    m.privacy_invoke(
        QuorumOp::Create, ID, TERMS, addr, PayoutPolicy::RefundAll, 0, 0, THRESHOLD, EXPIRY, 0, 0,
        0, 0, none(),
    );
}

#[test]
#[should_panic(expected: 'QUORUM: caller not pool')]
fn only_the_pool_may_drive_the_machine() {
    let (m, _, addr) = setup();
    start_cheat_caller_address(m.contract_address, STRANGER());
    start_cheat_block_number_global(START);
    create(m, addr, PayoutPolicy::RefundAll, 0);
}

// ==================================================== the escrow itself

#[test]
#[should_panic(expected: 'QUORUM: not fired')]
fn unseal_reverts_before_quorum() {
    // The chain refuses a disclosure below quorum even from someone who has
    // decided to make one. That refusal is what protects whoever would be first.
    let (m, t, addr) = setup();
    start_cheat_caller_address(m.contract_address, POOL());
    start_cheat_block_number_global(START);
    create(m, addr, PayoutPolicy::RefundAll, 0);
    commit(m, t, 'a', UNIT); commit(m, t, 'b', UNIT);
    unseal(m, 'a', 'my name and what happened');
}

#[test]
#[should_panic(expected: 'QUORUM: not fired')]
fn unseal_reverts_on_a_campaign_that_failed() {
    let (m, t, addr) = setup();
    start_cheat_caller_address(m.contract_address, POOL());
    start_cheat_block_number_global(START);
    create(m, addr, PayoutPolicy::RefundAll, 0);
    commit(m, t, 'a', UNIT); commit(m, t, 'b', UNIT);
    start_cheat_block_number_global(EXPIRY + 1);
    unseal(m, 'a', 'my name');
}

#[test]
fn unseal_after_fire_records_a_payload_and_names_nobody() {
    let (m, _, _) = met_refund();
    fire(m, none());
    unseal(m, 'a', 'payload-commitment');
    let p = m.get_pledge(refund_commitment('a'));
    assert(p.payload == 'payload-commitment', 'payload recorded');
    // There is no owner field to read. The contract never knew.
    assert(p.campaign_id == ID, 'belongs to the campaign');
}

#[test]
#[should_panic(expected: 'QUORUM: already unsealed')]
fn a_payload_cannot_be_replaced_once_posted() {
    let (m, _, _) = met_refund();
    fire(m, none());
    unseal(m, 'a', 'first');
    unseal(m, 'a', 'second');
}

#[test]
#[should_panic(expected: 'QUORUM: no such pledge')]
fn a_stranger_cannot_unseal_into_a_campaign() {
    let (m, _, _) = met_refund();
    fire(m, none());
    unseal(m, 'never-pledged', 'noise');
}

// ============================================== getting out, either way

#[test]
fn a_failed_campaign_returns_every_pledge_in_full() {
    let (m, t, addr) = setup();
    start_cheat_caller_address(m.contract_address, POOL());
    start_cheat_block_number_global(START);
    create(m, addr, PayoutPolicy::RefundAll, 0);
    commit(m, t, 'a', UNIT); commit(m, t, 'b', UNIT); commit(m, t, 'c', UNIT);
    start_cheat_block_number_global(EXPIRY + 1);

    let mut total: u128 = 0;
    let secrets = array!['a', 'b', 'c'];
    let mut i: u32 = 0;
    while i < 3 {
        let out = reclaim(m, *secrets.at(i), (i + 1).into());
        assert(out.len() == 1, 'one deposit per reclaim');
        assert(*out.at(0).amount == UNIT, 'exact unit returned');
        total += *out.at(0).amount;
        i += 1;
    };
    assert(total == 3 * UNIT, 'all three refunded');
    assert(m.get_campaign(ID).phase == Phase::Refunding, 'refunding');
    assert(m.held(addr) == 0, 'nothing stranded');
}

#[test]
fn a_fired_refund_all_campaign_still_returns_the_money() {
    // Quorum was reached; the point was the set opening, not the money moving.
    let (m, _, _) = met_refund();
    fire(m, none());
    let out = reclaim(m, 'a', 1);
    assert(*out.at(0).amount == UNIT, 'pledge came home');
}

#[test]
#[should_panic(expected: 'QUORUM: not expired yet')]
fn a_pledge_cannot_be_withdrawn_before_the_deadline() {
    let (m, t, addr) = setup();
    start_cheat_caller_address(m.contract_address, POOL());
    start_cheat_block_number_global(START);
    create(m, addr, PayoutPolicy::RefundAll, 0);
    commit(m, t, 'a', UNIT);
    reclaim(m, 'a', 1);
}

#[test]
#[should_panic(expected: 'QUORUM: pledge already back')]
fn a_pledge_can_only_be_reclaimed_once() {
    let (m, _, _) = met_refund();
    fire(m, none());
    reclaim(m, 'a', 1);
    reclaim(m, 'a', 2);
}

#[test]
#[should_panic(expected: 'QUORUM: no such pledge')]
fn a_stranger_cannot_reclaim_someone_elses_pledge() {
    let (m, _, _) = met_refund();
    fire(m, none());
    reclaim(m, 'never-pledged', 1);
}

#[test]
#[should_panic(expected: 'QUORUM: pledge already made')]
fn the_same_commitment_cannot_be_counted_twice() {
    let (m, t, addr) = setup();
    start_cheat_caller_address(m.contract_address, POOL());
    start_cheat_block_number_global(START);
    create(m, addr, PayoutPolicy::RefundAll, 0);
    commit(m, t, 'a', UNIT);
    commit(m, t, 'a', UNIT);
}

// ============================================================ bookkeeping

#[test]
fn the_pledge_root_depends_on_order_not_just_membership() {
    let (m1, t1, a1) = setup();
    start_cheat_caller_address(m1.contract_address, POOL());
    start_cheat_block_number_global(START);
    create(m1, a1, PayoutPolicy::RefundAll, 0);
    commit(m1, t1, 'a', UNIT); commit(m1, t1, 'b', UNIT);
    let ab = m1.get_campaign(ID).pledge_root;

    let (m2, t2, a2) = setup();
    start_cheat_caller_address(m2.contract_address, POOL());
    create(m2, a2, PayoutPolicy::RefundAll, 0);
    commit(m2, t2, 'b', UNIT); commit(m2, t2, 'a', UNIT);
    assert(ab != m2.get_campaign(ID).pledge_root, 'order changes the root');
}

#[test]
fn a_campaign_publishes_its_terms_threshold_and_unit_but_no_participants() {
    let (m, _, addr) = setup();
    start_cheat_caller_address(m.contract_address, POOL());
    start_cheat_block_number_global(START);
    create(m, addr, PayoutPolicy::RefundAll, 0);
    let c: Campaign = m.get_campaign(ID);
    assert(c.terms == TERMS, 'terms committed');
    assert(c.threshold == THRESHOLD, 'threshold public');
    assert(c.unit == UNIT, 'unit public');
    assert(c.pledge_count == 0, 'nobody yet');
    assert(!m.quorum_reached(ID), 'not reached');
}

#[test]
fn an_unknown_campaign_reads_as_void() {
    let (m, _, _) = setup();
    assert(m.get_campaign('never-opened').phase == Phase::Void, 'void');
}
