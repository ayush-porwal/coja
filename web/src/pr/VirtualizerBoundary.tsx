import { Component, type ReactNode } from 'react'

interface VirtualizerBoundaryProps {
  /**
   * Called when the wrapped tree throws. The parent should remount the tree —
   * bump the `epoch` it passes in — so the boundary (and the tree) start fresh.
   */
  onRecover(): void
  /** Bump whenever `onRecover` ran, so the boundary resets its error state. */
  epoch: number
  /** Rendered instead of children while the parent re-mounts the tree. */
  fallback: ReactNode
  children: ReactNode
}

/**
 * Recovery boundary for the diff virtualizer. `@pierre/diffs` can throw
 * "rendered a different file than its prepared layout" when items change while
 * an async render is in flight; without a boundary React unmounts the whole
 * app. The parent remounts the CodeView with the current items, which renders
 * cleanly — so a virtualizer race costs one frame, not the screen.
 */
export class VirtualizerBoundary extends Component<
  VirtualizerBoundaryProps,
  { hasError: boolean }
> {
  state = { hasError: false }

  static getDerivedStateFromError() {
    return { hasError: true }
  }

  componentDidCatch() {
    this.props.onRecover()
  }

  componentDidUpdate(previous: VirtualizerBoundaryProps) {
    if (previous.epoch !== this.props.epoch && this.state.hasError) {
      this.setState({ hasError: false })
    }
  }

  render() {
    return this.state.hasError ? this.props.fallback : this.props.children
  }
}
