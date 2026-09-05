import { parseArgs } from 'node:util'
import { assertGitVersion } from './git/plumbing.js'
import { openBrowser } from './open-browser.js'
import { packageVersion, resolvePublicDir } from './paths.js'
import { startServer } from './server.js'
import { createServices } from './services.js'

const DEFAULT_PORT = 4321
const DEFAULT_HOST = '127.0.0.1'
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1'])

const HELP = `coja — local code review for GitHub pull requests

Usage: coja [options]

Options:
  -p, --port <n>   Port to listen on (default ${DEFAULT_PORT}; a free port is picked if it is taken)
      --host <h>   Address to bind (default ${DEFAULT_HOST}; coja is meant to stay on loopback)
      --no-open    Do not open the browser
  -v, --version    Print the version and exit
  -h, --help       Show this help and exit
`

function parseCli(argv: string[]) {
  const { values } = parseArgs({
    args: argv,
    allowNegative: true,
    options: {
      port: { type: 'string', short: 'p', default: String(DEFAULT_PORT) },
      host: { type: 'string', default: DEFAULT_HOST },
      open: { type: 'boolean', default: true },
      version: { type: 'boolean', short: 'v', default: false },
      help: { type: 'boolean', short: 'h', default: false },
    },
  })
  const port = Number(values.port)
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error(`invalid --port "${values.port}": expected an integer between 0 and 65535`)
  }
  return { port, host: values.host, open: values.open, version: values.version, help: values.help }
}

async function main(): Promise<void> {
  let cli: ReturnType<typeof parseCli>
  try {
    cli = parseCli(process.argv.slice(2))
  } catch (err) {
    console.error(`coja: ${err instanceof Error ? err.message : String(err)}\n`)
    console.error(HELP)
    process.exit(2)
  }
  if (cli.help) {
    console.log(HELP)
    return
  }
  if (cli.version) {
    console.log(packageVersion())
    return
  }
  if (!LOOPBACK_HOSTS.has(cli.host)) {
    console.warn(
      `coja: binding to ${cli.host} exposes the server beyond this machine; use loopback unless you know why.`,
    )
  }

  try {
    await assertGitVersion()
  } catch (err) {
    console.error(`coja: ${err instanceof Error ? err.message : String(err)}`)
    process.exit(1)
  }
  const services = await createServices()
  const server = await startServer({
    port: cli.port,
    host: cli.host,
    publicDir: resolvePublicDir(),
    services,
    allowedHosts: LOOPBACK_HOSTS.has(cli.host) ? [] : [cli.host],
  })
  if (cli.port !== 0 && server.port !== cli.port) {
    console.log(`coja: port ${cli.port} is in use, using ${server.port} instead`)
  }
  console.log(`coja v${packageVersion()} → ${server.url}`)
  if (cli.open) openBrowser(server.url)

  const shutdown = () => {
    server.close().finally(() => process.exit(0))
  }
  process.once('SIGINT', shutdown)
  process.once('SIGTERM', shutdown)
}

await main()
