/**
 * One-time setup for `npm run testnet:proof`. Real Stellar testnet calls, no mocks.
 *
 *  1. Generates a seller and a buyer keypair if SELLER_SECRET / BUYER_SECRET are
 *     empty in .env (created from .env.example if missing), and fills in
 *     X402_SELLER_ADDRESS with the seller's PUBLIC address. Secrets are written
 *     to .env only (gitignored) and are never printed.
 *  2. Funds both accounts with XLM through Friendbot.
 *  3. Opens a USDC trustline on both (needed to hold or receive testnet USDC).
 *
 * It cannot give the buyer testnet USDC: Circle's faucet is behind a captcha, so
 * that step is yours (the script prints where).
 *
 * Run: npm run testnet:setup
 */
import { Asset, BASE_FEE, Horizon, Keypair, Networks, Operation, TransactionBuilder } from '@stellar/stellar-sdk'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'

const ENV_PATH = new URL('../.env', import.meta.url)
const ENV_EXAMPLE_PATH = new URL('../.env.example', import.meta.url)

// The classic issuer behind @x402/stellar's testnet USDC contract (the SAC wraps
// the asset USDC:<this issuer>).
const USDC_TESTNET_ISSUER = 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5'
const HORIZON_URL = 'https://horizon-testnet.stellar.org'
const FRIENDBOT_URL = 'https://friendbot.stellar.org'

function loadEnvFile(): string {
  if (existsSync(ENV_PATH)) return readFileSync(ENV_PATH, 'utf8')
  return readFileSync(ENV_EXAMPLE_PATH, 'utf8')
}

function getVar(env: string, name: string): string {
  const match = env.match(new RegExp(`^${name}=(.*)$`, 'm'))
  return match?.[1]?.trim() ?? ''
}

function setVar(env: string, name: string, value: string): string {
  const line = `${name}=${value}`
  const re = new RegExp(`^${name}=.*$`, 'm')
  return re.test(env) ? env.replace(re, line) : `${env.replace(/\n*$/, '\n')}${line}\n`
}

async function fundIfNeeded(server: Horizon.Server, publicKey: string): Promise<void> {
  try {
    await server.loadAccount(publicKey)
    console.log(`  already funded: ${publicKey}`)
    return
  } catch {
    // Not found yet: ask Friendbot.
  }
  const res = await fetch(`${FRIENDBOT_URL}?addr=${encodeURIComponent(publicKey)}`)
  if (!res.ok) throw new Error(`Friendbot funding failed for ${publicKey}: HTTP ${res.status}`)
  console.log(`  funded via Friendbot: ${publicKey}`)
}

async function openTrustlineIfNeeded(server: Horizon.Server, keypair: Keypair): Promise<void> {
  const account = await server.loadAccount(keypair.publicKey())
  const hasTrustline = (account.balances as unknown as Array<Record<string, unknown>>).some(
    (b) => b.asset_code === 'USDC' && b.asset_issuer === USDC_TESTNET_ISSUER,
  )
  if (hasTrustline) {
    console.log(`  USDC trustline already open: ${keypair.publicKey()}`)
    return
  }
  const tx = new TransactionBuilder(account, { fee: BASE_FEE, networkPassphrase: Networks.TESTNET })
    .addOperation(Operation.changeTrust({ asset: new Asset('USDC', USDC_TESTNET_ISSUER) }))
    .setTimeout(30)
    .build()
  tx.sign(keypair)
  await server.submitTransaction(tx)
  console.log(`  USDC trustline opened: ${keypair.publicKey()}`)
}

async function main(): Promise<void> {
  let env = loadEnvFile()

  let sellerSecret = getVar(env, 'SELLER_SECRET')
  let buyerSecret = getVar(env, 'BUYER_SECRET')
  if (!sellerSecret) {
    sellerSecret = Keypair.random().secret()
    env = setVar(env, 'SELLER_SECRET', sellerSecret)
    console.log('Generated a new testnet SELLER_SECRET (written to .env, not printed).')
  }
  if (!buyerSecret) {
    buyerSecret = Keypair.random().secret()
    env = setVar(env, 'BUYER_SECRET', buyerSecret)
    console.log('Generated a new testnet BUYER_SECRET (written to .env, not printed).')
  }
  const seller = Keypair.fromSecret(sellerSecret)
  const buyer = Keypair.fromSecret(buyerSecret)
  env = setVar(env, 'X402_SELLER_ADDRESS', seller.publicKey())
  writeFileSync(ENV_PATH, env)

  const server = new Horizon.Server(HORIZON_URL)
  console.log('\nFunding accounts (Friendbot)...')
  await fundIfNeeded(server, seller.publicKey())
  await fundIfNeeded(server, buyer.publicKey())

  console.log('\nOpening USDC trustlines...')
  await openTrustlineIfNeeded(server, seller)
  await openTrustlineIfNeeded(server, buyer)

  console.log('\nDone. Remaining manual steps:')
  console.log('  1. Get testnet USDC for the BUYER at https://faucet.circle.com (USDC, network: Stellar Testnet)')
  console.log(`     buyer address:  ${buyer.publicKey()}`)
  console.log('  2. Get a free facilitator key at https://channels.openzeppelin.com/testnet/gen')
  console.log('     and put it in .env as FACILITATOR_API_KEY')
  console.log(`  seller address:  ${seller.publicKey()}  (already in .env as X402_SELLER_ADDRESS)`)
  console.log('\nThen run: npm run testnet:proof')
}

main().catch((err) => {
  console.error(err)
  process.exitCode = 1
})
