import type { AddressInfo } from 'node:net'
import { createAdaptorServer, type ServerType } from '@hono/node-server'
import type { Hono } from 'hono'
import { createApp } from './app.js'

export interface StartOptions {
  /** Port to bind; 0 lets the OS pick a free one. */
  port: number
  /** Address to bind. Defaults to loopback in the CLI; nothing here widens that. */
  host: string
  /** Directory with the built web UI. */
  publicDir: string
}

export interface RunningServer {
  host: string
  /** The port actually bound (differs from the requested one after an EADDRINUSE retry). */
  port: number
  url: string
  close(): Promise<void>
}

/** Start the HTTP server; if the requested port is taken, retry exactly once on a random free port. */
export async function startServer(opts: StartOptions): Promise<RunningServer> {
  const app = createApp({ publicDir: opts.publicDir })

  let server: ServerType
  try {
    server = await listen(app, opts.host, opts.port)
  } catch (err) {
    if (opts.port === 0 || !isAddrInUse(err)) throw err
    server = await listen(app, opts.host, 0)
  }

  const address = server.address()
  if (!address || typeof address === 'string') {
    throw new Error(`coja: unexpected server address ${String(address)}`)
  }

  return {
    host: opts.host,
    port: address.port,
    url: `http://${formatHost(opts.host)}:${address.port}`,
    close: () =>
      new Promise<void>((resolve, reject) => {
        // Idle keep-alive connections from the browser would otherwise hold close() open.
        if ('closeAllConnections' in server) server.closeAllConnections()
        server.close((err) => (err ? reject(err) : resolve()))
      }),
  }
}

function listen(app: Hono, host: string, port: number): Promise<ServerType> {
  return new Promise((resolve, reject) => {
    const server = createAdaptorServer({ fetch: app.fetch })
    server.once('error', reject)
    server.listen(port, host, () => {
      server.off('error', reject)
      resolve(server)
    })
  })
}

function isAddrInUse(err: unknown): boolean {
  return err instanceof Error && (err as NodeJS.ErrnoException).code === 'EADDRINUSE'
}

/** IPv6 literals need brackets inside a URL. */
function formatHost(host: string): string {
  return host.includes(':') ? `[${host}]` : host
}

export type { AddressInfo }
