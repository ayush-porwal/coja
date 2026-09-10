export const REVIEW_TOOL_NAMES = [
  'read_file',
  'list_files',
  'grep',
  'get_diff',
  'git_log',
  'git_blame',
] as const

export type ReviewToolName = (typeof REVIEW_TOOL_NAMES)[number]
