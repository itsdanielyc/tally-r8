# Verification ledger

Append-only. Each row says what was proven, where, and by which run. "Built"
is never rounded up to "tested"; anything not listed here is unverified.
Runs are in https://github.com/itsdanielyc/tally-r8/actions/runs/<id>.

| Date | Level | Claim | Platforms | Evidence |
|---|---|---|---|---|
| 2026-11-18 | scaffold: L0, L1, L2 | `electron-web` scaffold: lint (tsc for renderer, electron and tests; ESLint with the size limits; knip), unit and mock-vs-contract conformance green | ubuntu-latest | ci run [44365019289](https://github.com/itsdanielyc/tally-r8/actions/runs/44365019289) (PR #3), job unit |
| 2026-11-18 | scaffold: L4/L5 | Home screen against the labelled mock: behaviour, ARIA tier, geometry tier and per-OS pixel tier green | ubuntu-latest, windows-latest, macos-latest | ci run [44365019289](https://github.com/itsdanielyc/tally-r8/actions/runs/44365019289), 3 of 3 ui jobs; pixel baselines from snapshots run [44354958235](https://github.com/itsdanielyc/tally-r8/actions/runs/44354958235) (macOS capture re-run once after it was cancelled in the runner queue), all three images looked at |
| 2026-11-18 | scaffold: L6 | Built app launches with the native backend, renderer sandboxed (no `require`, no `process`), greeting round trip over IPC matches `contracts/greet.ts`, platform reported by the main process, no console errors | ubuntu-latest, windows-latest, macos-latest | ci run [44365019289](https://github.com/itsdanielyc/tally-r8/actions/runs/44365019289), 3 of 3 e2e jobs (also green in run [44349153325](https://github.com/itsdanielyc/tally-r8/actions/runs/44349153325)); artifact `contact-sheet` |
| 2026-11-18 | scaffold: L7 | NSIS silent install, launch, uninstall; dmg mount, copy, launch, remove; deb install, launch, remove and AppImage launch | windows-latest, macos-latest, ubuntu-latest | installers run [44354900013](https://github.com/itsdanielyc/tally-r8/actions/runs/44354900013) on main (8a0e147), 3 of 3 green |
| 2026-11-18 | note | First ci runs red by design until the pixel baselines existed (run 44349153325 and main run 44354899998: tier 3 "A snapshot doesn't exist"); the windows ui job of 44349153325 failed earlier, in `npm ci` with a registry `ECONNRESET` | - | triage digests of those runs |
| 2026-11-18 | note | Local proof of the scaffold on windows-x64, 16:34 to 16:35 UTC: lint, unit and e2e green. The local ui result is withdrawn: the suite then reused any server on port 1420, and another process on this machine was serving a different app there (found in slice 1) | windows-x64 local | not counted; CI rows above are the evidence |

## Unverified

- Slices 1 to 6: not yet run in CI.
- Nothing is signed or notarized (ADR 001).
- No Tier 2 or Tier 3 platforms exist (ADR 002), so none are tested.
