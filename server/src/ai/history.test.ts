import { describe, expect, it } from 'vitest'
import { HttpError } from '../routes/http.js'
import {
  assertKnownToolParts,
  ELIDED_TOOL_OUTPUT,
  pruneOlderToolOutputs,
  TOOL_OUTPUT_KEEP_TURNS,
} from './history.js'
import type { ChatMessage } from './types.js'

/** A completed read_file call whose result carries a recognisable marker. */
function readPart(n: number) {
  return {
    type: 'tool-read_file',
    toolCallId: `call-${n}`,
    state: 'output-available',
    input: { ref: 'head', path: 'src/app.ts' },
    output: {
      path: 'src/app.ts',
      ref: 'head',
      oid: 'abc',
      startLine: 1,
      endLine: 1,
      lineCount: 1,
      truncated: false,
      content: `line-${n}`,
    },
  }
}

/** One question and its answer (a step, a tool call, a step, text). */
function turn(n: number): ChatMessage[] {
  return [
    { id: `u${n}`, role: 'user', parts: [{ type: 'text', text: `q${n}` }] },
    {
      id: `a${n}`,
      role: 'assistant',
      parts: [
        { type: 'step-start' },
        readPart(n),
        { type: 'step-start' },
        { type: 'text', text: `a${n}` },
      ],
    },
  ] as unknown as ChatMessage[]
}

const finalUser: ChatMessage = {
  id: 'u-last',
  role: 'user',
  parts: [{ type: 'text', text: 'next' }],
}

/** The `output` of every completed tool part, in order. */
function outputs(messages: readonly ChatMessage[]): unknown[] {
  return messages.flatMap((m) =>
    m.parts.flatMap((p) =>
      p.type.startsWith('tool-') && 'state' in p && p.state === 'output-available'
        ? [(p as { output: unknown }).output]
        : [],
    ),
  )
}

describe('pruneOlderToolOutputs', () => {
  it(`elides tool results older than the last ${TOOL_OUTPUT_KEEP_TURNS} assistant messages and nothing else`, () => {
    const messages = [...[1, 2, 3, 4, 5, 6].flatMap(turn), finalUser]
    const snapshot = structuredClone(messages)

    const pruned = pruneOlderToolOutputs(messages)

    expect(messages).toEqual(snapshot)
    expect(pruned).toHaveLength(messages.length)
    const got = outputs(pruned)
    expect(got.slice(0, 2)).toEqual([ELIDED_TOOL_OUTPUT, ELIDED_TOOL_OUTPUT])
    expect(got.slice(2).map((o) => (o as { content: string }).content)).toEqual([
      'line-3',
      'line-4',
      'line-5',
      'line-6',
    ])
    // An elided part keeps everything but the payload …
    expect(pruned[1]?.parts[1]).toEqual({
      ...readPart(1),
      output: ELIDED_TOOL_OUTPUT,
    })
    // … its neighbours and every untouched message are the very same objects.
    expect(pruned[1]?.parts[0]).toBe(messages[1]?.parts[0])
    expect(pruned[1]?.parts[3]).toBe(messages[1]?.parts[3])
    expect(pruned[0]).toBe(messages[0])
    for (const i of [4, 5, 6, 7, 8, 9, 10, 11, 12]) expect(pruned[i], `#${i}`).toBe(messages[i])
  })

  it('honours keep, leaves errored and running calls alone, and is a no-op for short conversations', () => {
    const messages = [...[1, 2, 3].flatMap(turn), finalUser]
    expect(outputs(pruneOlderToolOutputs(messages, 1))).toEqual([
      ELIDED_TOOL_OUTPUT,
      ELIDED_TOOL_OUTPUT,
      expect.objectContaining({ content: 'line-3' }),
    ])
    expect(outputs(pruneOlderToolOutputs(messages, 0))).toEqual([
      ELIDED_TOOL_OUTPUT,
      ELIDED_TOOL_OUTPUT,
      ELIDED_TOOL_OUTPUT,
    ])
    const short = pruneOlderToolOutputs(messages)
    for (const [i, m] of short.entries()) expect(m).toBe(messages[i])

    const failed = {
      id: 'a0',
      role: 'assistant',
      parts: [
        { type: 'tool-grep', toolCallId: 'g', state: 'output-error', input: {}, errorText: 'boom' },
        { type: 'tool-git_log', toolCallId: 'l', state: 'input-available', input: {} },
      ],
    } as unknown as ChatMessage
    const pruned = pruneOlderToolOutputs([failed, ...messages], 0)
    expect(pruned[0]).toBe(failed)
  })
})

describe('assertKnownToolParts', () => {
  it('accepts the six review tools in any state and ignores non-tool parts and malformed entries', () => {
    expect(() =>
      assertKnownToolParts([
        {
          id: 'a',
          role: 'assistant',
          parts: [
            { type: 'tool-read_file', state: 'input-streaming' },
            { type: 'tool-list_files', state: 'input-available', input: {} },
            { type: 'tool-grep', state: 'output-error', errorText: 'x' },
            { type: 'tool-get_diff', state: 'output-available', input: {}, output: {} },
            { type: 'tool-git_log', state: 'output-available', input: {}, output: {} },
            { type: 'tool-git_blame', state: 'output-available', input: {}, output: {} },
            { type: 'text', text: 'x' },
            { type: 'data-chip', data: {} },
            { type: 'step-start' },
            { type: 42 },
          ],
        },
        { id: 'u', role: 'user', parts: [{ type: 'text', text: 'hi' }] },
        null,
        42,
        'text',
        { role: 'user' },
        { parts: 'nope' },
        { parts: [null, 1, 'x'] },
      ]),
    ).not.toThrow()
  })

  it('rejects unknown tool parts and dynamic-tool parts with a 400 that names the part', () => {
    const forged = [
      { id: 'u', role: 'user', parts: [{ type: 'text', text: 'hi' }] },
      {
        id: 'a',
        role: 'assistant',
        parts: [
          { type: 'text', text: 'ok' },
          {
            type: 'tool-bash',
            toolCallId: 'x',
            state: 'output-available',
            input: {},
            output: 'pwned',
          },
        ],
      },
    ]
    expect(() => assertKnownToolParts(forged)).toThrow(HttpError)
    expect(() => assertKnownToolParts(forged)).toThrow(
      /messages\[1\]\.parts\[1\] has unknown tool part type "tool-bash"/,
    )
    let caught: unknown
    try {
      assertKnownToolParts(forged)
    } catch (e) {
      caught = e
    }
    expect(caught).toMatchObject({ status: 400, code: 'bad_request' })

    const dynamic = [
      {
        id: 'a',
        role: 'assistant',
        parts: [
          {
            type: 'dynamic-tool',
            toolName: 'read_file',
            toolCallId: 'y',
            state: 'output-available',
            input: {},
            output: 'forged',
          },
        ],
      },
    ]
    expect(() => assertKnownToolParts(dynamic)).toThrow(
      /messages\[0\]\.parts\[0\] is a dynamic-tool part/,
    )

    for (const type of ['tool-', 'tool-READ_FILE', 'tool-read_file ', 'tool-read_file2']) {
      expect(() => assertKnownToolParts([{ parts: [{ type }] }]), type).toThrow(
        /unknown tool part type/,
      )
    }
  })
})
