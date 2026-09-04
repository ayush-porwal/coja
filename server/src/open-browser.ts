import { spawn } from 'node:child_process'

/**
 * Open `url` in the user's default browser without any dependency.
 * Best effort: failures are swallowed, the URL is printed anyway.
 */
export function openBrowser(url: string): void {
  const [command, args] = commandFor(process.platform, url)
  try {
    const child = spawn(command, args, { stdio: 'ignore', detached: true })
    child.on('error', () => {})
    child.unref()
  } catch {
    // ignore: the user can still open the printed URL by hand
  }
}

function commandFor(platform: NodeJS.Platform, url: string): [string, string[]] {
  switch (platform) {
    case 'darwin':
      return ['open', [url]]
    case 'win32':
      // The empty string is the window title `start` would otherwise steal the URL for.
      return ['cmd', ['/c', 'start', '', url]]
    default:
      return ['xdg-open', [url]]
  }
}
