/**
 * Live Stellar-testnet proof. No mocks: starts this example's real server and
 * pays it with nirium's real client (`initX402` + `x402Fetch`) through the real
 * OpenZeppelin Channels testnet facilitator.
 *
 *   1. GET without payment            -> expects HTTP 402
 *   2. x402Fetch (signs and pays)     -> expects HTTP 200 and a settled transaction
 *   3. prints the Stellar Expert link for the README
 *
 * Needs in .env (see .env.example): X402_SELLER_ADDRESS, FACILITATOR_API_KEY,
 * BUYER_SECRET. `npm run testnet:setup` prepares the accounts; the buyer also
 * needs testnet USDC from https://faucet.circle.com.
 *
 * Run: npm run testnet:proof
 */
import 'dotenv/config'

import { Keypair } from '@stellar/stellar-sdk'
import { Agent } from 'nirium'

import { createApp, PAID_ROUTE } from '../src/server.js'

function requireEnv(name: string): string {
  const value = process.env[name]
  if (!value) throw new Error(`Missing required env var ${name}. See .env.example.`)
  return value
}

async function main(): Promise<void> {
  const payTo = requireEnv('X402_SELLER_ADDRESS')
  const facilitatorApiKey = requireEnv('FACILITATOR_API_KEY')
  const buyerSecret = requireEnv('BUYER_SECRET')
  const buyer = Keypair.fromSecret(buyerSecret)

  const port = Number(process.env.PORT ?? 3402)
  const app = createApp({ payTo, facilitatorApiKey, network: 'stellar:testnet', price: process.env.X402_PRICE ?? '0.02' })
  await app.listen({ port, host: '127.0.0.1' })
  const url = `http://127.0.0.1:${port}${PAID_ROUTE}`
  console.log(`Server up: ${url}`)
  console.log(`  seller (payTo): ${payTo}`)
  console.log(`  buyer (payer):  ${buyer.publicKey()}`)

  try {
    const unpaid = await fetch(url)
    if (unpaid.status !== 402) throw new Error(`Expected 402 without payment, got ${unpaid.status}`)
    console.log('✓ unpaid request -> HTTP 402')

    const agent = new Agent({ apiKey: 'demo', baseUrl: `http://127.0.0.1:${port}` })
    agent.initX402({ secretKey: buyerSecret, network: 'stellar:testnet' })
    const paid = await agent.x402Fetch(url)
    if (paid.status !== 200) throw new Error(`Expected 200 after payment, got ${paid.status}: ${await paid.text()}`)
    console.log('✓ paid request via initX402/x402Fetch -> HTTP 200')
    console.log(JSON.stringify(await paid.json(), null, 2))

    const receiptHeader = paid.headers.get('payment-response') ?? paid.headers.get('x-payment-response')
    const receipt = receiptHeader ? JSON.parse(Buffer.from(receiptHeader, 'base64').toString('utf8')) : undefined
    if (receipt?.transaction) {
      console.log(`\nSettled transaction: ${receipt.transaction}`)
      console.log(`Stellar Expert:      https://stellar.expert/explorer/testnet/tx/${receipt.transaction}`)
    } else {
      console.log('\nNo transaction hash in the payment-response header. Check the facilitator.')
    }
  } finally {
    await app.close()
  }
}

main().catch((err) => {
  console.error(err)
  process.exitCode = 1
})
