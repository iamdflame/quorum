# Deployments

`QuorumMachine` — threshold coordination, wired to the STRK20 privacy pool on each network.

**Class hash (both networks)**
`0x04a3ad9409c4f4acc72b9fda88410161044e44eb2aa6ab403d08d3ac7de4d4f7`

Same bytecode on testnet and mainnet, so production runs exactly what the tests rehearsed.

## Starknet mainnet

| | |
|---|---|
| **QuorumMachine** | [`0x00dca84ff35ee793c69c983abfc29e3e1aa8790f7dcd7e0288b705f600fcdaf7`](https://voyager.online/contract/0x00dca84ff35ee793c69c983abfc29e3e1aa8790f7dcd7e0288b705f600fcdaf7) |
| constructor `pool` | [`0x040337b1af3c663e86e333bab5a4b28da8d4652a15a69beee2b677776ffe812a`](https://voyager.online/contract/0x040337b1af3c663e86e333bab5a4b28da8d4652a15a69beee2b677776ffe812a) — the live STRK20 pool |
| deploy tx | [`0x0487c8b492361acdf48bf691ee61f56884734dc0e84980ffccc18b128ee3dd49`](https://voyager.online/tx/0x0487c8b492361acdf48bf691ee61f56884734dc0e84980ffccc18b128ee3dd49) |

## Starknet Sepolia

| | |
|---|---|
| **QuorumMachine** | [`0x07d639ca00289a59a6949a12f6470feadf74d905d01bcce331f6c9d1d775fc73`](https://sepolia.voyager.online/contract/0x07d639ca00289a59a6949a12f6470feadf74d905d01bcce331f6c9d1d775fc73) |
| constructor `pool` | `0x0254a6b2997ef52e9f830ce1f543f6b29768295e8d17e2267d672c552cfe0d91` |
| deploy tx | [`0x076032ab7a20ff0b7a324157e403062eba3a756421fa70a44514cdb0ee7d0c65`](https://sepolia.voyager.online/tx/0x076032ab7a20ff0b7a324157e403062eba3a756421fa70a44514cdb0ee7d0c65) |

## Superseded

An earlier `QuorumMachine` at [`0x06d3f070…8c08`](https://voyager.online/contract/0x06d3f070a8732b1272ac7e73527187ce08da502839b18fc30a481a79512b8c08) let whoever held a fire secret choose payout destinations at fire time. Conservation checked that the sums matched; nothing checked where the money went. It is left on chain rather than pretended away — it holds nothing and no campaign was ever opened on it — and it is superseded by the deployment above, where destinations are committed at creation and firing is permissionless.

`ConclaveMachine` at [`0x0269fa8c…ecfc`](https://voyager.online/contract/0x0269fa8cd8a7a04f5cd5b2fda7139efebb99511e2dde4778ba9395948a62ecfc) is a general private state machine from earlier work in this repository. It is not part of the Quorum submission.

## A campaign that ran

`demo-70414` completed on mainnet: created at block 14,024,487, two further pledges, fired at 14,024,923. All four transactions ran through the machine, and `npm run verify` checks each against the panel's criteria.

## Verify

```bash
# Phase::Void for an id nobody opened — eleven fields, all zero.
curl -s -X POST https://api.cartridge.gg/x/starknet/mainnet \
  -H 'Content-Type: application/json' -d '{
    "jsonrpc":"2.0","id":1,"method":"starknet_call","params":[{
      "contract_address":"0x00dca84ff35ee793c69c983abfc29e3e1aa8790f7dcd7e0288b705f600fcdaf7",
      "entry_point_selector":"0x333358710919613a34f18567332063b09711678bab1f50754e4f8f7fd637a8e",
      "calldata":["0x77616c6b6f75742d32303236"]},"latest"]}'

# What the contract believes it holds of STRK. Stranded value would show here.
curl -s -X POST https://api.cartridge.gg/x/starknet/mainnet \
  -H 'Content-Type: application/json' -d '{
    "jsonrpc":"2.0","id":1,"method":"starknet_call","params":[{
      "contract_address":"0x00dca84ff35ee793c69c983abfc29e3e1aa8790f7dcd7e0288b705f600fcdaf7",
      "entry_point_selector":"0x34a3e3c6d5d516a635cba760af371241a4847b82058493c7447a286655255dc",
      "calldata":["0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d"]},"latest"]}'
```
