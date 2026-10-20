# Live browser follow-up

Observed the production browser serving `/fti-mainnet-ui-acb33234c3a38fde/app.js` on ftiprotocol.com. Arabic landing and membership workspace rendered; contract data loaded, showing 31 registered positions and matching accounting. Chinese, Turkish, English and Arabic selections changed html language/direction without horizontal overflow at the cloud browser's desktop viewport. Navigation to token.ftiprotocol.com/token/ preserved the Arabic language query; live token data rendered. No wallet was connected and no transaction was submitted.

The read-only API snapshot showed epoch 4, phase 0, monthPhase 0, rewardQueue 0. This snapshot does not establish that the next settlement succeeds. Token supply and reserves were zero; the token page correctly stated that no price is available while supply is zero.

Found and fixed: mainnet-only NetworkText properties and several sidebar/network/trading labels still fell back to English after configuration loaded. Added Arabic, Turkish and Simplified Chinese translations. Coverage now extracts every `main` NetworkText property (except numeric/ticker-only values), and three browser cases wait for controller initialization with ABI fixtures before opening membership. Production web build, five translation/policy tests and three targeted browser tests passed.

The browser checks were desktop checks. Physical iPhone Safari, connected-wallet registration/addUnits, actual payouts, automatic gas notifications and legacy runtime dependency inventory remain outside this verified result. This translation follow-up still needs installation on the server. Contracts and economic rules are unchanged.
