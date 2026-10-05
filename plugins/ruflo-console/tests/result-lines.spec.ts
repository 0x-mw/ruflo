/** The result lines are tidied before a view draws them: ASCII tables are drawn again with aligned columns, nothing else is rewritten. */
import { describe, expect, it } from 'vitest'

import { prettyLines } from '../hooks/result-lines'

const PASTED = [
  'Pattern Optimization (Real)',
  'Quantized 349 pattern embeddings to Int8',
  '+-----------------+-----------+--------------+',
  '| Metric | Before | After |',
  '+-----------------+-----------+--------------+',
  '| Pattern Count | 349 | 349 |',
  '| Quantized | - | 349 |',
  '| Storage Size | 3751.9 KB | 3751.9 KB |',
  '| Reduction Ratio | - | 1.00x |',
  '| Precision | Float32 | Int8 (±0.5%) |',
  '+-----------------+-----------+--------------+',
]

describe('prettyLines', () => {
  it('draws the pasted CLI table with aligned columns and a header rule', () => {
    const out = prettyLines(PASTED)

    expect(out.slice(0, 2)).toEqual(['Pattern Optimization (Real)', 'Quantized 349 pattern embeddings to Int8'])
    expect(out[2]).toBe('┌─────────────────┬───────────┬──────────────┐')
    expect(out[3]).toBe('│ Metric          │ Before    │ After        │')
    expect(out[4]).toBe('├─────────────────┼───────────┼──────────────┤')
    expect(out[5]).toBe('│ Pattern Count   │ 349       │ 349          │')
    expect(out.at(-1)).toBe('└─────────────────┴───────────┴──────────────┘')
    expect(new Set(out.slice(2).map(line => line.length)).size).toBe(1)
  })

  it('leaves ordinary lines alone, trims trailing space and collapses runs of blank lines', () => {
    expect(prettyLines(['a  ', '', '', '', 'b', ''])).toEqual(['a', '', 'b'])
    expect(prettyLines([])).toEqual([])
  })

  it('does not touch a block it cannot read as a table (one row, ragged, or no columns)', () => {
    const ragged = ['| a | b |', '| c |']
    const single = ['| only | one |']

    expect(prettyLines(ragged)).toEqual(ragged)
    expect(prettyLines(single)).toEqual(single)
  })

  it('cuts a very long cell, keeps two tables apart, and bounds a runaway block', () => {
    const long = prettyLines(['| h | v |', '| a | ' + 'x'.repeat(80) + ' |'])

    expect(long.every(line => line.length <= 8 + 48)).toBe(true)
    expect(long.some(line => line.includes('…'))).toBe(true)

    const two = prettyLines(['| a | b |', '| 1 | 2 |', 'text', '| c | d |', '| 3 | 4 |'])

    expect(two.filter(line => line.startsWith('┌'))).toHaveLength(2)
    expect(prettyLines(Array.from({ length: 300 }, () => '| a | b |'))).toHaveLength(300)
  })

  it('never invents text: every cell of the output was in the input', () => {
    const cells = new Set(PASTED.filter(line => line.startsWith('|')).flatMap(line => line.slice(1, -1).split('|').map(cell => cell.trim())))

    for (const line of prettyLines(PASTED).filter(row => row.startsWith('│'))) for (const cell of line.slice(1, -1).split('│').map(part => part.trim())) expect(cells.has(cell), cell).toBe(true)
  })
})
