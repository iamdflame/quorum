# Deployments

`ConclaveMachine` — the general private state machine, wired to the STRK20 privacy pool on each network. Same class hash on both, so the mainnet bytecode is the bytecode Sepolia rehearsed.

**Class hash (both networks)**
`0x057a995318f0e0fe1379753d55975b4e1d02dcc1e02028b61dd0c44425039a20`

## Starknet mainnet

| | |
|---|---|
| **ConclaveMachine** | [`0x0269fa8cd8a7a04f5cd5b2fda7139efebb99511e2dde4778ba9395948a62ecfc`](https://voyager.online/contract/0x0269fa8cd8a7a04f5cd5b2fda7139efebb99511e2dde4778ba9395948a62ecfc) |
| constructor `pool` | [`0x040337b1af3c663e86e333bab5a4b28da8d4652a15a69beee2b677776ffe812a`](https://voyager.online/contract/0x040337b1af3c663e86e333bab5a4b28da8d4652a15a69beee2b677776ffe812a) (the live STRK20 pool) |
| deploy tx | [`0x05cfd35a39512d132efea8767d5f69612b56af63480a4b9f426f97305fe35f0e`](https://voyager.online/tx/0x05cfd35a39512d132efea8767d5f69612b56af63480a4b9f426f97305fe35f0e) |
| declare tx | [`0x07e3f10af9bf11b6ff98f922848f5c019d468b2fb86d646f1273ae10aa0ca8f7`](https://voyager.online/tx/0x07e3f10af9bf11b6ff98f922848f5c019d468b2fb86d646f1273ae10aa0ca8f7) |
| deployer account | [`0x03cc11e53ab23e2e420dbf4149e0e5b185f6668eddb9d503eb6107e901aca566`](https://voyager.online/contract/0x03cc11e53ab23e2e420dbf4149e0e5b185f6668eddb9d503eb6107e901aca566) |
| account deploy tx | [`0x07b2aa81caa83de9aa2944900653f8b6ea5472c97c180f306310673b69e84782`](https://voyager.online/tx/0x07b2aa81caa83de9aa2944900653f8b6ea5472c97c180f306310673b69e84782) |

## Starknet Sepolia

| | |
|---|---|
| **ConclaveMachine** | [`0x0193e222869091a5b350d0a282c82f34c3554256a45b9ea631b66cdbd4d70309`](https://sepolia.voyager.online/contract/0x0193e222869091a5b350d0a282c82f34c3554256a45b9ea631b66cdbd4d70309) |
| constructor `pool` | `0x0254a6b2997ef52e9f830ce1f543f6b29768295e8d17e2267d672c552cfe0d91` |
| deploy tx | [`0x00e9fd2a21c689b5db4a3e6ad844ff4cca02a5c99b554a976e242bee2fcad6a3`](https://sepolia.voyager.online/tx/0x00e9fd2a21c689b5db4a3e6ad844ff4cca02a5c99b554a976e242bee2fcad6a3) |
| declare tx | [`0x002c39000aae92c7e53559fae3c3720a1995e45d9c9f310f844ec22b4ac4a586`](https://sepolia.voyager.online/tx/0x002c39000aae92c7e53559fae3c3720a1995e45d9c9f310f844ec22b4ac4a586) |
| deployer account | [`0x027d8aef1f11e2964d0d00e731fad3c28d37a1ee4f7cb229f90aa48ce1effa4a`](https://sepolia.voyager.online/contract/0x027d8aef1f11e2964d0d00e731fad3c28d37a1ee4f7cb229f90aa48ce1effa4a) |

## Verify it yourself

```bash
# Phase::Void for an id nobody opened - all nine fields zero,
# which is the `unknown_id_reads_as_void` test, run against mainnet.
curl -s -X POST https://api.cartridge.gg/x/starknet/mainnet \
  -H 'Content-Type: application/json' -d '{
    "jsonrpc":"2.0","id":1,"method":"starknet_call","params":[{
      "contract_address":"0x0269fa8cd8a7a04f5cd5b2fda7139efebb99511e2dde4778ba9395948a62ecfc",
      "entry_point_selector":"0x2129de82bc00286baf85fb893e658f7635712519b0fa81fbb9e3f0f6ef700b5",
      "calldata":["0x1"]},"latest"]}'
```

## Cost

Three mainnet transactions — account deployment, class declaration, contract deployment — cost **10.74 STRK, about $0.28**. The pool charges 6 STRK per privacy transaction on top of that, so the remaining balance covers roughly forty more.
