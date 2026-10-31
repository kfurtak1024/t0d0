/**
 * Runs the end-to-end tests inside Playwright's own image — the browsers CI
 * runs, with every system library they need, on any machine with Docker.
 *
 * `npm run test:e2e:docker` takes the same arguments as `npm run test:e2e`:
 * `npm run test:e2e:docker -- --project=desktop-webkit` runs one engine.
 *
 * Without it, WebKit and Firefox only ran in CI: on a Linux machine missing
 * their system libraries they cannot launch at all, so every WebKit-only race
 * was found one CI run at a time. The image is pinned to the installed
 * Playwright, so its browsers are the ones the tests were written against.
 *
 * `node_modules` lives in a named volume rather than the mounted checkout: the
 * container installs its own Linux build without touching the host's, and keeps
 * it between runs. The container runs as root, so everything it writes into the
 * checkout is handed back to the caller on the way out.
 */
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const { version } = createRequire(import.meta.url)("@playwright/test/package.json");
const IMAGE = `mcr.microsoft.com/playwright:v${version}-noble`;
const owner = `${process.getuid()}:${process.getgid()}`;

// `|| true` because not every run writes all three — `--reporter=line` writes no
// playwright-report — and a failed chown in the trap would become the exit
// code, turning a passing run red. A failing run keeps its own code either way.
const script = [
  `trap 'chown -R ${owner} dist test-results playwright-report 2>/dev/null || true' EXIT`,
  "npm ci --no-audit --no-fund --loglevel=error",
  'npx playwright test "$@"',
].join("\n");

const { status } = spawnSync(
  "docker",
  [
    "run",
    "--rm",
    "--init",
    // Chromium shares memory between processes, and Docker's default is too small.
    "--ipc=host",
    "--volume",
    `${ROOT}:/work`,
    "--volume",
    "t0d0-e2e-node-modules:/work/node_modules",
    "--workdir",
    "/work",
    IMAGE,
    "bash",
    "-c",
    `set -e\n${script}`,
    "e2e-docker",
    ...process.argv.slice(2),
  ],
  { stdio: "inherit" },
);
process.exit(status ?? 1);
