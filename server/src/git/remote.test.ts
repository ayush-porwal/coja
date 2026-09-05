import { describe, expect, it } from 'vitest'
import { parseGitHubRemote, parseRepoSlug } from './remote.js'

const acme = { owner: 'acme', repo: 'widgets' }

describe('parseGitHubRemote', () => {
  it.each([
    'git@github.com:acme/widgets.git',
    'git@github.com:acme/widgets',
    'ssh://git@github.com/acme/widgets.git',
    'ssh://git@github.com:22/acme/widgets.git',
    'https://github.com/acme/widgets',
    'https://github.com/acme/widgets.git',
    'https://github.com/acme/widgets/',
    'https://github.com/acme/widgets.git/',
    'http://github.com/acme/widgets',
    'https://user@github.com/acme/widgets.git',
    'https://www.github.com/acme/widgets',
    'git://github.com/acme/widgets',
    'git://github.com/acme/widgets.git',
    'github.com/acme/widgets',
    'GitHub.com/acme/widgets',
    '  https://github.com/acme/widgets.git\n',
  ])('parses %s', (url) => {
    expect(parseGitHubRemote(url)).toEqual(acme)
  })

  it('keeps dots, dashes and underscores in names', () => {
    expect(parseGitHubRemote('git@github.com:my-org/my.repo_v2.git')).toEqual({
      owner: 'my-org',
      repo: 'my.repo_v2',
    })
  })

  it.each([
    '',
    'acme/widgets',
    'https://gitlab.com/acme/widgets.git',
    'git@gitlab.com:acme/widgets.git',
    'https://github.com/acme',
    'https://github.com/acme/widgets/tree/main',
    'https://github.com/',
    'https://notgithub.com/acme/widgets',
    'https://github.com.evil.example/acme/widgets',
    'git@github.com:acme/../widgets.git',
    'git@github.com:/widgets.git',
    '/Users/me/src/widgets',
    'file:///tmp/origin.git',
  ])('rejects %j', (url) => {
    expect(parseGitHubRemote(url)).toBeNull()
  })
})

describe('parseRepoSlug', () => {
  it('accepts owner/repo', () => {
    expect(parseRepoSlug('acme/widgets')).toEqual(acme)
    expect(parseRepoSlug(' acme/widgets.git ')).toEqual(acme)
  })

  it('accepts the URL forms too', () => {
    expect(parseRepoSlug('https://github.com/acme/widgets')).toEqual(acme)
    expect(parseRepoSlug('git@github.com:acme/widgets.git')).toEqual(acme)
  })

  it('rejects everything else', () => {
    for (const bad of [
      'widgets',
      'acme/widgets/extra',
      'acme/wid gets',
      '-acme/widgets/',
      '..',
      'a/..',
    ]) {
      expect(parseRepoSlug(bad), bad).toBeNull()
    }
  })
})
