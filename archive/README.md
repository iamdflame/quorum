# Archive

These packages belong to **Shoal**, an earlier project in this repository that measured and routed anonymity in the STRK20 pool. Quorum replaced it.

They are kept rather than deleted because the work is real and some of it is still cited:

| | |
|---|---|
| `oracle` | effective anonymity set of the live pool, as perplexity over the flow distribution |
| `router` | choosing a path into the largest available crowd |
| `execute` | proving windows and the per-transaction fee cost of splitting |
| `sdk-bridge` | reaching the SDK's unexported `ContractDiscoveryProvider` past its own `exports` map |

`packages/linkage` was **not** archived. It measures what the live pool actually gives away, and Quorum's honesty about what a campaign leaks depends on it.

Nothing here is on Quorum's path. If you are reviewing the submission, read [`contracts/src/quorum.cairo`](../contracts/src/quorum.cairo) and [`packages/protocol`](../packages/protocol).
