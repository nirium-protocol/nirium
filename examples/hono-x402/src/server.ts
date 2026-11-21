import 'dotenv/config'

import { serve } from '@hono/node-server'
import { Hono, type MiddlewareHandler } from 'hono'
import { x402Serve } from 'nirium'
import { pathToFileURL } from 'node:url'

import { runExpressMiddleware } from './express-shim.js'

export const PAID_ROUTE = '/paid/market-summary'

export interface ServerConfig {
  /** Stellar public key (G...) that receives payment. Public, never a secret. */
  payTo: string
  /** Free per-network key from OpenZeppelin Channels. Not needed if `facilitatorUrl` is set. */
  facilitatorApiKey?: string
  facilitatorUrl?: string
  network?: 'stellar:testnet' | 'stellar:pubnet'
  /** USDC price, e.g. "0.02" or "$0.02". */
  price?: string
}

/**
 * Hono middleware that runs x402Serve() unchanged. The adapter lives in
 * ./express-shim.ts; see the README for why it is needed.
 */
export function x402Paywall(expressMiddleware: ReturnType<typeof x402Serve>): MiddlewareHandler {
  return async (c, next) => {
    const incoming = (c.env as { incoming?: { socket?: { remoteAddress?: string } } } | undefined)?.incoming
    const response = await runExpressMiddleware(
      expressMiddleware,
      c.req.raw,
      async () => {
        await next() // runs the route handler; Hono stores its Response on c.res
        return c.res
      },
      { ip: incoming?.socket?.remoteAddress },
    )
    c.res = response
  }
}

/** A factory (not a module that listens on import) so tests can build it without a port. */
export function createApp(config: ServerConfig): Hono {
  const network = config.network ?? 'stellar:testnet'
  const priceValue = config.price ?? '0.02'
  const price = priceValue.startsWith('$') ? priceValue : `$${priceValue}`

  const paywall = x402Paywall(
    x402Serve({
      payTo: config.payTo,
      network,
      appName: 'Nirium Hono x402 example',
      routes: {
        [`GET ${PAID_ROUTE}`]: {
          price,
          description: 'Nirium x402-protected market summary example',
        },
      },
      ...(config.facilitatorApiKey ? { facilitatorApiKey: config.facilitatorApiKey } : {}),
      ...(config.facilitatorUrl ? { facilitatorUrl: config.facilitatorUrl } : {}),
    }),
  )

  const app = new Hono()

  app.get('/health', (c) => c.json({ ok: true, service: 'nirium-hono-x402-example' }))

  // Same paid route and response as examples/express-x402.
  app.get(PAID_ROUTE, paywall, (c) =>
    c.json({
      ok: true,
      route: PAID_ROUTE,
      network,
      message: 'Payment accepted. This is the protected Nirium market summary response.',
      summary: {
        asset: 'USDC',
        rails: ['x402', 'Stellar testnet'],
        price: priceValue.replace(/^\$/, ''),
      },
    }),
  )

  return app
}

function main(): void {
  const payTo = process.env.X402_SELLER_ADDRESS
  const facilitatorApiKey = process.env.FACILITATOR_API_KEY
  const facilitatorUrl = process.env.X402_FACILITATOR_URL
  if (!payTo) {
    console.error('Missing X402_SELLER_ADDRESS. Run `npm run testnet:setup` or see .env.example.')
    process.exit(1)
  }
  if (!facilitatorApiKey && !facilitatorUrl) {
    console.error('Missing FACILITATOR_API_KEY. Get a free testnet key at https://channels.openzeppelin.com/testnet/gen')
    process.exit(1)
  }

  const port = Number(process.env.PORT ?? 3402)
  const network = (process.env.X402_NETWORK ?? 'stellar:testnet') as NonNullable<ServerConfig['network']>
  const app = createApp({
    payTo,
    network,
    price: process.env.X402_PRICE ?? '0.02',
    ...(facilitatorApiKey ? { facilitatorApiKey } : {}),
    ...(facilitatorUrl ? { facilitatorUrl } : {}),
  })

  serve({ fetch: app.fetch, port }, () => {
    console.log(`Nirium x402 Hono example listening on http://localhost:${port}`)
    console.log(`Paid route: http://localhost:${port}${PAID_ROUTE}`)
  })
}

// Only auto-start when run directly (`npm run dev`), not when imported by tests/scripts.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main()
}
