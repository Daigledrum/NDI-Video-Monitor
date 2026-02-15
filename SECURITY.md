# Security Checks and Disclosure

## Security Baseline

For local release preparation, run:

```bash
npm run preflight
npm run security:check
```

What these cover:
- SDK/toolchain readiness across platform
- Native source/binary prerequisites
- Dependency audit for high-severity vulnerabilities
- Basic repository hygiene (`.gitignore` checks)

## Safe Configuration Practices

- Do not commit secrets, tokens, or private URLs.
- Keep `.env` and machine-local config out of git.
- Prefer least-privilege firewall rules for deployment networks.
- Keep NDI SDK and Node.js updated.

## Runtime Hardening Notes

- API source names are normalized and validated server-side.
- Source discovery JSON is escaped to avoid malformed payload issues.
- Native helper compilation is scoped to known binaries (`ndi_recv`, `ndi_list`).

## Dependency Security Status

- Current lockfile status: `npm run security:check` reports `0 vulnerabilities`.
- The project uses an npm `overrides` rule to pin `@mapbox/node-pre-gyp` to a patched branch and avoid vulnerable `tar` versions.

Recommended ongoing practice:
- Keep lockfile committed and review dependency changes before release.
- Re-run `npm run security:check` before each release.
- Validate WebRTC startup after dependency updates (`@koush/wrtc` load + offer/answer flow).

## Reporting Vulnerabilities

If you discover a security issue, avoid public disclosure first.
Share details privately with maintainers and include:
- Impact summary
- Reproduction steps
- Affected versions/platforms
- Suggested fix (if available)
