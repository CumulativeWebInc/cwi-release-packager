# Release Asset Packager (#53)

Distributor deliverable bundle builder — shipped 2026-09-25 as the **Thursday recovery build** of the CWI App Factory (the 2026-09-24 10:00 scheduled run never fired; this build recovers it).

## What it does
Pick any of the 52 catalog tracks, set a release date, declare the UPC, attest the cover-art spec — the engine runs the identifier + metadata gate and **fails closed (red gate)** on missing or conflicted ISRCs. A release can never ship past it without its identifier. Output: verdict panel + downloadable `release-bundle.json` (schema `cwi.release-bundle/1.0`).

## Why it matters
The 2026-09-19 ISRC audit found 2 conflicted ISRCs (Golden Diamond, Shaka Zulu) and 4 tracks missing ISRCs entirely (piv-ot-al, Sync Ready Tracks, On Edge, Pay Yourself) — all baked into the data file, all fail the gate by design. Distributor freezes hit at T-6wk; the app checks the window and feeds the Release Timeline Automator.

## Truth labels
- **VERIFIED** — checked against the 2026-09-19 catalog-index snapshot
- **USER-ATTESTED** — cover art (self-declared; the tool never inspects the file)
- **UNVERIFIED** — UPC, freeze-window arithmetic, everything else

## Build receipts
- Tests: **18/18** `node --test test.js` green
- Engine: zero-dep UMD (`release-packager.js`), browser + Node
- CLI: `node cli/build.js <track-id> [--release-date YYYY-MM-DD] [--cover-attested] [--upc CODE]`
- Repo: https://github.com/CumulativeWebInc/cwi-release-packager
- Live: https://cumulativewebinc.github.io/cwi-release-packager/
- CI: `.github/workflows/test.yml` runs the suite on push
