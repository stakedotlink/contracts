# Vendored Seaport artifacts

Pre-compiled `Seaport.json` and `ConduitController.json` (ABI + bytecode) for
local-only deployment of the reSDL marketplace stack. Production code reads
canonical addresses from `marketplace-backend/src/config/blockchain.ts`; these
artifacts are only loaded by `scripts/test/deploy/modules/deploy-marketplace.ts`.

## Version pin

- Seaport: `1.6` (tag https://github.com/ProjectOpenSea/seaport/releases/tag/1.6)
- ConduitController: same tag (it ships in the same repo)

## Re-fetching

```
./fetch-artifacts.sh
```

Requires: `git`, `jq`, and `forge` (install foundry via https://book.getfoundry.sh/getting-started/installation).
The Seaport repo builds with forge by default; we don't need its TS toolchain.

## Notes

- Bytecode is taken raw from `out/<Contract>.sol/<Contract>.json` after `forge build`.
- The Seaport address you get on local deployment will NOT match the canonical
  `0x00000000000000ADc04C56Bf30aC9d3c0aAF14dC` — that requires CREATE2 with the
  pre-funded deterministic deployer. We don't bother; the marketplace-backend
  reads the deployed address from env at runtime.
