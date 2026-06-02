import { workspace } from 'vscode'

export interface HostPickItem {
  label: string
  description: string | undefined
  detail: string | undefined
  hostName: string
  configFile: string | undefined
  lineNumber: number | undefined
}

interface Range {
  start: number
  end: number
}

export type HostPickItemResult = HostPickItem & {
  highlights?: {
    label?: [number, number][]
    description?: [number, number][]
    detail?: [number, number][]
  }
}

type TokenType = 'include' | 'exclude' | 'prefix' | 'suffix' | 'exact'

interface Token {
  type: TokenType
  value: string
}

function parseTokens(part: string): Token[] {
  const tokens: Token[] = []
  const re = /"([^"]*)"|(\S+)/g
  let m: RegExpExecArray | null
  // eslint-disable-next-line no-cond-assign
  while ((m = re.exec(part)) !== null) {
    if (m[1] !== undefined) {
      if (m[1])
        tokens.push({ type: 'exact', value: m[1].toLowerCase() })
    }
    else {
      const t = m[2]
      if (!t)
        continue
      if (t.startsWith('!'))
        tokens.push({ type: 'exclude', value: t.slice(1).toLowerCase() })
      else if (t.startsWith('^'))
        tokens.push({ type: 'prefix', value: t.slice(1).toLowerCase() })
      else if (t.endsWith('$'))
        tokens.push({ type: 'suffix', value: t.slice(0, -1).toLowerCase() })
      else
        tokens.push({ type: 'include', value: t.toLowerCase() })
    }
  }
  return tokens
}

// Returns all non-overlapping match ranges for a token in a string (original case).
function findRanges(original: string, token: Token): Range[] {
  const lower = original.toLowerCase()
  const ranges: Range[] = []
  if (token.type === 'exclude')
    return ranges
  if (token.type === 'prefix') {
    if (lower.startsWith(token.value))
      ranges.push({ start: 0, end: token.value.length })
    return ranges
  }
  if (token.type === 'suffix') {
    if (lower.endsWith(token.value))
      ranges.push({ start: lower.length - token.value.length, end: lower.length })
    return ranges
  }
  // include / exact: find all occurrences
  let idx = 0
  while (idx < lower.length) {
    const pos = lower.indexOf(token.value, idx)
    if (pos === -1)
      break
    ranges.push({ start: pos, end: pos + token.value.length })
    idx = pos + token.value.length
  }
  return ranges
}

function mergeRanges(ranges: Range[]): Range[] {
  if (ranges.length === 0)
    return []
  const sorted = [...ranges].sort((a, b) => a.start - b.start)
  const merged: Range[] = [{ ...sorted[0] }]
  for (let i = 1; i < sorted.length; i++) {
    const last = merged[merged.length - 1]
    if (sorted[i].start <= last.end)
      last.end = Math.max(last.end, sorted[i].end)
    else
      merged.push({ ...sorted[i] })
  }
  return merged
}

function scoreToken(haystack: string, token: Token, weight: number): number {
  if (token.type === 'exclude')
    return haystack.toLowerCase().includes(token.value) ? 0 : weight
  const ranges = findRanges(haystack, token)
  if (ranges.length === 0)
    return 0
  return token.type === 'prefix' ? weight * 2 : weight
}

function fuzzyMatch(item: HostPickItem, query: string): { score: number, label: Range[], description: Range[], detail: Range[] } | null {
  const branches = query.split('|').map(p => p.trim()).filter(Boolean)
  let best: { score: number, label: Range[], description: Range[], detail: Range[] } | null = null

  for (const branch of branches) {
    const tokens = parseTokens(branch)
    if (tokens.length === 0)
      continue
    const label = item.label
    const desc = item.description ?? ''
    const detail = item.detail ?? ''
    let branchScore = 0
    let valid = true
    const labelRanges: Range[] = []
    const descRanges: Range[] = []
    const detailRanges: Range[] = []

    for (const token of tokens) {
      if (token.type === 'exclude') {
        const lLow = label.toLowerCase()
        const dLow = desc.toLowerCase()
        const detLow = detail.toLowerCase()
        if (lLow.includes(token.value) || dLow.includes(token.value) || detLow.includes(token.value)) {
          valid = false
          break
        }
        branchScore += 1
        continue
      }
      const ls = scoreToken(label, token, 10)
      const ds = scoreToken(desc, token, 5)
      const dets = scoreToken(detail, token, 1)
      const best3 = Math.max(ls, ds, dets)
      if (best3 === 0) {
        valid = false
        break
      }
      branchScore += best3
      if (ls > 0)
        labelRanges.push(...findRanges(label, token))
      if (ds > 0)
        descRanges.push(...findRanges(desc, token))
      if (dets > 0)
        detailRanges.push(...findRanges(detail, token))
    }

    if (valid && branchScore > (best?.score ?? 0)) {
      best = {
        score: branchScore,
        label: mergeRanges(labelRanges),
        description: mergeRanges(descRanges),
        detail: mergeRanges(detailRanges),
      }
    }
  }
  return best
}

function simpleScore(item: HostPickItem, lower: string): number {
  const hostMatch = item.label.toLowerCase().includes(lower) ? 2 : 0
  const descMatch = (item.description ?? '').toLowerCase().includes(lower) ? 1 : 0
  return hostMatch + descMatch
}

export function invalidateFuseCache(): void {
  // no-op: kept for API compatibility
}

export function searchItems(items: HostPickItem[], query: string): HostPickItemResult[] {
  const trimmed = query.trim()
  if (!trimmed)
    return items

  const mode = workspace.getConfiguration('sshConfigAllInOne.search').get<string>('mode', 'fuzzy')

  if (mode === 'simple') {
    const lower = trimmed.toLowerCase()
    return items
      .map(item => ({ item, score: simpleScore(item, lower) }))
      .filter(s => s.score > 0)
      .sort((a, b) => b.score - a.score)
      .map(s => s.item)
  }

  return items
    .map((item) => {
      const match = fuzzyMatch(item, trimmed)
      return match ? { item, ...match } : null
    })
    .filter((s): s is { item: HostPickItem, score: number, label: Range[], description: Range[], detail: Range[] } => s !== null)
    .sort((a, b) => b.score - a.score)
    .map(s => ({
      ...s.item,
      highlights: {
        label: s.label.length > 0 ? s.label.map(r => [r.start, r.end] as [number, number]) : undefined,
        description: s.description.length > 0 ? s.description.map(r => [r.start, r.end] as [number, number]) : undefined,
        detail: s.detail.length > 0 ? s.detail.map(r => [r.start, r.end] as [number, number]) : undefined,
      },
    }))
}
