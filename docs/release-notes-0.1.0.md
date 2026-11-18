## Installing Tally 0.1.0

Bundles: Windows x64 (`tally-0.1.0-x64-setup.exe`, installs per user, no
administrator rights), macOS Apple silicon (`tally-0.1.0-arm64.dmg`), Linux
x64 (`tally-0.1.0-amd64.deb` and `tally-0.1.0-x86_64.AppImage`). Each was
installed, launched and removed by the `installers` workflow on the release
commit; see VERIFICATION.md for the runs.

### Signing: none in 0.1.0

Tally 0.1.0 is not code-signed and not notarized (ADR 001). What that means
when you open it:

- **Windows**: SmartScreen shows "Windows protected your PC". Choose
  "More info", then "Run anyway". Removing the warning needs a code-signing
  certificate (an OV or EV certificate from a certificate authority, or Azure
  Trusted Signing, each with a yearly or monthly fee) and time for the
  publisher's reputation to build.
- **macOS**: the app is not signed with a Developer ID and not notarized, so
  Gatekeeper refuses to open it after a download ("cannot be opened because
  Apple cannot check it for malicious software", or "is damaged"). Copy it to
  Applications, then either open System Settings, Privacy & Security, and
  choose "Open Anyway", or run `xattr -cr /Applications/tally.app` in
  Terminal. Signing and notarization need a paid Apple Developer account
  (a yearly fee).
- **Linux**: packages are not signed. Compare the file with
  `SHA256SUMS-ubuntu-latest.txt` from the release (`sha256sum -c`).

### Where your data lives

One file, `ledger.json`, in Tally's folder in your user's application data
(`%APPDATA%\tally` on Windows, `~/Library/Application Support/tally` on
macOS, `~/.config/tally` on Linux). The status bar at the bottom of the
window shows the exact path. Back it up by copying that file while Tally is
closed.

### Known defects

- Bank CSVs saved as UTF-16 ("Unicode text" from Excel) are read as
  Windows-1252, so every row is listed as unreadable. Save the file as CSV
  (UTF-8) and import it again. Only UTF-8 and Windows-1252 are supported in
  0.1.0.
- If Tally cannot create its data folder (a full or read-only disk), it
  quits at start without a message.
- Undo lives in memory: closing Tally forgets what could be undone.
