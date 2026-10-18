# QA checklist and current boundary

Run `npm test`. The automated project preflight validates JavaScript syntax, required source files, exact Moonbound edition/image/metadata counts, per-file JSON validity, WebP signatures, duplicate-image hashes, fee invariants, required contract interface names, IPFS URI placeholder consistency, and checks that obsolete third-party marketplace code is absent.

## Manual release gate (must pass before mainnet funds)

1. Compile registry and collection with the current official Gno compiler; fix every diagnostic.
2. Deploy and run on Onyx using a dedicated test wallet and a controlled fee-sink address.
3. Test collection registration, rejection of incorrect fee deposits, and automatic featured collection selection.
4. Mint at least 3 different Moonbound IDs; prove a mint cannot happen after 1,111 and IDs cannot be duplicated.
5. List an NFT, buy as a second wallet, inspect seller/creator/treasury balances and confirm the treasury gets exactly 2.5% of ask in ugnot rounding; try exact ask without fee and verify rejection.
6. Cancel a listing and verify escrow/ownership return; test malicious amounts, zero/negative input, overflow boundaries, invalid IPFS bases, repeat initialization, unauthorized admin actions, and reentrancy-like call paths where relevant to Gno execution.
7. Verify server/registry fee-sink mismatch blocks purchases and collection launch.
8. Confirm newly registered collection becomes the homepage feature on refresh and does not require hard-coded front-end deployment.
9. Review published code and metadata on the explorer and IPFS gateways; ensure no secret is sent to the browser.
10. Only after the above, enable mainnet writes. Mainnet launch requires 2,000 GNOT plus gas; each primary Moonbound mint is 575 GNOT plus gas.

## Not tested here

No on-chain compile/deploy or funded wallet signing was available in the local build environment. No claim is made that the Gno contracts are deployed or externally audited. Automated static checks cannot establish security of contracts.
