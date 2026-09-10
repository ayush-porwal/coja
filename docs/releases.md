# Releasing the CLI

Merging a PR does not publish anything. Use **Actions → Publish → Run workflow**
from `main` when a batch of changes is ready.

1. Enter a source commit SHA (recommended) or ref from `main` history. This can be
   an older commit; newer merges are not included. The selected snapshot must
   support `pnpm check`, `pnpm build`, and the bundled agent package layout.
2. Enter an explicit, unused stable version such as `0.0.3`. It must be newer than
   npm's `latest`. Prerelease versions and alternate distribution tags are not
   supported by this workflow.
3. Leave **dry_run** checked for a rehearsal. The workflow validates, builds,
   packs, and installs the actual tarball in an isolated consumer. It saves the
   tarball and release metadata as an Actions artifact and prints the resolved
   source SHA, release commit, and integrity in the run summary.
4. Run again with the same source SHA/version and **dry_run** unchecked. Approve
   the existing `release` environment when prompted. The workflow publishes to
   npm, verifies the published integrity, then creates the Git tag and GitHub
   release automatically. No version bump PR is needed.

The workflow must be dispatched from `main`; choose the code to release with the
**source** input rather than the workflow branch selector. Both dry runs and real
releases currently use the existing `release` environment approval.

## Version and artifact identity

A release uses a deterministic commit whose parent is the chosen source commit.
Only `server/package.json` changes to the requested version. The release tag uses
that version (`0.0.3`, matching the existing `0.0.2` convention) and points to the
versioned commit. `main` is never moved or given an automatic version bump.

The smoke-tested tarball is the one passed to npm. Registry errors stop the run;
they are never interpreted as an unused version. Existing versions with different
integrity or tags pointing elsewhere are rejected. Runs are serialized.

## Authentication

The workflow keeps the `publish.yml` filename and `release` environment for the
existing npm trusted publisher, and uses GitHub OIDC with npm provenance. It uses
`npm publish` directly instead of `npm stage publish`: GitHub environment approval
is the release approval. If npm's trusted-publisher configuration is restricted to
staging, a package maintainer must allow direct publishing there before the first
real release. No npm access token is needed and this PR does not change npm settings.

GitHub Actions needs permission to write repository contents for tags/releases.
The workflow does not merge PRs, move existing tags, or push commits to `main`.

## Recovery

Re-run using the **original source SHA and version**, not a potentially moved
`main` ref. The release commit is reproducible. If npm already has the exact
rebuilt tarball, publication is skipped and missing tag/release creation resumes.
A different tarball fails instead of overwriting or pretending success: choose a
new version after investigating. Non-reproducible dependency builds may require
manual recovery from the saved artifact; the integrity check deliberately blocks
automatic recovery with different bytes.

If npm publishing fails (including a staging-only publisher), no tag or GitHub
release is created. If publishing succeeds but GitHub operations fail, npm remains
published; retry as above. If a run is canceled, check npm and the run summary before
choosing another version. A dry run creates no remote tags, releases, or packages.

The final check waits up to about a minute for npm visibility. If it times out,
retry with the original SHA/version after registry propagation completes.
