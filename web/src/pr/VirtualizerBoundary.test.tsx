import { render, screen } from '@testing-library/react'
import { Component } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { VirtualizerBoundary } from './VirtualizerBoundary'

class Bomb extends Component<{ explode: boolean }> {
  render() {
    if (this.props.explode) {
      throw new Error('VirtualizedFile.render: rendered a different file than its prepared layout')
    }
    return <p>ok</p>
  }
}

function renderBoundary(props: { explode: boolean; epoch: number; onRecover: () => void }) {
  return render(
    <VirtualizerBoundary
      epoch={props.epoch}
      onRecover={props.onRecover}
      fallback={<p>recovering</p>}
    >
      <Bomb explode={props.explode} />
    </VirtualizerBoundary>,
  )
}

describe('VirtualizerBoundary', () => {
  it('renders children while nothing throws', () => {
    renderBoundary({ explode: false, epoch: 0, onRecover: vi.fn() })
    expect(screen.getByText('ok')).toBeTruthy()
  })

  it('shows the fallback, reports the throw, and recovers when the epoch bumps', () => {
    const onRecover = vi.fn()
    const view = renderBoundary({ explode: false, epoch: 0, onRecover: vi.fn() })
    // child starts throwing
    view.rerender(
      <VirtualizerBoundary epoch={0} onRecover={onRecover} fallback={<p>recovering</p>}>
        <Bomb explode />
      </VirtualizerBoundary>,
    )
    expect(screen.getByText('recovering')).toBeTruthy()
    expect(onRecover).toHaveBeenCalledTimes(1)
    // parent remounts the tree with the current items: fresh boundary renders again
    view.rerender(
      <VirtualizerBoundary epoch={1} onRecover={onRecover} fallback={<p>recovering</p>}>
        <Bomb explode={false} />
      </VirtualizerBoundary>,
    )
    expect(screen.getByText('ok')).toBeTruthy()
    expect(onRecover).toHaveBeenCalledTimes(1)
  })
})
