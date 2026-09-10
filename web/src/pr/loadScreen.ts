/** Share intent preloading with React.lazy; failed preloads remain retryable. */
let pending: Promise<typeof import('./PullRequestScreen')> | undefined

export function loadPullRequestScreen() {
  pending ??= import('./PullRequestScreen').catch((error: unknown) => {
    pending = undefined
    throw error
  })
  return pending.then((module) => ({ default: module.PullRequestScreen }))
}

export function preloadPullRequestScreen() {
  void loadPullRequestScreen().catch(() => {
    // Navigation owns the error; hovering a link must not raise one.
  })
}
