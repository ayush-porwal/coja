import { type PrListState, tokenizePrQuery } from '@coja/shared/api'

export interface QuerySuggestion {
  value: string
  description: string
}

const FILTERS: QuerySuggestion[] = [
  { value: 'is:open', description: 'Open pull requests' },
  { value: 'is:closed', description: 'Closed pull requests, including merged' },
  { value: 'is:merged', description: 'Merged pull requests' },
  { value: 'is:all', description: 'Open, closed, and merged' },
  { value: 'is:draft', description: 'Draft pull requests' },
  { value: 'is:ready', description: 'Ready for review' },
  { value: 'author:', description: 'Filter by author' },
  { value: 'base:', description: 'Filter by target branch' },
  { value: 'head:', description: 'Filter by source branch' },
  { value: 'draft:true', description: 'Draft pull requests' },
  { value: 'draft:false', description: 'Ready for review' },
]

function activeToken(query: string, caret: number) {
  return tokenizePrQuery(query).find((token) => token.start <= caret && token.end >= caret)
}

export function querySuggestions(query: string, caret: number, values: QuerySuggestion[] = []) {
  const token = activeToken(query, caret)
  const prefix = query.slice(token?.start ?? caret, caret).toLowerCase()
  const used = new Set(
    tokenizePrQuery(query)
      .filter((t) => t.start !== token?.start)
      .map((t) => t.field),
  )
  const options = prefix.startsWith('state:')
    ? FILTERS.filter((s) => /^is:(open|closed|merged|all)$/.test(s.value)).map((s) => ({
        ...s,
        value: s.value.replace('is:', 'state:'),
      }))
    : [...FILTERS, ...values]
  return options.filter((option) => {
    const field = tokenizePrQuery(`${option.value}${option.value.endsWith(':') ? 'value' : ''}`)[0]
      ?.field
    return (
      option.value.toLowerCase().startsWith(prefix) &&
      option.value.toLowerCase() !== prefix &&
      (!field || !used.has(field))
    )
  })
}

/** Replace only the token under the caret, preserving surrounding filters and title text. */
export function completeQuery(query: string, caret: number, value: string) {
  const token = activeToken(query, caret)
  const start = token?.start ?? caret
  const end = token?.end ?? caret
  const suffix = query.slice(end)
  const separator = value.endsWith(':') || /^\s/.test(suffix) ? '' : ' '
  return {
    query: query.slice(0, start) + value + separator + suffix,
    caret: start + value.length + separator.length,
  }
}

export function replaceQueryState(query: string, state: PrListState): string {
  const remaining = tokenizePrQuery(query)
    .filter((token) => token.field !== 'state')
    .map((token) => token.raw)
    .join(' ')
  return [`is:${state}`, remaining].filter(Boolean).join(' ')
}
