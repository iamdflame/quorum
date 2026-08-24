//! Minimal ERC-20 for tests only.
//!
//! ConclaveMachine approves the pool to pull settled tokens, so exercising
//! settlement needs a real token to approve against. Hand-rolled rather than
//! pulled from a preset: the tests assert on allowance and balance directly,
//! and a mock small enough to read entirely is worth more here than one with
//! features the contract never touches.

use starknet::ContractAddress;

#[starknet::interface]
pub trait IMockERC20<T> {
    fn balance_of(self: @T, account: ContractAddress) -> u256;
    fn allowance(self: @T, owner: ContractAddress, spender: ContractAddress) -> u256;
    fn approve(ref self: T, spender: ContractAddress, amount: u256) -> bool;
    fn transfer(ref self: T, recipient: ContractAddress, amount: u256) -> bool;
    fn transfer_from(
        ref self: T, sender: ContractAddress, recipient: ContractAddress, amount: u256,
    ) -> bool;
    fn mint(ref self: T, to: ContractAddress, amount: u256);
}

#[starknet::contract]
pub mod MockERC20 {
    use starknet::storage::{Map, StorageMapReadAccess, StorageMapWriteAccess};
    use starknet::{ContractAddress, get_caller_address};
    use super::IMockERC20;

    #[storage]
    struct Storage {
        balances: Map<ContractAddress, u256>,
        allowances: Map<(ContractAddress, ContractAddress), u256>,
    }

    #[abi(embed_v0)]
    pub impl MockERC20Impl of IMockERC20<ContractState> {
        fn balance_of(self: @ContractState, account: ContractAddress) -> u256 {
            self.balances.read(account)
        }
        fn allowance(
            self: @ContractState, owner: ContractAddress, spender: ContractAddress,
        ) -> u256 {
            self.allowances.read((owner, spender))
        }
        fn approve(ref self: ContractState, spender: ContractAddress, amount: u256) -> bool {
            self.allowances.write((get_caller_address(), spender), amount);
            true
        }
        fn transfer(ref self: ContractState, recipient: ContractAddress, amount: u256) -> bool {
            let from = get_caller_address();
            let bal = self.balances.read(from);
            assert(bal >= amount, 'MOCK: insufficient balance');
            self.balances.write(from, bal - amount);
            self.balances.write(recipient, self.balances.read(recipient) + amount);
            true
        }
        fn transfer_from(
            ref self: ContractState,
            sender: ContractAddress,
            recipient: ContractAddress,
            amount: u256,
        ) -> bool {
            let spender = get_caller_address();
            let allowed = self.allowances.read((sender, spender));
            assert(allowed >= amount, 'MOCK: insufficient allowance');
            let bal = self.balances.read(sender);
            assert(bal >= amount, 'MOCK: insufficient balance');
            self.allowances.write((sender, spender), allowed - amount);
            self.balances.write(sender, bal - amount);
            self.balances.write(recipient, self.balances.read(recipient) + amount);
            true
        }
        fn mint(ref self: ContractState, to: ContractAddress, amount: u256) {
            self.balances.write(to, self.balances.read(to) + amount);
        }
    }
}
