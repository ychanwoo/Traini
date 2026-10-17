# Pull request regression checks

The `CI` workflow runs for pull requests targeting `main`, pushes to `main`, and
manual dispatch. It uses GitHub-hosted Ubuntu 24.04 runners. No repository secrets,
personal environment files, Garmin login, Supabase service key, or ChatGPT session
are needed. The workflow runs checks only; it does not deploy, generate plans or
reviews, apply database migrations, or change branch protection.

## Checks

| Check | Commands and scope |
| --- | --- |
| Web checks | Node 22 from `.nvmrc`; `npm ci`, lint, generated Next route types, TypeScript, offline Node tests, production build |
| Collector checks (Python 3.12) | Minimum supported Python; locked dependencies, editable package with `--no-deps`, `pip check`, offline collector/FIT tests |
| Collector checks (Python 3.14) | The same checks on the locally used Python minor version |
| Browser checks | Locked npm dependencies, Chromium/Linux browser libraries, nine isolated weekly coaching scenarios |
| Required checks | Aggregates all three job groups; fails if any result is failed, cancelled, skipped or missing |

Python test fixtures exercise the real FIT encoder/decoder without personal FITs.
Browser tests run the synthetic loopback server on port 3027. Real database and
provider integration scripts remain explicit local checks; see
[service reliability](service-reliability.md) and
[browser test boundaries](weekly-coaching-e2e.md).

The credential-free production build checks compilation and page generation.
Configure the real application environment separately before building a release.
CI does not publish its unconfigured build as a deployable artifact.

## Permissions, cancellation and failure evidence

- The token has `contents: read` permission. Checkout does not persist credentials.
- Actions are pinned to verified full commit SHAs, with release versions in comments.
  Update each SHA deliberately when adopting a new official release.
- The workflow uses `pull_request`, including for fork PRs. It does not use
  `pull_request_target` to execute contributor code with elevated credentials.
- New commits cancel superseded runs for the same PR/ref. Jobs have bounded
  timeouts; both Python versions run even if one fails.
- npm and pip download caches use their lock files. Browser installation follows
  the Playwright version in `package-lock.json`.
- Focused `test.only` cases fail CI. Browser tests use one worker and zero retries.
- Browser failures retain an HTML report, failed-test screenshots and traces when
  available. Only `playwright-report/` and `test-results/` are uploaded, for seven
  days. Missing reports do not replace an earlier installation/test failure.
  Cancelling a run skips artifact upload.
- Artifacts contain synthetic test data. Do not broaden the upload paths to include
  environment files, local authentication directories, source FITs or production
  build output. View traces locally with `npx playwright show-trace <trace.zip>`.

GitHub runner provisioning, downloads, report uploads and PR status publication
can only be confirmed by a real workflow run after this change is pushed.

## Make the result required before merging

1. Push this branch and open a PR targeting `main`.
2. Open its Checks tab and confirm `Web checks`, both `Collector checks`,
   `Browser checks`, and `Required checks` run successfully.
3. In the existing main ruleset, enable **Require status checks to pass** and
   select the check named **Required checks** from workflow **CI** after GitHub
   has observed its first run. Keep PR requirements and active enforcement.
4. Confirm that a failed upstream check leaves the aggregate red and blocks merge.

Use the aggregate's exact name instead of a Python-version-specific matrix name.
If merge queues are enabled later, add the `merge_group` trigger before making
this workflow a queue requirement. Branch protection is an account setting and
is not modified by committing this workflow.

## Reproduce locally

Use `nvm install` and `nvm use` if nvm is installed, or another Node 22 runtime.
From the repository root:

```sh
npm ci
npm run lint
npm run typecheck
npm test
npm run build
npx --no-install playwright install chromium
CI=true npm run test:e2e
```

On Linux, install Chromium with `npx --no-install playwright install --with-deps
chromium` so its OS libraries are also present. Keep port 3027 free; Playwright
owns the fixture server lifecycle and intentionally refuses to reuse another
server.

For each supported Python version, create a separate virtual environment:

```sh
python3.12 -m venv collector/.venv
collector/.venv/bin/python -m pip install -r collector/requirements.lock
collector/.venv/bin/python -m pip install --no-deps -e ./collector
collector/.venv/bin/python -m pip check
collector/.venv/bin/python -m unittest discover -s collector/tests -v
```

Use Python 3.14 and a different environment path for the second matrix entry.
The existing `.gitignore` excludes `.venv/`; keep temporary verification
workspaces outside the repository. To reproduce credential-free build behavior,
use a separate checkout without `.env.local`, not the configured personal server
checkout. Do not remove or rename the user's private environment file to test CI.

## Historical verification record

The record below describes the original CI change. The current suite has nine
scenarios, including weekly closeout. Counts below are not a current run result.

On 2026-10-17, a fresh temporary source copy with no `.env.local`, `node_modules`
or `.next` passed `npm ci`, lint, generated route types/TypeScript, 288 Node tests
and the production build. Separate freshly installed Python 3.12 and 3.14 virtual
environments each passed `pip check` and all 103 collector tests.

All eight shared browser scenarios passed against that clean copy through the
Codex browser driver, including 320/375/430/768px bounds. The Playwright CLI
listed the same eight scenarios. A temporary focused test was rejected by CI's
`forbidOnly` setting. A separate, intentionally failing synthetic test that did
not request a browser verified the CLI's fixture-server lifecycle, failed exit
status and HTML/results/trace output. These probes were removed afterwards.
Linux x86-64 binary-wheel resolution also succeeded for both Python versions
using the locked requirements; those wheels were downloaded, not executed.

Actionlint passed the workflow. Fifteen aggregate-result combinations verified
success, failure, cancellation, skipping and missing-result handling. These
local checks ran on macOS; they are not a claim that GitHub's Linux workflow or
the complete eight-case Playwright CLI run has already passed. The first PR run
is still required to verify that environment and the artifact upload itself.

## References

- [GitHub workflow syntax](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax)
- [Official checkout action](https://github.com/actions/checkout)
- [Official Node setup](https://github.com/actions/setup-node)
- [Official Python setup](https://github.com/actions/setup-python)
- [Official artifact upload](https://github.com/actions/upload-artifact)
- [Playwright CI installation](https://playwright.dev/docs/ci)
