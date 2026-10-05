/**
 * Tidies the lines of a result before any view draws them. The CLI prints its tables as ASCII (`+----+` rules and `| cell | cell |` rows);
 * by the time the console has cleaned the text for display the padding is gone and the columns no longer line up. This reads such a block
 * back as cells and draws it again with box characters and aligned columns. Everything else passes through, only with trailing space
 * removed and runs of blank lines collapsed to one. Pure, bounded, and it never invents text: a block it cannot read as a table stays as it was.
 */

const RULE = /^\s*\+[-=+]{2,}\+\s*$/
const ROW = /^\s*\|.*\|\s*$/
/** The widest a column is drawn; a longer cell is cut with an ellipsis. */
const MAX_CELL = 48
/** The most table lines read as one block (a runaway block stays as plain lines). */
const MAX_BLOCK = 200

const cellsOf = (line: string): string[] => line.trim().slice(1, -1).split('|').map(cell => cell.trim())
const cut = (cell: string): string => (cell.length > MAX_CELL ? `${cell.slice(0, MAX_CELL - 1)}…` : cell)

/** One table block (rules and rows, in order) as box-drawn lines, or null when it is not a rectangular table of at least two rows. */
function drawTable(block: readonly string[]): string[] | null {
  const rows = block.filter(line => ROW.test(line)).map(cellsOf)

  if (rows.length < 2) return null

  const columns = rows[0]?.length ?? 0

  if (columns < 2 || rows.some(row => row.length !== columns)) return null

  const widths = Array.from({ length: columns }, (_, column) => Math.max(1, ...rows.map(row => cut(row[column] ?? '').length)))
  const rule = (left: string, mid: string, right: string): string => `${left}${widths.map(width => '─'.repeat(width + 2)).join(mid)}${right}`
  const draw = (row: readonly string[]): string => `│${row.map((cell, column) => ` ${cut(cell).padEnd(widths[column] ?? 0)} `).join('│')}│`
  // The first row is the header when a rule sits right under it (the CLI's table shape).
  const hasHeader = block.findIndex(line => ROW.test(line)) + 1 < block.length && RULE.test(block[block.findIndex(line => ROW.test(line)) + 1] ?? '')
  const [head, ...rest] = rows

  return [rule('┌', '┬', '┐'), ...(hasHeader && head !== undefined ? [draw(head), rule('├', '┼', '┤')] : head !== undefined ? [draw(head)] : []), ...rest.map(draw), rule('└', '┴', '┘')]
}

export function prettyLines(lines: readonly string[]): string[] {
  const out: string[] = []
  let block: string[] = []
  let blank = false

  const flush = (): void => {
    if (block.length === 0) return

    const drawn = block.length <= MAX_BLOCK ? drawTable(block) : null

    out.push(...(drawn ?? block.map(line => line.trimEnd())))
    block = []
  }

  for (const raw of lines) {
    if (RULE.test(raw) || ROW.test(raw)) {
      blank = false
      block.push(raw)
      continue
    }

    flush()

    const line = raw.trimEnd()

    if (line.trim() === '') {
      if (!blank && out.length > 0) out.push('')
      blank = true
      continue
    }

    blank = false
    out.push(line)
  }

  flush()

  while (out.length > 0 && out[out.length - 1] === '') out.pop()

  return out
}
