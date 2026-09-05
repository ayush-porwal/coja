/**
 * Where fetched pull requests live inside a project's repository.
 *
 * Refs are namespaced under `refs/coja/` (decisions.md): the objects stay
 * reachable (no gc), while the user's branches, remote-tracking refs and
 * FETCH_HEAD are never written.
 */

export const prHeadRef = (number: number): string => `refs/coja/pull/${assertPrNumber(number)}/head`

export const prBaseRef = (number: number): string => `refs/coja/pull/${assertPrNumber(number)}/base`

/** GitHub's read-only ref for a pull request's head commit (works for fork PRs). */
export const githubPullHeadRef = (number: number): string =>
  `refs/pull/${assertPrNumber(number)}/head`

function assertPrNumber(number: number): number {
  if (!Number.isSafeInteger(number) || number <= 0) {
    throw new RangeError(`invalid pull request number: ${String(number)}`)
  }
  return number
}
