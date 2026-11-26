import 'dotenv/config'

import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify'
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

/** Fastify's request as a web `Request`, which is what the adapter consumes. */
function toWebRequest(request: FastifyRequest): Request {
  const headers = new Headers()
  for (const [key, value] of Object.entries(request.headers)) {
    if (value === undefined) continue
    for (const v of Array.isArray(value) ? value : [value]) headers.append(key, v)
  }
  return new Request(`${request.protocol}://${request.host}${request.url}`, { method: request.method, headers })
}

/**
 * Wraps a Fastify route handler so it runs behind x402Serve() unchanged. The
 * adapter lives in ./express-shim.ts; see the README for why it is needed.
 *
 * `handler` returns the JSON body to send. It only runs after a valid payment
 * was verified, and its response is released only once the payment has settled.
 */
export function x402Paywall(expressMiddleware: ReturnType<typeof x402Serve>) {
  return (handler: (request: FastifyRequest) => unknown | Promise<unknown>) =>
    async (request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> => {
      const response = await runExpressMiddleware(
        expressMiddleware,
        toWebRequest(request),
        async () => Response.json(await handler(request)),
        { ip: request.ip, body: request.body },
      )
      reply.code(response.status)
      response.headers.forEach((value, key) => {
        if (key.toLowerCase() !== 'set-cookie') reply.header(key, value)
      })
      const cookies = response.headers.getSetCookie()
      if (cookies.length) reply.header('set-cookie', cookies)
      return reply.send(Buffer.from(await response.arrayBuffer()))
    }
}

/** A factory (not a module that listens on import) so tests can build it without a port. */
export function createApp(config: ServerConfig): FastifyInstance {
  const network = config.network ?? 'stellar:testnet'
  const priceValue = config.price ?? '0.02'
  const price = priceValue.startsWith('$') ? priceValue : `$${priceValue}`

  const paid = x402Paywall(
    x402Serve({
      payTo: config.payTo,
      network,
      appName: 'Nirium Fastify x402 example',
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

  const app = Fastify()

  app.get('/health', async () => ({ ok: true, service: 'nirium-fastify-x402-example' }))

  // Same paid route and response as examples/express-x402.
  app.get(
    PAID_ROUTE,
    paid(async () => ({
      ok: true,
      route: PAID_ROUTE,
      network,
      message: 'Payment accepted. This is the protected Nirium market summary response.',
      summary: {
        asset: 'USDC',
        rails: ['x402', 'Stellar testnet'],
        price: priceValue.replace(/^\$/, ''),
      },
    })),
  )

  return app
}

async function main(): Promise<void> {
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

  await app.listen({ port })
  console.log(`Nirium x402 Fastify example listening on http://localhost:${port}`)
  console.log(`Paid route: http://localhost:${port}${PAID_ROUTE}`)
}

// Only auto-start when run directly (`npm run dev`), not when imported by tests/scripts.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(err)
    process.exit(1)
  })
}
