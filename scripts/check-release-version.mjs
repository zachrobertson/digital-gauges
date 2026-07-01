/**
 * Validates release PR version bumps for CI.
 *
 * A release PR is identified when any one of these is true:
 *   - head branch matches release/*
 *   - PR has the "release" label
 *   - PR title contains [release]
 *
 * Run: node scripts/check-release-version.mjs
 *
 * Environment:
 *   PR_HEAD_BRANCH — PR head branch name
 *   PR_TITLE       — PR title
 *   PR_LABELS      — comma-separated label names
 *   BASE_REF       — base branch ref (default: main)
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

function fail(message) {
  console.error(`::error::${message}`);
  process.exit(1);
}

function parseVersion(version) {
  const match =
    /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+([0-9A-Za-z.-]+))?$/.exec(version);
  if (!match) {
    fail(`Invalid semver "${version}" in package.json`);
  }
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4] ?? null,
  };
}

function compareVersion(a, b) {
  const left = parseVersion(a);
  const right = parseVersion(b);
  if (left.major !== right.major) return left.major - right.major;
  if (left.minor !== right.minor) return left.minor - right.minor;
  if (left.patch !== right.patch) return left.patch - right.patch;
  if (left.prerelease === null && right.prerelease === null) return 0;
  if (left.prerelease === null) return 1;
  if (right.prerelease === null) return -1;
  if (left.prerelease < right.prerelease) return -1;
  if (left.prerelease > right.prerelease) return 1;
  return 0;
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function readVersionFromRef(ref) {
  const json = execFileSync('git', ['show', `${ref}:package.json`], { encoding: 'utf8' });
  return JSON.parse(json).version;
}

function isReleasePr({ headBranch, title, labels }) {
  if (headBranch.startsWith('release/')) return 'branch name release/*';
  if (labels.includes('release')) return 'label release';
  if (title.includes('[release]')) return 'title [release]';
  return null;
}

const headBranch = process.env.PR_HEAD_BRANCH ?? '';
const title = process.env.PR_TITLE ?? '';
const labels = (process.env.PR_LABELS ?? '')
  .split(',')
  .map((label) => label.trim())
  .filter(Boolean);
const baseRef = process.env.BASE_REF ?? 'main';

const releaseReason = isReleasePr({ headBranch, title, labels });
if (!releaseReason) {
  console.log('Not a release PR — skipping version bump check.');
  process.exit(0);
}

console.log(`Release PR detected (${releaseReason}). Checking version bump against ${baseRef}.`);

const headVersion = readJson('package.json').version;
let baseVersion;
try {
  baseVersion = readVersionFromRef(`origin/${baseRef}`);
} catch {
  fail(
    `Could not read package.json from origin/${baseRef}. Ensure the workflow fetches the base branch.`,
  );
}

if (compareVersion(headVersion, baseVersion) <= 0) {
  fail(
    `Release PR must bump package.json version above ${baseRef} (${baseVersion}). ` +
      `Current version is ${headVersion}.`,
  );
}

const lockfile = readJson('package-lock.json');
const lockRootVersion = lockfile.version;
const lockPackageVersion = lockfile.packages?.['']?.version;

if (lockRootVersion !== headVersion) {
  fail(
    `package-lock.json version (${lockRootVersion}) must match package.json (${headVersion}). ` +
      'Run npm install after bumping the version.',
  );
}

if (lockPackageVersion !== undefined && lockPackageVersion !== headVersion) {
  fail(
    `package-lock.json packages[""].version (${lockPackageVersion}) must match package.json (${headVersion}). ` +
      'Run npm install after bumping the version.',
  );
}

console.log(`Version bump OK: ${baseVersion} → ${headVersion}`);
