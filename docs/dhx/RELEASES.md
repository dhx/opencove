# Our OpenCove releases

This fork builds its own OpenCove **server** releases (`opencove-server-linux-x64.tar.gz`, worker + Web UI)
for [opencove-image](https://github.com/dhx/opencove-image). They are upstream's code plus our changes
(the list below), built by `.github/workflows/dhx-release.yml`.

## Cutting a release

```sh
git tag dhx/v0.4.1-dhx-001 && git push origin dhx/v0.4.1-dhx-001
```

- **Version.** `<next upstream patch>-dhx-<nnn>`, e.g. `0.4.1-dhx-001` for upstream main after 0.4.0. The
  three digits sort correctly as text, and the next patch number makes it newer than the upstream release it
  builds on. Semver counts it as a pre-release, so a plugin that names a version range has to allow
  pre-releases.
- **Tags.** Upstream's `release.yml` reacts to `v*` tags, so ours start with `dhx/` and never trigger it.
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

The release checks run on the merge's next release. A conflict in one of our changes shows up in the
merge, and a returning phone-home shows up in the checks.

## Our changes

| Change | Why |
|---|---|
| Release workflow and checks (`.github/workflows/dhx-release.yml`, `scripts/dhx/`) | Our own verified builds |
