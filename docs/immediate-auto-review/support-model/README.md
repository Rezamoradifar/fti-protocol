# Numeric support-policy cross-check, not contract implementation

The included Python integer model was read and reproduced for this review checkpoint. It recorded 551,339 sampled accepted-normal operation checks: 131,339 buys, 200,000 sells, 200,000 transfers, 10,000 tiny buys and10,000 tiny transfers. 20,000 unchanged display-getter observations are a subset, not extra operations. All normal cases required zero support top-up under the current fee-retained-in-live-reserve allocation. A separate 10,000-case hypothetical helper check is arithmetic only; no such helper is implemented in the reviewed Solidity. None of these model iterations are counted among the 173 selected test cases.

The distinction is economic: with mint floor(netAssets*S/R) and positive retained fees, ordinary accepted positive-supply buy/sell/transfer operations already increase exact R/S. This does not implement active H insurance or loss repair. A true USD collateral shortfall is not cured by relabeling H as R because total accounted R+H remains unchanged. The current backing check rejects the deficit.

The finite deterministic sample is not an exhaustive proof of all contract states, overflow/gas/liveness properties or profitability. Zero-output, terminal and emergency cases have their separately documented conditions.

Reproduce: python3 docs/immediate-auto-review/support-model/strict-support-audit.py
