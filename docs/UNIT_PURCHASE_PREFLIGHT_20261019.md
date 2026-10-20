# Unit purchase preparation and wallet rejection handling

Base: 5a93fc168ce21086a21d11d3f853a3713e05d267.

Membership and collateral approvals now populate calldata and estimate gas before creating an uncertain-send record. The estimated gas limit includes a 20% margin. Changes of wallet during preparation stop the operation. Nested explicit wallet rejection codes release the record; transport errors during sending remain uncertain. Unknown-send guidance distinguishes a transaction hash from an address and does not claim payment.

Validation: 13 transaction-state and membership-availability tests pass; production web build passes. Contract sources, economic rules and mainnet state are unchanged. No transaction was sent. No production browser purchase or server installation was performed.

Existing unknown-send records are deliberately preserved. A zero latest/pending nonce from one RPC and an unchanged balance cannot prove that a signed transaction cannot appear later. Resolve using a matching wallet transaction and receipt; do not clear storage or retry a payment to bypass the guard. This release prevents preparation failures from creating new locks but does not automatically resolve the reported old record.
