//! Invariant tests for ConclaveMachine.
//!
//! The contract's claim is that four properties hold *even against a malicious
//! settler* — someone holding the settlement secret who wants to steal. A claim
//! like that is worth nothing untested, so the adversarial cases are the point
//! of this file and the happy path is almost incidental.

use conclave::conclave::{
    Conclave, ConclaveOp, IConclaveMachineDispatcher, IConclaveMachineDispatcherTrait, Phase,
    SETTLE_TAG,
};
use conclave::mock_erc20::{IMockERC20Dispatcher, IMockERC20DispatcherTrait};
use core::poseidon::poseidon_hash_span;
use privacy::objects::OpenNoteDeposit;
use snforge_std::{
    ContractClassTrait, DeclareResultTrait, declare, start_cheat_block_number_global,
    start_cheat_caller_address, stop_cheat_caller_address,
};
use starknet::ContractAddress;

fn POOL() -> ContractAddress {
    0x9001.try_into().unwrap()
}
fn STRANGER() -> ContractAddress {
    0xbad.try_into().unwrap()
}

const ID: felt252 = 'conclave-1';
const PROGRAM: felt252 = 'vickrey-v1';
const SEAL_BLOCK: u64 = 1000;
const SECRET: felt252 = 'open-sesame';
const ESCROW: u128 = 900;

fn settle_commitment() -> felt252 {
    poseidon_hash_span(array![SETTLE_TAG, SECRET].span())
}

/// Deploy the machine plus a token, and fund the machine as the pool would have.
fn setup() -> (IConclaveMachineDispatcher, IMockERC20Dispatcher, ContractAddress) {
    let token_class = declare("MockERC20").unwrap().contract_class();
    let (token_addr, _) = token_class.deploy(@array![]).unwrap();
    let token = IMockERC20Dispatcher { contract_address: token_addr };

    let class = declare("ConclaveMachine").unwrap().contract_class();
    let (addr, _) = class.deploy(@array![POOL().into()]).unwrap();
    let machine = IConclaveMachineDispatcher { contract_address: addr };

    // The pool transfers input tokens to the helper before invoking it.
    token.mint(addr, ESCROW.into());
    (machine, token, token_addr)
}

fn no_payouts() -> Span<OpenNoteDeposit> {
    array![].span()
}

fn open(machine: IConclaveMachineDispatcher, token: ContractAddress) {
    machine
        .privacy_invoke(
            ConclaveOp::Open, ID, PROGRAM, token, SEAL_BLOCK, 'state0', settle_commitment(), 0, 0,
            0, 0, no_payouts(),
        );
}

fn submit(machine: IConclaveMachineDispatcher, commitment: felt252, amount: u128) {
    machine
        .privacy_invoke(
            ConclaveOp::Submit, ID, 0, 0.try_into().unwrap(), 0, 0, 0, commitment, amount, 0, 0,
            no_payouts(),
        );
}

fn seal(machine: IConclaveMachineDispatcher) {
    machine
        .privacy_invoke(
            ConclaveOp::Seal, ID, 0, 0.try_into().unwrap(), 0, 0, 0, 0, 0, 0, 0, no_payouts(),
        );
}

fn settle(
    machine: IConclaveMachineDispatcher, secret: felt252, payouts: Span<OpenNoteDeposit>,
) -> Span<OpenNoteDeposit> {
    machine
        .privacy_invoke(
            ConclaveOp::Settle, ID, 0, 0.try_into().unwrap(), 0, 'state1', 0, 0, 0, secret,
            'winner', payouts,
        )
}

/// Open, take two submissions totalling ESCROW, and seal.
fn sealed_conclave() -> (IConclaveMachineDispatcher, IMockERC20Dispatcher, ContractAddress) {
    let (machine, token, token_addr) = setup();
    start_cheat_caller_address(machine.contract_address, POOL());
    start_cheat_block_number_global(500);
    open(machine, token_addr);
    submit(machine, 'bid-a', 400);
    submit(machine, 'bid-b', 500);
    start_cheat_block_number_global(SEAL_BLOCK + 1);
    seal(machine);
    (machine, token, token_addr)
}

// ---------------------------------------------------------------- lifecycle

#[test]
fn open_writes_exactly_one_conclave() {
    let (machine, _, token_addr) = setup();
    start_cheat_caller_address(machine.contract_address, POOL());
    open(machine, token_addr);

    let c: Conclave = machine.get_conclave(ID);
    assert(c.phase == Phase::Open, 'phase should be Open');
    assert(c.program == PROGRAM, 'program bound at creation');
    assert(c.escrowed == 0, 'nothing escrowed yet');
    assert(c.input_count == 0, 'no inputs yet');
    assert(c.state_root == 'state0', 'initial state committed');
}

#[test]
fn unknown_id_reads_as_void() {
    let (machine, _, _) = setup();
    let c: Conclave = machine.get_conclave('never-opened');
    assert(c.phase == Phase::Void, 'unwritten slot is Void');
}

#[test]
#[should_panic(expected: 'CONCLAVE: caller not pool')]
fn only_the_pool_may_drive_the_machine() {
    let (machine, _, token_addr) = setup();
    start_cheat_caller_address(machine.contract_address, STRANGER());
    open(machine, token_addr);
}

#[test]
#[should_panic(expected: 'CONCLAVE: id already used')]
fn an_id_cannot_be_reused() {
    let (machine, _, token_addr) = setup();
    start_cheat_caller_address(machine.contract_address, POOL());
    open(machine, token_addr);
    open(machine, token_addr);
}

// ------------------------------------------------- input-set immutability

#[test]
fn submissions_park_value_and_fold_into_the_root() {
    let (machine, _, token_addr) = setup();
    start_cheat_caller_address(machine.contract_address, POOL());
    start_cheat_block_number_global(500);
    open(machine, token_addr);

    submit(machine, 'bid-a', 400);
    let after_first: Conclave = machine.get_conclave(ID);
    assert(after_first.escrowed == 400, 'value parked');
    assert(after_first.input_count == 1, 'one input');
    assert(after_first.input_root != 0, 'root advanced');

    submit(machine, 'bid-b', 500);
    let after_second: Conclave = machine.get_conclave(ID);
    assert(after_second.escrowed == 900, 'value accumulates');
    assert(after_second.input_count == 2, 'two inputs');
    assert(after_second.input_root != after_first.input_root, 'root advanced again');
}

#[test]
fn the_root_depends_on_order_not_just_membership() {
    // The same two commitments in the opposite order must produce a different
    // root. Without this an adversary could permute submissions to change an
    // outcome that depends on arrival order, and the seal would not notice.
    let (m1, _, t1) = setup();
    start_cheat_caller_address(m1.contract_address, POOL());
    start_cheat_block_number_global(500);
    open(m1, t1);
    submit(m1, 'bid-a', 400);
    submit(m1, 'bid-b', 500);
    let root_ab = m1.get_conclave(ID).input_root;
    stop_cheat_caller_address(m1.contract_address);

    let (m2, _, t2) = setup();
    start_cheat_caller_address(m2.contract_address, POOL());
    open(m2, t2);
    submit(m2, 'bid-b', 500);
    submit(m2, 'bid-a', 400);
    let root_ba = m2.get_conclave(ID).input_root;

    assert(root_ab != root_ba, 'order must change the root');
}

#[test]
#[should_panic(expected: 'CONCLAVE: submissions closed')]
fn submissions_stop_at_the_seal_block() {
    let (machine, _, token_addr) = setup();
    start_cheat_caller_address(machine.contract_address, POOL());
    start_cheat_block_number_global(500);
    open(machine, token_addr);
    start_cheat_block_number_global(SEAL_BLOCK);
    submit(machine, 'too-late', 100);
}

#[test]
#[should_panic(expected: 'CONCLAVE: zero amount')]
fn a_zero_submission_is_rejected() {
    let (machine, _, token_addr) = setup();
    start_cheat_caller_address(machine.contract_address, POOL());
    start_cheat_block_number_global(500);
    open(machine, token_addr);
    submit(machine, 'empty', 0);
}

#[test]
#[should_panic(expected: 'CONCLAVE: seal block unreached')]
fn sealing_early_is_rejected() {
    let (machine, _, token_addr) = setup();
    start_cheat_caller_address(machine.contract_address, POOL());
    start_cheat_block_number_global(500);
    open(machine, token_addr);
    submit(machine, 'bid-a', 400);
    seal(machine);
}

#[test]
#[should_panic(expected: 'CONCLAVE: no inputs')]
fn an_empty_conclave_cannot_be_sealed() {
    let (machine, _, token_addr) = setup();
    start_cheat_caller_address(machine.contract_address, POOL());
    start_cheat_block_number_global(500);
    open(machine, token_addr);
    start_cheat_block_number_global(SEAL_BLOCK + 1);
    seal(machine);
}

#[test]
#[should_panic(expected: 'CONCLAVE: not open')]
fn a_sealed_conclave_takes_no_more_input() {
    let (machine, _, _) = sealed_conclave();
    submit(machine, 'late', 100);
}

// --------------------------------------------- settlement authority & value

#[test]
#[should_panic(expected: 'CONCLAVE: not sealed')]
fn an_unsealed_conclave_cannot_settle() {
    let (machine, _, token_addr) = setup();
    start_cheat_caller_address(machine.contract_address, POOL());
    start_cheat_block_number_global(500);
    open(machine, token_addr);
    submit(machine, 'bid-a', 900);
    settle(
        machine, SECRET,
        array![OpenNoteDeposit { note_id: 1, token: token_addr, amount: 900 }].span(),
    );
}

#[test]
#[should_panic(expected: 'CONCLAVE: bad settle secret')]
fn settling_without_the_secret_is_rejected() {
    let (machine, _, token_addr) = sealed_conclave();
    settle(
        machine, 'wrong-secret',
        array![OpenNoteDeposit { note_id: 1, token: token_addr, amount: ESCROW }].span(),
    );
}

#[test]
#[should_panic(expected: 'CONCLAVE: value not conserved')]
fn a_malicious_settler_cannot_pay_out_more_than_was_escrowed() {
    // The headline invariant. This settler holds the correct secret and is
    // trying to steal: 900 went in, 901 is claimed. Authority to settle is not
    // authority to mint.
    let (machine, _, token_addr) = sealed_conclave();
    settle(
        machine, SECRET,
        array![OpenNoteDeposit { note_id: 1, token: token_addr, amount: ESCROW + 1 }].span(),
    );
}

#[test]
#[should_panic(expected: 'CONCLAVE: value not conserved')]
fn a_settler_cannot_strand_value_by_underpaying() {
    // Conservation runs both ways: leaving value behind would let a settler
    // park funds in the helper outside the pool's accounting.
    let (machine, _, token_addr) = sealed_conclave();
    settle(
        machine, SECRET,
        array![OpenNoteDeposit { note_id: 1, token: token_addr, amount: ESCROW - 1 }].span(),
    );
}

#[test]
#[should_panic(expected: 'CONCLAVE: value not conserved')]
fn splitting_a_payout_still_has_to_add_up() {
    let (machine, _, token_addr) = sealed_conclave();
    settle(
        machine, SECRET,
        array![
            OpenNoteDeposit { note_id: 1, token: token_addr, amount: 500 },
            OpenNoteDeposit { note_id: 2, token: token_addr, amount: 500 },
        ]
            .span(),
    );
}

#[test]
#[should_panic(expected: 'CONCLAVE: payout token differs')]
fn a_settler_cannot_pay_in_an_asset_the_conclave_never_held() {
    let (machine, _, _) = sealed_conclave();
    let other: ContractAddress = 0xfeed.try_into().unwrap();
    settle(
        machine, SECRET,
        array![OpenNoteDeposit { note_id: 1, token: other, amount: ESCROW }].span(),
    );
}

#[test]
fn an_honest_settlement_conserves_value_and_approves_the_pool() {
    let (machine, token, token_addr) = sealed_conclave();
    let payouts = array![
        OpenNoteDeposit { note_id: 1, token: token_addr, amount: 700 },
        OpenNoteDeposit { note_id: 2, token: token_addr, amount: 200 },
    ]
        .span();

    let returned = settle(machine, SECRET, payouts);
    assert(returned.len() == 2, 'payouts returned to pool');

    // Approve, don't transfer: the pool pulls the tokens itself.
    let allowance = token.allowance(machine.contract_address, POOL());
    assert(allowance == ESCROW.into(), 'pool approved for exact total');

    let c: Conclave = machine.get_conclave(ID);
    assert(c.phase == Phase::Settled, 'phase is Settled');
    assert(c.escrowed == 0, 'escrow released');
    assert(c.state_root == 'state1', 'new state committed');
}

#[test]
#[should_panic(expected: 'CONCLAVE: not sealed')]
fn a_conclave_cannot_be_settled_twice() {
    let (machine, _, token_addr) = sealed_conclave();
    let payouts = array![OpenNoteDeposit { note_id: 1, token: token_addr, amount: ESCROW }].span();
    settle(machine, SECRET, payouts);
    settle(machine, SECRET, payouts);
}
