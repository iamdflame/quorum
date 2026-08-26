//! Invariant tests for QuorumMachine.
//!
//! The contract makes one promise to a person deciding whether to be the first
//! name on a list that could cost them their job: **if the quorum is not
//! reached, you get your money back and you are never revealed.**
//!
//! Everything below is an attempt to break that promise. The happy path is
//! almost incidental; a mechanism for collective action is worth nothing unless
//! it holds when the person running the campaign turns on the people in it.

use conclave::mock_erc20::{IMockERC20Dispatcher, IMockERC20DispatcherTrait};
use conclave::quorum::{
    Campaign, IQuorumMachineDispatcher, IQuorumMachineDispatcherTrait, Phase, QuorumOp, FIRE_TAG,
    PLEDGE_ACC_TAG, REFUND_TAG,
};
use core::poseidon::poseidon_hash_span;
use privacy::objects::OpenNoteDeposit;
use snforge_std::{
    ContractClassTrait, DeclareResultTrait, declare, start_cheat_block_number_global,
    start_cheat_caller_address,
};
use starknet::ContractAddress;

fn POOL() -> ContractAddress {
    0x9001.try_into().unwrap()
}
fn STRANGER() -> ContractAddress {
    0xbad.try_into().unwrap()
}

const ID: felt252 = 'walkout-2026';
const TERMS: felt252 = 'terms-hash';
const THRESHOLD: u32 = 5;
const EXPIRY: u64 = 1000;
const FIRE_SECRET: felt252 = 'organiser-key';

/// Five pledges of 100 each.
const PLEDGE: u128 = 100;
const FIVE_TOTAL: u128 = 500;

fn fire_commitment() -> felt252 {
    poseidon_hash_span(array![FIRE_TAG, FIRE_SECRET].span())
}
fn refund_commitment(secret: felt252) -> felt252 {
    poseidon_hash_span(array![REFUND_TAG, secret].span())
}
fn none() -> Span<OpenNoteDeposit> {
    array![].span()
}
fn zero_addr() -> ContractAddress {
    0.try_into().unwrap()
}

fn setup(funded: u128) -> (IQuorumMachineDispatcher, IMockERC20Dispatcher, ContractAddress) {
    let token_class = declare("MockERC20").unwrap().contract_class();
    let (token_addr, _) = token_class.deploy(@array![]).unwrap();
    let token = IMockERC20Dispatcher { contract_address: token_addr };

    let class = declare("QuorumMachine").unwrap().contract_class();
    let (addr, _) = class.deploy(@array![POOL().into()]).unwrap();
    let machine = IQuorumMachineDispatcher { contract_address: addr };

    // The pool moves pledged tokens to the helper before invoking it.
    token.mint(addr, funded.into());
    (machine, token, token_addr)
}

fn create(machine: IQuorumMachineDispatcher, token: ContractAddress, threshold: u32) {
    machine
        .privacy_invoke(
            QuorumOp::Create, ID, TERMS, token, threshold, EXPIRY, fire_commitment(), 0, 0, 0, 0,
            0, none(),
        );
}

fn commit(machine: IQuorumMachineDispatcher, secret: felt252, amount: u128) {
    machine
        .privacy_invoke(
            QuorumOp::Commit, ID, 0, zero_addr(), 0, 0, 0, refund_commitment(secret), amount, 0, 0,
            0, none(),
        );
}

fn fire(
    machine: IQuorumMachineDispatcher, secret: felt252, payouts: Span<OpenNoteDeposit>,
) -> Span<OpenNoteDeposit> {
    machine
        .privacy_invoke(
            QuorumOp::Fire, ID, 0, zero_addr(), 0, 0, 0, 0, 0, secret, 0, 'won', payouts,
        )
}

fn reclaim(
    machine: IQuorumMachineDispatcher, secret: felt252, note_id: felt252,
) -> Span<OpenNoteDeposit> {
    machine
        .privacy_invoke(
            QuorumOp::Reclaim, ID, 0, zero_addr(), 0, 0, 0, 0, 0, secret, note_id, 0, none(),
        )
}

/// A campaign one pledge short of its quorum, with the deadline passed.
fn failed_campaign() -> (IQuorumMachineDispatcher, IMockERC20Dispatcher, ContractAddress) {
    let (machine, token, token_addr) = setup(400);
    start_cheat_caller_address(machine.contract_address, POOL());
    start_cheat_block_number_global(10);
    create(machine, token_addr, THRESHOLD);
    commit(machine, 'a', PLEDGE);
    commit(machine, 'b', PLEDGE);
    commit(machine, 'c', PLEDGE);
    commit(machine, 'd', PLEDGE);
    start_cheat_block_number_global(EXPIRY + 1);
    (machine, token, token_addr)
}

/// A campaign that reached its quorum, still inside the window.
fn met_campaign() -> (IQuorumMachineDispatcher, IMockERC20Dispatcher, ContractAddress) {
    let (machine, token, token_addr) = setup(FIVE_TOTAL);
    start_cheat_caller_address(machine.contract_address, POOL());
    start_cheat_block_number_global(10);
    create(machine, token_addr, THRESHOLD);
    commit(machine, 'a', PLEDGE);
    commit(machine, 'b', PLEDGE);
    commit(machine, 'c', PLEDGE);
    commit(machine, 'd', PLEDGE);
    commit(machine, 'e', PLEDGE);
    (machine, token, token_addr)
}

// ------------------------------------------------------------- lifecycle

#[test]
fn create_opens_a_campaign_holding_nothing() {
    let (machine, _, token_addr) = setup(0);
    start_cheat_caller_address(machine.contract_address, POOL());
    create(machine, token_addr, THRESHOLD);

    let c: Campaign = machine.get_campaign(ID);
    assert(c.phase == Phase::Open, 'phase should be Open');
    assert(c.threshold == THRESHOLD, 'threshold recorded');
    assert(c.pledge_count == 0, 'no pledges yet');
    assert(c.escrowed == 0, 'nothing escrowed');
    assert(c.terms == TERMS, 'terms committed');
    assert(!machine.quorum_reached(ID), 'quorum not reached');
}

#[test]
#[should_panic(expected: 'QUORUM: threshold is zero')]
fn a_campaign_needs_a_real_threshold() {
    // A zero threshold fires on the first pledge, which is not coordination.
    let (machine, _, token_addr) = setup(0);
    start_cheat_caller_address(machine.contract_address, POOL());
    create(machine, token_addr, 0);
}

#[test]
#[should_panic(expected: 'QUORUM: caller not pool')]
fn only_the_pool_may_drive_the_machine() {
    let (machine, _, token_addr) = setup(0);
    start_cheat_caller_address(machine.contract_address, STRANGER());
    create(machine, token_addr, THRESHOLD);
}

// --------------------------------------------------------------- pledging

#[test]
fn pledges_accumulate_without_naming_anyone() {
    let (machine, _, token_addr) = setup(200);
    start_cheat_caller_address(machine.contract_address, POOL());
    start_cheat_block_number_global(10);
    create(machine, token_addr, THRESHOLD);

    commit(machine, 'a', PLEDGE);
    let first: Campaign = machine.get_campaign(ID);
    assert(first.pledge_count == 1, 'one pledge');
    assert(first.escrowed == PLEDGE, 'value parked');
    assert(first.pledge_root != 0, 'root advanced');

    commit(machine, 'b', PLEDGE);
    let second: Campaign = machine.get_campaign(ID);
    assert(second.pledge_count == 2, 'two pledges');
    assert(second.escrowed == 200, 'value accumulates');
    assert(second.pledge_root != first.pledge_root, 'root advanced again');
}

#[test]
fn the_root_depends_on_order_not_just_membership() {
    let (m1, _, t1) = setup(200);
    start_cheat_caller_address(m1.contract_address, POOL());
    start_cheat_block_number_global(10);
    create(m1, t1, THRESHOLD);
    commit(m1, 'a', PLEDGE);
    commit(m1, 'b', PLEDGE);
    let ab = m1.get_campaign(ID).pledge_root;

    let (m2, _, t2) = setup(200);
    start_cheat_caller_address(m2.contract_address, POOL());
    create(m2, t2, THRESHOLD);
    commit(m2, 'b', PLEDGE);
    commit(m2, 'a', PLEDGE);
    let ba = m2.get_campaign(ID).pledge_root;

    assert(ab != ba, 'order must change the root');
}

#[test]
#[should_panic(expected: 'QUORUM: pledge already made')]
fn the_same_pledge_cannot_be_counted_twice() {
    // Otherwise one participant reaches a quorum alone by re-committing, while
    // escrowing once - and the refund entry becomes ambiguous.
    let (machine, _, token_addr) = setup(200);
    start_cheat_caller_address(machine.contract_address, POOL());
    start_cheat_block_number_global(10);
    create(machine, token_addr, THRESHOLD);
    commit(machine, 'a', PLEDGE);
    commit(machine, 'a', PLEDGE);
}

#[test]
#[should_panic(expected: 'QUORUM: campaign expired')]
fn pledging_stops_at_the_deadline() {
    let (machine, _, token_addr) = setup(200);
    start_cheat_caller_address(machine.contract_address, POOL());
    start_cheat_block_number_global(10);
    create(machine, token_addr, THRESHOLD);
    start_cheat_block_number_global(EXPIRY);
    commit(machine, 'a', PLEDGE);
}

#[test]
#[should_panic(expected: 'QUORUM: zero amount')]
fn a_zero_pledge_is_rejected() {
    let (machine, _, token_addr) = setup(200);
    start_cheat_caller_address(machine.contract_address, POOL());
    start_cheat_block_number_global(10);
    create(machine, token_addr, THRESHOLD);
    commit(machine, 'a', 0);
}

#[test]
fn quorum_is_announced_the_moment_it_is_reached() {
    let (machine, _, _) = met_campaign();
    assert(machine.quorum_reached(ID), 'quorum reached');
    let c: Campaign = machine.get_campaign(ID);
    assert(c.pledge_count == THRESHOLD, 'exactly at threshold');
    assert(c.phase == Phase::Open, 'still open until fired');
}

// ------------------------------------------------- the promise: firing

#[test]
#[should_panic(expected: 'QUORUM: below threshold')]
fn a_campaign_cannot_fire_below_its_quorum() {
    // The invariant the entire mechanism rests on. Four pledged, five required,
    // and the organiser holds the correct secret and wants to proceed anyway.
    let (machine, _, token_addr) = setup(400);
    start_cheat_caller_address(machine.contract_address, POOL());
    start_cheat_block_number_global(10);
    create(machine, token_addr, THRESHOLD);
    commit(machine, 'a', PLEDGE);
    commit(machine, 'b', PLEDGE);
    commit(machine, 'c', PLEDGE);
    commit(machine, 'd', PLEDGE);
    fire(machine, FIRE_SECRET, array![OpenNoteDeposit { note_id: 1, token: token_addr, amount: 400 }].span());
}

#[test]
#[should_panic(expected: 'QUORUM: bad fire secret')]
fn firing_without_the_secret_is_rejected() {
    let (machine, _, token_addr) = met_campaign();
    fire(machine, 'wrong', array![OpenNoteDeposit { note_id: 1, token: token_addr, amount: FIVE_TOTAL }].span());
}

#[test]
#[should_panic(expected: 'QUORUM: campaign expired')]
fn a_quorum_that_was_met_still_cannot_fire_late() {
    // Liveness protection. An organiser who reached quorum but waited past the
    // deadline loses the right to act, and the money returns to the pledgers.
    // Without this they could hold a signed list indefinitely as leverage.
    let (machine, _, token_addr) = met_campaign();
    start_cheat_block_number_global(EXPIRY + 1);
    fire(machine, FIRE_SECRET, array![OpenNoteDeposit { note_id: 1, token: token_addr, amount: FIVE_TOTAL }].span());
}

#[test]
#[should_panic(expected: 'QUORUM: value not conserved')]
fn a_malicious_organiser_cannot_pay_out_more_than_was_pledged() {
    let (machine, _, token_addr) = met_campaign();
    fire(machine, FIRE_SECRET, array![OpenNoteDeposit { note_id: 1, token: token_addr, amount: FIVE_TOTAL + 1 }].span());
}

#[test]
#[should_panic(expected: 'QUORUM: value not conserved')]
fn an_organiser_cannot_strand_value_by_underpaying() {
    let (machine, _, token_addr) = met_campaign();
    fire(machine, FIRE_SECRET, array![OpenNoteDeposit { note_id: 1, token: token_addr, amount: FIVE_TOTAL - 1 }].span());
}

#[test]
#[should_panic(expected: 'QUORUM: payout token differs')]
fn an_organiser_cannot_pay_in_an_asset_never_pledged() {
    let (machine, _, _) = met_campaign();
    let other: ContractAddress = 0xfeed.try_into().unwrap();
    fire(machine, FIRE_SECRET, array![OpenNoteDeposit { note_id: 1, token: other, amount: FIVE_TOTAL }].span());
}

#[test]
fn a_met_campaign_fires_and_conserves_value() {
    let (machine, token, token_addr) = met_campaign();
    let payouts = array![
        OpenNoteDeposit { note_id: 1, token: token_addr, amount: 300 },
        OpenNoteDeposit { note_id: 2, token: token_addr, amount: 200 },
    ]
        .span();

    let returned = fire(machine, FIRE_SECRET, payouts);
    assert(returned.len() == 2, 'payouts returned to pool');
    assert(
        token.allowance(machine.contract_address, POOL()) == FIVE_TOTAL.into(),
        'pool approved for the total',
    );

    let c: Campaign = machine.get_campaign(ID);
    assert(c.phase == Phase::Fired, 'phase is Fired');
    assert(c.escrowed == 0, 'escrow released');
}

#[test]
#[should_panic(expected: 'QUORUM: campaign not open')]
fn a_campaign_cannot_fire_twice() {
    let (machine, _, token_addr) = met_campaign();
    let payouts = array![OpenNoteDeposit { note_id: 1, token: token_addr, amount: FIVE_TOTAL }].span();
    fire(machine, FIRE_SECRET, payouts);
    fire(machine, FIRE_SECRET, payouts);
}

// ------------------------------------------- the promise: getting out

#[test]
fn a_failed_campaign_returns_every_pledge_in_full() {
    // The reason anyone goes first. Four pledged, five were needed, the deadline
    // passed - and each of the four takes back exactly what they put in.
    let (machine, token, token_addr) = failed_campaign();

    let mut returned_total: u128 = 0;
    let mut i: u8 = 0;
    let secrets = array!['a', 'b', 'c', 'd'];
    while i < 4 {
        let deposits = reclaim(machine, *secrets.at(i.into()), (i + 1).into());
        assert(deposits.len() == 1, 'one deposit per reclaim');
        let d = *deposits.at(0);
        assert(d.amount == PLEDGE, 'exact amount returned');
        assert(d.token == token_addr, 'in the pledged token');
        returned_total += d.amount;
        i += 1;
    };

    assert(returned_total == 400, 'all four fully refunded');
    let c: Campaign = machine.get_campaign(ID);
    assert(c.phase == Phase::Refunding, 'phase is Refunding');
    assert(c.escrowed == 0, 'nothing left held');
    assert(token.allowance(machine.contract_address, POOL()) == PLEDGE.into(), 'last approval stands');
}

#[test]
#[should_panic(expected: 'QUORUM: not expired yet')]
fn a_pledge_cannot_be_withdrawn_before_the_deadline() {
    // Otherwise a pledger could watch the count and pull out just before quorum,
    // which is the collective action problem reintroduced through the back door.
    let (machine, _, _) = met_campaign();
    reclaim(machine, 'a', 1);
}

#[test]
#[should_panic(expected: 'QUORUM: campaign not open')]
fn a_fired_campaign_cannot_also_be_reclaimed() {
    let (machine, _, token_addr) = met_campaign();
    fire(machine, FIRE_SECRET, array![OpenNoteDeposit { note_id: 1, token: token_addr, amount: FIVE_TOTAL }].span());
    start_cheat_block_number_global(EXPIRY + 1);
    reclaim(machine, 'a', 9);
}

#[test]
#[should_panic(expected: 'QUORUM: pledge already back')]
fn a_pledge_can_only_be_reclaimed_once() {
    let (machine, _, _) = failed_campaign();
    reclaim(machine, 'a', 1);
    reclaim(machine, 'a', 2);
}

#[test]
#[should_panic(expected: 'QUORUM: no such pledge')]
fn a_stranger_cannot_reclaim_someone_elses_pledge() {
    let (machine, _, _) = failed_campaign();
    reclaim(machine, 'never-pledged', 1);
}

#[test]
fn a_pledge_reads_back_without_naming_its_owner() {
    let (machine, _, _) = failed_campaign();
    let p = machine.get_pledge(refund_commitment('a'));
    assert(p.campaign_id == ID, 'belongs to the campaign');
    assert(p.amount == PLEDGE, 'amount recorded');
    assert(!p.claimed, 'not yet reclaimed');
    // There is no owner field to read. The contract never knew.
}

// ------------------------------------------- cross-language conformance

/// The client computes commitments in TypeScript; the contract checks them in
/// Cairo. If those two implementations of Poseidon ever disagree, nothing throws
/// — pledges are simply unreclaimable and campaigns silently cannot fire, which
/// is the worst possible failure for a system whose entire promise is that you
/// can always get your money back.
///
/// These constants were produced by `starknet.js`
/// `hash.computePoseidonHashOnElements`. They are checked here so the two
/// implementations are pinned to each other rather than assumed equal.
#[test]
fn poseidon_matches_the_typescript_client() {
    // poseidon(FIRE_TAG, 'organiser-key')
    assert(
        poseidon_hash_span(array![FIRE_TAG, 'organiser-key'].span()) == 0x5e4f5b6a2de88f499f97193a56c996146e4da86ecb5717efe43c96b99468470,
        'fire commitment drifted',
    );
    // poseidon(REFUND_TAG, 'a')
    assert(
        poseidon_hash_span(array![REFUND_TAG, 'a'].span()) == 0x723a1fdb89394b78490e7f0a5679b744121ae254f15a3877e886cd0cb09622c,
        'refund commitment drifted',
    );
    // poseidon(PLEDGE_ACC_TAG, 0, 'a') — the first fold of an empty root
    assert(
        poseidon_hash_span(array![PLEDGE_ACC_TAG, 0, 'a'].span()) == 0x5991bef78f95d42e2b187573b6143e6f3081fa41359124785262ae781a2ce82,
        'accumulator drifted',
    );
}
