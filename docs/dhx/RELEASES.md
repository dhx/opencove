# Our OpenCove releases

This fork builds its own OpenCove **server** releases (`opencove-server-linux-x64.tar.gz`, worker + Web UI)
for [opencove-image](https://github.com/dhx/opencove-image). They are upstream's code plus our changes
(the list below), built by `.github/workflows/dhx-release.yml`.

## Cutting a release

**Automatically:** every push to `main` starts `dhx-release.yml` right away, in parallel with upstream's
`CI` workflow. It works out the next version (the next patch of `package.json`'s version with `-dhx-<nnn>`
counted up: `0.4.1-dhx-001`, `0.4.1-dhx-002`, …; when upstream moves to 0.4.1, `0.4.2-dhx-001`), then builds,
runs our checks and attests the bundle. It skips lint, types and unit tests, because CI runs those for the
same commit. When CI finishes green, `dhx-auto-release.yml` publishes that very build. A release is ready about
a minute after CI. Commits that `main` has already moved past (their CI is cancelled anyway) and commits that
already have a release are skipped.

**By hand:**

```sh
git tag dhx/v0.4.1-dhx-001 && git push origin dhx/v0.4.1-dhx-001
```

- **Version.** `<next upstream patch>-dhx-<nnn>`, e.g. `0.4.1-dhx-001` for upstream main after 0.4.0. The
  three digits sort correctly as text, and the next patch number makes it newer than the upstream release it
  builds on. Semver counts it as a pre-release, so a plugin that names a version range has to allow
  pre-releases.
- **Tags.** Ours start with `dhx/` (upstream's tags are `v*`).
- **What the workflow does:**
  1. Stamps the version and builds the server bundle (`pnpm build:standalone`).
  2. Runs the checks below.
  3. Publishes a GitHub release with the tarball, `SHA256SUMS.txt`, an SPDX SBOM and a build provenance
     attestation.
- **Trial build.** Every pull request, and a manual run (*Actions → dhx release → Run workflow*), builds
  and checks without publishing. The bundle is a workflow artifact.
- **Verify a download:**

  ```sh
  sha256sum -c SHA256SUMS.txt
  gh attestation verify opencove-server-linux-x64.tar.gz --repo dhx/opencove
  ```

## What a release checks

- **Inputs are pinned:**
  - The bundled Node runtime is the official tarball, checked against its SHA-256 (`NODE_VERSION`,
    `NODE_SHA256`). Upstream bundles whatever Node the runner happens to have.
  - Build images are pinned by digest, actions by commit, packages by `pnpm-lock.yaml`.
- **Upstream's cheap gates:** `secrets:scan`, `lint`, `format:check`, `check`, unit tests. The E2E suites
  run in upstream's CI on pull requests.
- **`scripts/dhx/check-release-bundle.mjs`:** none of the markers in its `FORBIDDEN` list appear in the
  bundled code. That covers telemetry, analytics and crash-reporting SDKs and hosts, plus everything our
  changes removed. When a change removes something, add it there, so it can't come back unnoticed in an
  upstream merge.
- **`scripts/dhx/egress-smoke.sh`:**
  - The worker runs in a container without a network, with `scripts/dhx/egress-guard.cjs` loaded into
    every Node process.
  - It is used the way a person uses it, then left idle.
  - Any attempt to connect or resolve anything but loopback fails the release.
- **Upstream's container smoke test** of the bundle.

## Staying with upstream

```sh
git remote add upstream https://github.com/DeadWaveWave/opencove   # once
git fetch upstream && git merge upstream/main                      # on a branch, as a pull request
```

The release checks run on the merge's next release. This fork deletes upstream's `release.yml` and
`nightly.yml` (desktop releases for macOS, Windows and Linux) and runs CI on Linux only. When upstream changes
those workflows or the macOS/Windows jobs in `ci.yml`, the merge reports a conflict; keep our side. A conflict in one of our changes shows up in the
merge, and a returning phone-home shows up in the checks.

## Our changes

| Change | Why |
|---|---|
| Release workflow and checks (`.github/workflows/dhx-release.yml`, `dhx-auto-release.yml`, `scripts/dhx/`) | Our own verified builds, released automatically when main is green (#1) |
| CI on Linux only: no `ci-macos` or `platform-e2e-windows` jobs; upstream's desktop `release.yml` and `nightly.yml` removed | We ship only the Linux server build; the macOS shards set the release time (#7) |
| Files dropped or pasted onto a terminal in the Web UI go to the worker (`/files/drop`), and their path is pasted | The Web UI had no way to pass a file to an agent (#2) |
| No auto-update, no GitHub plugin catalog unless `OPENCOVE_PLUGIN_CATALOG=1`, no default upstream downloads for managed SSH, no Gemini schema fetch, spellcheck off, issue reports to this fork; plugin views in an opaque origin, website nodes refuse the UI's own origin | Nothing contacts third parties on its own; plugin and website content cannot act as the UI (#3) |
| Token and password from env or file (not argv, not printed), no `?token=` unless enabled, Origin check for bearer requests, JSON and size limit on `/invoke`, `/debug/shell` off, security headers, Secure cookie behind TLS, no open bind without a password, database files 0600 | The worker's credentials stay out of process lists and logs; a token-injecting proxy is safe (#4) |
| Agents without permission bypass unless `OPENCOVE_AGENT_FULL_ACCESS` allows it; no executable/env overrides from the API; `approveRoot` refuses `/`, home and secret folders; SSH host/user validated; terminal shims send only what they need (`OPENCOVE_TERMINAL_AGENT_SHIMS=0` turns them off); no startup rewrite of `~/.claude`/`~/.codex`; private OpenCode config | Agents and API callers cannot escalate on their own (#5) |
