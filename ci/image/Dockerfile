# CI image for the browser E2E jobs (ci.yml, e2e-electron.yml), published as ghcr.io/dhx/opencove-ci by
# .github/workflows/ci-image.yml. Microsoft's Playwright image carries the browsers and their libraries;
# this adds what the official image leaves out and our jobs need, so no test run goes through apt:
# - python3, make, g++: node-pty has no Linux prebuilds and compiles with node-gyp during `pnpm install`.
# - GTK 3 and the X helpers Electron loads: the image has GTK 4 (for WebKit), Electron links GTK 3.
# The Playwright version in the tag must match @playwright/test in pnpm-lock.yaml (ci-image.spec.ts).
FROM mcr.microsoft.com/playwright:v1.58.2-noble@sha256:6446946a1d9fd62d9ae501312a2d76a43ee688542b21622056a372959b65d63d

RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      python3 make g++ \
      libgtk-3-0t64 libxss1 libxtst6 xauth \
 && rm -rf /var/lib/apt/lists/*
