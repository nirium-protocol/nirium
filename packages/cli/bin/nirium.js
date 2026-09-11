#!/usr/bin/env node

// ═══════════════════════════════════════════════════════════════
// Nirium — Autonomous Agent CLI (v1.1.3)
// ═══════════════════════════════════════════════════════════════
//
// Everything below is one flat file on purpose, not a build artifact:
// "files" in package.json ships only bin/ + README.md, so any command
// implemented in a separate compiled module never reaches npm unless
// dist/ is added to that list too. Inlining avoids depending on a build
// step existing at publish time at all.

import { Command } from 'commander';
import fs from 'fs';
import path from 'path';
import os from 'os';
import crypto from 'crypto';
import { execSync } from 'child_process';
import express from 'express';
import NiriumAgent, { x402Serve } from 'nirium';
import { Keypair, StrKey } from '@stellar/stellar-sdk';

const program = new Command();

program
    .name('nirium')
    .description('Nirium protocol development tool')
    .version('1.1.3');

// --- COMMAND: create bot ---
program
    .command('create')
    .argument('<type>', 'What to create: x402 (a server that charges) or bot (a signal listener)')
    .option('-n, --name <name>', 'Name of the project', 'nirium-bot-v1')
    .option('-t, --template <template>', 'Language template (ts, py) — bot only', 'ts')
    .description('Scaffold a new Nirium project')
    .action(async (type, options) => {
        if (type !== 'bot' && type !== 'x402') {
            console.error('❌ Error: type must be "x402" (charge for your API) or "bot" (listen to signals).');
            process.exit(1);
        }

        const targetDir = path.join(process.cwd(), options.name);

        if (fs.existsSync(targetDir)) {
            console.error(`❌ Error: Directory ${options.name} already exists.`);
            process.exit(1);
        }

        console.log(type === 'x402'
            ? `\n💸 [Scaffold] Creating x402 paid API: ${options.name}...`
            : `\n🧬 [Scaffold] Creating ${options.template === 'ts' ? 'TypeScript' : 'Python'} bot: ${options.name}...`);

        fs.mkdirSync(targetDir, { recursive: true });

        if (type === 'x402') {
            scaffoldX402(targetDir, options.name);
        } else if (options.template === 'ts') {
            scaffoldTS(targetDir, options.name);
        } else {
            scaffoldPY(targetDir, options.name);
        }

        console.log(`\n✅ Project initialized in ./${options.name}`);
        console.log(`\n🚀 Get started:`);
        console.log(`   cd ${options.name}`);
        if (options.template === 'ts') {
            console.log(`   npm install`);
            console.log(`   npm run dev`);
        } else {
            console.log(`   python -m venv venv`);
            console.log(`   source venv/bin/activate`);
            console.log(`   pip install -r requirements.txt`);
            console.log(`   python main.py`);
        }
    });

// --- COMMAND: status ---
program
    .command('status')
    .description('Check agent connection status')
    .option('-u, --url <url>', 'Agent URL', 'http://localhost:3001')
    .action(async (options) => {
        try {
            const response = await fetch(`${options.url}/health`);
            if (response.ok) {
                const data = await response.json();
                console.log('🟢 Agent is operational');
                console.log(`   Version: ${data.version}`);
                console.log(`   Network: ${data.network}`);
                console.log(`   Uptime:  ${data.uptime}s`);
            } else {
                console.log('🔴 Agent returned error:', response.status);
            }
        } catch {
            console.log('🔴 Agent unreachable at', options.url);
        }
    });

// --- COMMAND: verify ---
program
    .command('verify')
    .argument('<cid>', 'IPFS Content Identifier (CID) of the audit document')
    .option('-g, --gateway <url>', 'IPFS gateway URL', 'https://gateway.pinata.cloud')
    .option('--json', 'Output result as JSON')
    .description('Independently verify IPFS audit document content hash & agent ed25519 signature')
    .action(async (cid, options) => {
        const result = await fetchAndVerifyCid(cid, options.gateway);
        if (options.json) {
            console.log(JSON.stringify(result, null, 2));
        } else {
            console.log(formatVerifyOutput(result));
        }
        if (!result.ok) {
            process.exit(1);
        }
    });

// --- COMMAND: doctor ---
program
    .command('doctor')
    .description('CLI preflight diagnostics for x402/MPP misconfiguration')
    .option('-n, --network <network>', 'Stellar network: testnet or pubnet', 'testnet')
    .option('-c, --config <path>', 'Path to environment or config file')
    .option('--json', 'Output results as JSON for CI integration')
    .action(async (options) => {
        const report = await runDoctorDiagnostics(options);
        if (options.json) {
            console.log(JSON.stringify(report, null, 2));
        } else {
            console.log(formatDoctorOutput(report));
        }
        if (!report.ok) {
            process.exit(1);
        }
    });

// --- COMMAND: pay ---
program
    .command('pay')
    .description('💳 Pay an x402-protected endpoint straight from the terminal with Stellar auth entry signing')
    .argument('<url>', 'URL of the x402-protected endpoint')
    .option('-a, --amount <amount>', 'Payment amount override')
    .option('-n, --network <network>', 'CAIP-2 network ID (stellar:testnet or stellar:pubnet)', 'stellar:testnet')
    .option('-s, --secret <secret>', 'Stellar secret key (S...) for signing')
    .option('-c, --config <path>', 'Custom path to configuration file or .env')
    .option('--json', 'Output execution result as JSON')
    .action(async (url, options) => {
        await executePayCommand(url, options);
    });

// --- COMMAND: serve ---
program
    .command('serve')
    .description('🚀 Spin up a local x402-protected demo HTTP server to test payments against')
    .option('-p, --price <price>', 'Price for access (e.g. $0.02)', '$0.02')
    .option('-P, --pay-to <address>', 'Stellar public key (G...) to receive payments')
    .option('-port, --port <port>', 'Port number to listen on', '3000')
    .option('-n, --network <network>', 'CAIP-2 network ID (stellar:testnet or stellar:pubnet)', 'stellar:testnet')
    .option('-r, --route <route>', 'Route path to protect', '/api/v1/data')
    .option('-k, --api-key <key>', 'Facilitator API key')
    .option('-c, --config <path>', 'Custom path to config file')
    .action(async (options) => {
        await executeServeCommand(options);
    });

// --- COMMAND: config ---
program
    .command('config')
    .description('⚙️ Manage local CLI configuration store (~/.niriumrc.json)')
    .argument('[action]', 'Action to perform: set, get, list, or delete', 'list')
    .argument('[key]', 'Configuration key name')
    .argument('[value]', 'Value to set for the configuration key')
    .action(async (action, key, value) => {
        executeConfigCommand(action, key, value);
    });

// Un servidor que COBRA, no uno que escucha. Es el camino corto de
// "instalé algo" a "me pagaron": levantas esto, le pegas con un cliente
// x402 y el pago se liquida on-chain antes de que salga la respuesta.
function scaffoldX402(dir, name) {
    const pkgJson = {
        name,
        version: '0.1.0',
        private: true,
        type: 'module',
        scripts: { dev: 'tsx watch src/server.ts', build: 'tsc' },
        dependencies: {
            nirium: '^0.14.0',
            express: '^5.1.0',
            '@x402/express': '^2.17.0',
            '@x402/core': '^2.17.0',
            '@x402/stellar': '^2.17.0',
            tsx: '^4.19.0',
            typescript: '^5.7.0',
            dotenv: '^16.4.5',
        },
        devDependencies: { '@types/node': '^20.19.0', '@types/express': '^5.0.0' },
    };
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify(pkgJson, null, 2));

    fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'src', 'server.ts'), `
import express from 'express';
import { x402Serve } from 'nirium';
import 'dotenv/config';

const app = express();

// Todo lo que va debajo de /premium cobra antes de responder.
// El pago se liquida on-chain: si no pagaron, tu handler nunca corre.
app.use('/premium', x402Serve({
  payTo: process.env.STELLAR_PAY_TO!,            // tu cuenta G...
  facilitatorApiKey: process.env.X402_FACILITATOR_API_KEY!,
  network: (process.env.STELLAR_NETWORK === 'mainnet' ? 'stellar:pubnet' : 'stellar:testnet'),
  routes: {
    'GET /signals': '$0.02',
  },
}));

app.get('/premium/signals', (_req, res) => {
  res.json({ signals: [{ pair: 'USDC/CETES', edge: '0.42%' }] });
});

app.listen(3000, () => console.log('💸 cobrando en http://localhost:3000/premium/signals'));
`.trimStart());

    fs.writeFileSync(path.join(dir, '.env'),
        'STELLAR_PAY_TO=\n'
        + '# Llave GRATIS y POR RED — una de mainnet da 401 contra testnet:\n'
        + '#   testnet  https://channels.openzeppelin.com/testnet/gen\n'
        + '#   mainnet  https://channels.openzeppelin.com/gen\n'
        + 'X402_FACILITATOR_API_KEY=\n'
        + 'STELLAR_NETWORK=testnet\n');

    fs.writeFileSync(path.join(dir, 'tsconfig.json'), JSON.stringify({
        compilerOptions: {
            target: 'ES2022', module: 'ESNext', moduleResolution: 'bundler',
            strict: true, esModuleInterop: true, skipLibCheck: true, outDir: 'dist',
        },
        include: ['src'],
    }, null, 2));
}

function scaffoldTS(dir, name) {
    const pkgJson = {
        name,
        version: '0.1.0',
        private: true,
        scripts: {
            "dev": "tsx watch src/index.ts",
            "build": "tsc"
        },
        dependencies: {
            "nirium": "^0.14.0",
            "tsx": "^4.19.0",
            "typescript": "^5.7.0",
            "dotenv": "^16.4.5"
        },
        devDependencies: {
            "@types/node": "^20.19.0"
        }
    };

    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify(pkgJson, null, 2));
    fs.mkdirSync(path.join(dir, 'src'));

    const indexSrc = `
import { Agent } from 'nirium';
import 'dotenv/config';

const agent = new Agent({
  baseUrl: process.env.NIRIUM_API_URL || 'https://nirium-agent.fly.dev',
  apiKey: process.env.NIRIUM_API_KEY
});

agent.subscribe((signal) => {
  console.log('🧬 [Signal Received]:', signal.signal_type, signal.pair);
  // Logic to execute on signals...
});

console.log('✅ Listening for Nirium signals...');
`;
    fs.writeFileSync(path.join(dir, 'src', 'index.ts'), indexSrc);
    fs.writeFileSync(path.join(dir, '.env'), 'NIRIUM_API_URL=https://nirium-agent.fly.dev\nNIRIUM_API_KEY=');
    fs.writeFileSync(path.join(dir, 'tsconfig.json'), JSON.stringify({
        compilerOptions: {
            target: "es2022",
            module: "nodenext",
            strict: true,
            esModuleInterop: true,
            skipLibCheck: true
        }
    }, null, 2));
}

function scaffoldPY(dir, name) {
    const reqs = "nirium>=0.9.0\npython-dotenv>=1.0.0";
    fs.writeFileSync(path.join(dir, 'requirements.txt'), reqs);

    const mainSrc = `
import asyncio
import os
from nirium import Agent
from dotenv import load_dotenv

load_dotenv()

async def main():
    agent = Agent(
        api_url=os.getenv("NIRIUM_API_URL", "https://nirium-agent.fly.dev"),
        api_key=os.getenv("NIRIUM_API_KEY")
    )

    @agent.on("signal")
    async def handle_signal(signal):
        print(f"🧬 [Signal]: {signal['signal_type']} on {signal['pair']}")

    @agent.on("connected")
    async def on_connect(data):
        print("✅ Connected to Nirium Neural Loop")

    await agent.subscribe()

if __name__ == "__main__":
    asyncio.run(main())
`;
    fs.writeFileSync(path.join(dir, 'main.py'), mainSrc);
    fs.writeFileSync(path.join(dir, '.env'), 'NIRIUM_API_URL=https://nirium-agent.fly.dev\nNIRIUM_API_KEY=');
}

// ═══════════════════════════════════════════════════════════════
// config — ~/.niriumrc.json store, shared by pay/serve/config
// ═══════════════════════════════════════════════════════════════

const CONFIG_FILE = path.join(os.homedir(), '.niriumrc.json');

function loadConfig(customPath) {
    const filePath = customPath || CONFIG_FILE;
    try {
        if (fs.existsSync(filePath)) {
            const raw = fs.readFileSync(filePath, 'utf8');
            return JSON.parse(raw);
        }
    } catch {
        // Ignore read errors gracefully
    }
    return {};
}

function saveConfig(config, customPath) {
    const filePath = customPath || CONFIG_FILE;
    try {
        fs.writeFileSync(filePath, JSON.stringify(config, null, 2), {
            encoding: 'utf8',
            mode: 0o600,
        });
        // Enforce permissions even on pre-existing files (writeFileSync mode
        // only applies when the file is created, not when it already exists).
        try {
            fs.chmodSync(filePath, 0o600);
        } catch {
            // best effort on platforms without POSIX permissions (e.g. some Windows setups)
        }
    } catch (err) {
        throw new Error(`Failed to save config to ${filePath}: ${err?.message || String(err)}`);
    }
}

function maskSecret(secret) {
    if (!secret) return '(not set)';
    if (secret.length <= 8) return 'S****';
    return `${secret.slice(0, 4)}...${secret.slice(-4)}`;
}

function executeConfigCommand(action, key, value) {
    const currentConfig = loadConfig();

    if (!action || action === 'list') {
        console.log('⚙️ Nirium CLI Configuration:');
        console.log(`   secretKey:          ${maskSecret(currentConfig.secretKey)}`);
        console.log(`   payTo:              ${currentConfig.payTo || '(not set)'}`);
        console.log(`   network:            ${currentConfig.network || '(default: stellar:testnet)'}`);
        console.log(`   facilitatorApiKey:  ${maskSecret(currentConfig.facilitatorApiKey)}`);
        return;
    }

    if (action === 'get') {
        if (!key) {
            console.error('❌ Error: Please specify a configuration key (e.g. `nirium config get secretKey`)');
            process.exit(1);
        }
        const val = currentConfig[key];
        if (key.toLowerCase().includes('secret') || key.toLowerCase().includes('key')) {
            console.log(`${key}: ${maskSecret(val)}`);
        } else {
            console.log(`${key}: ${val || '(not set)'}`);
        }
        return;
    }

    if (action === 'set') {
        if (!key || value === undefined) {
            console.error('❌ Error: Usage: `nirium config set <key> <value>` (e.g., `nirium config set secretKey S...`)');
            process.exit(1);
        }
        const updatedConfig = { ...currentConfig, [key]: value };
        saveConfig(updatedConfig);
        console.log(`✅ Configuration updated: ${key} set successfully.`);
        return;
    }

    if (action === 'delete' || action === 'remove') {
        if (!key) {
            console.error('❌ Error: Please specify a configuration key to delete.');
            process.exit(1);
        }
        delete currentConfig[key];
        saveConfig(currentConfig);
        console.log(`✅ Removed ${key} from configuration.`);
        return;
    }

    console.error(`❌ Unknown config action: ${action}. Use set, get, list, or delete.`);
    process.exit(1);
}

// ═══════════════════════════════════════════════════════════════
// pay — sign and settle an x402 payment from the terminal
// ═══════════════════════════════════════════════════════════════

async function executePayCommand(url, options) {
    const config = loadConfig(options.config);
    const secretKey = options.secret || process.env.NIRIUM_SECRET_KEY || config.secretKey;
    const network = options.network || process.env.NIRIUM_NETWORK || config.network || 'stellar:testnet';

    if (!secretKey) {
        const errorMsg = 'Missing secret key for x402 payment authorization.\n'
            + 'Please provide a secret key using:\n'
            + '  - `--secret S...` option\n'
            + '  - `NIRIUM_SECRET_KEY` environment variable\n'
            + '  - `nirium config set secretKey S...`';
        if (options.json) {
            console.log(JSON.stringify({ status: 'error', error: errorMsg }));
            process.exit(1);
        }
        console.error(`❌ Error: ${errorMsg}`);
        process.exit(1);
    }

    let publicKey = '';
    try {
        const kp = Keypair.fromSecret(secretKey);
        publicKey = kp.publicKey();
    } catch (err) {
        const invalidMsg = `Invalid Stellar secret key format: ${err?.message || 'must start with S'}`;
        if (options.json) {
            console.log(JSON.stringify({ status: 'error', error: invalidMsg }));
            process.exit(1);
        }
        console.error(`❌ Error: ${invalidMsg}`);
        process.exit(1);
    }

    if (!options.json) {
        console.log(`⚡ Initiating x402 Payment Request`);
        console.log(`   Target URL: ${url}`);
        console.log(`   Network:    ${network}`);
        console.log(`   Payer Key:  ${publicKey}`);
        console.log(`   Secret:     ${maskSecret(secretKey)}\n`);
    }

    try {
        const agent = new NiriumAgent({ apiKey: 'nirium-cli-pay' });
        agent.initX402({ secretKey, network });

        const startTime = Date.now();
        const response = await agent.x402Fetch(url, {
            method: 'GET',
            headers: { 'User-Agent': 'Nirium-CLI-Pay/1.0' },
        });
        const durationMs = Date.now() - startTime;

        const responseHeaders = Object.fromEntries(response.headers.entries());
        const paymentResponseHeader = response.headers.get('payment-response')
            || response.headers.get('x-payment-response')
            || response.headers.get('payment-tx-hash')
            || '';

        let txHash = '';
        let paymentMeta = null;
        if (paymentResponseHeader) {
            try {
                if (paymentResponseHeader.startsWith('{')) {
                    const parsed = JSON.parse(paymentResponseHeader);
                    txHash = parsed.txHash || parsed.transactionHash || parsed.hash || '';
                    paymentMeta = parsed;
                } else {
                    txHash = paymentResponseHeader;
                }
            } catch {
                txHash = paymentResponseHeader;
            }
        }

        let responseBody;
        const contentType = response.headers.get('content-type') || '';
        if (contentType.includes('application/json')) {
            responseBody = await response.json();
        } else {
            responseBody = await response.text();
        }

        if (options.json) {
            console.log(JSON.stringify({
                status: response.ok ? 'success' : 'failed',
                statusCode: response.status,
                durationMs,
                payer: publicKey,
                network,
                txHash: txHash || undefined,
                paymentMeta: paymentMeta || undefined,
                headers: responseHeaders,
                data: responseBody,
            }, null, 2));
            return;
        }

        console.log(`✅ Payment Negotiated & Request Completed (${response.status} ${response.statusText})`);
        console.log(`   Response Time: ${durationMs}ms`);
        if (txHash) {
            console.log(`   Tx Reference:  ${txHash}`);
            console.log(`   Explorer:      https://stellar.expert/explorer/${network.includes('testnet') ? 'testnet' : 'public'}/tx/${txHash}`);
        }
        console.log(`\n--- Response Payload ---`);
        console.log(typeof responseBody === 'object' ? JSON.stringify(responseBody, null, 2) : responseBody);
    } catch (err) {
        const errorDetail = err?.message || String(err);
        if (options.json) {
            console.log(JSON.stringify({ status: 'error', error: errorDetail, payer: publicKey, network }));
            process.exit(1);
        }
        console.error(`❌ Payment Failed: ${errorDetail}`);
        process.exit(1);
    }
}

// ═══════════════════════════════════════════════════════════════
// serve — local x402-protected demo server
// ═══════════════════════════════════════════════════════════════

async function executeServeCommand(options) {
    const config = loadConfig(options.config);
    const payTo = options.payTo || process.env.NIRIUM_PAY_TO || config.payTo;
    const price = options.price || '$0.02';
    const port = Number(options.port || process.env.PORT || 3000);
    const network = options.network || process.env.NIRIUM_NETWORK || config.network || 'stellar:testnet';
    const routePath = options.route || '/api/v1/data';
    const facilitatorApiKey = options.apiKey || process.env.FACILITATOR_API_KEY || config.facilitatorApiKey;

    if (!facilitatorApiKey) {
        console.error('❌ Error: Missing facilitator API key.');
        console.error('Get a free key at https://channels.openzeppelin.com/testnet/gen (testnet)');
        console.error('or https://channels.openzeppelin.com/gen (mainnet), then pass it via');
        console.error('--api-key, FACILITATOR_API_KEY, or `nirium config set facilitatorApiKey ...`');
        process.exit(1);
    }
    if (!payTo) {
        console.error('❌ Error: Missing `--pay-to` Stellar address (G...).');
        console.error('Please specify a recipient address using `--pay-to G...` or setting `payTo` in config.');
        process.exit(1);
    }

    const app = express();
    app.use(express.json());

    const middleware = x402Serve({
        payTo,
        network,
        facilitatorApiKey,
        routes: {
            [`GET ${routePath}`]: { price, description: 'Nirium CLI x402 Demo Endpoint' },
        },
    });
    app.use(middleware);

    app.get(routePath, (req, res) => {
        res.json({
            status: 'success',
            message: 'x402 Payment Verified! Access Granted.',
            endpoint: routePath,
            price,
            paidTo: payTo,
            timestamp: new Date().toISOString(),
            sampleData: { signal: 'CETES_REBALANCE_OPPORTUNITY', yieldApy: '5.57%', network },
        });
    });

    return new Promise((resolve, reject) => {
        const server = app.listen(port, () => {
            console.log(`\n🚀 Nirium x402 Demo Server Listening on http://localhost:${port}`);
            console.log(`   Protected Route: http://localhost:${port}${routePath}`);
            console.log(`   Price:           ${price}`);
            console.log(`   Pay To:          ${payTo}`);
            console.log(`   Network:         ${network}\n`);
            console.log(`💡 Test this server using:`);
            console.log(`   nirium pay http://localhost:${port}${routePath} --secret S...\n`);
            resolve({ app, server });
        });
        server.on('error', (err) => {
            console.error(`❌ Server startup failed: ${err.message}`);
            reject(err);
        });
    });
}

// ═══════════════════════════════════════════════════════════════
// doctor — x402/MPP preflight diagnostics
// ═══════════════════════════════════════════════════════════════

function loadEnvFile(filePath) {
    const env = {};
    const targetPath = filePath ? path.resolve(process.cwd(), filePath) : path.resolve(process.cwd(), '.env');
    if (fs.existsSync(targetPath)) {
        try {
            const content = fs.readFileSync(targetPath, 'utf8');
            for (const line of content.split('\n')) {
                const trimmed = line.trim();
                if (!trimmed || trimmed.startsWith('#')) continue;
                const eqIdx = trimmed.indexOf('=');
                if (eqIdx !== -1) {
                    const key = trimmed.slice(0, eqIdx).trim();
                    let val = trimmed.slice(eqIdx + 1).trim();
                    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
                        val = val.slice(1, -1);
                    }
                    env[key] = val;
                }
            }
        } catch {
            // Ignore file read errors
        }
    }
    return env;
}

function normalizeNetwork(inputNet) {
    const net = (inputNet || '').toLowerCase();
    if (net === 'pubnet' || net === 'mainnet' || net === 'stellar:pubnet' || net === 'stellar:mainnet') {
        return 'stellar:pubnet';
    }
    return 'stellar:testnet';
}

async function runDoctorDiagnostics(options) {
    const fileEnv = loadEnvFile(options.config);
    const getEnv = (key) => process.env[key] || fileEnv[key] || '';

    const rawNetwork = options.network || getEnv('STELLAR_NETWORK') || getEnv('NETWORK') || 'testnet';
    const canonicalNetwork = normalizeNetwork(rawNetwork);
    const isTestnet = canonicalNetwork === 'stellar:testnet';
    const checks = [];

    // Check 1: payTo address
    const payTo = getEnv('STELLAR_PAY_TO') || getEnv('PAY_TO') || getEnv('NIRIUM_X402_PAY_TO') || getEnv('STELLAR_PAYTO');
    if (!payTo) {
        checks.push({
            name: 'payTo', status: 'fail', message: 'payTo address is missing',
            fix: 'Set STELLAR_PAY_TO in .env to a valid Stellar public key starting with G...',
        });
    } else if (payTo.startsWith('S')) {
        checks.push({
            name: 'payTo', status: 'fail', message: 'payTo address is a secret key (S...), not a public key',
            fix: 'Replace STELLAR_PAY_TO with your public key (G...). Secret keys must never be exposed as payTo.',
            detail: `Value starts with '${payTo.slice(0, 4)}...'`,
        });
    } else if (!/^G[A-Z2-7]{55}$/.test(payTo)) {
        checks.push({
            name: 'payTo', status: 'fail', message: 'payTo address is invalid (must be a 56-character Stellar G... address)',
            fix: 'Ensure STELLAR_PAY_TO is a valid 56-char Stellar public key.',
            detail: `Length: ${payTo.length}`,
        });
    } else {
        checks.push({
            name: 'payTo', status: 'pass',
            message: `payTo address is a valid Stellar public key (${payTo.slice(0, 4)}...${payTo.slice(-4)})`,
            detail: payTo,
        });
    }

    // Check 2: Facilitator API key & reachability
    const facilitatorApiKey = getEnv('X402_FACILITATOR_API_KEY') || getEnv('STELLAR_FACILITATOR_API_KEY') || getEnv('FACILITATOR_API_KEY');
    const defaultFacilitatorUrl = isTestnet ? 'https://channels.openzeppelin.com/x402/testnet' : 'https://channels.openzeppelin.com/x402';
    const facilitatorUrl = getEnv('FACILITATOR_URL') || getEnv('X402_FACILITATOR_URL') || defaultFacilitatorUrl;
    const customFetch = options.fetchFn || globalThis.fetch;

    if (!facilitatorApiKey && !getEnv('FACILITATOR_URL')) {
        const genUrl = isTestnet ? 'https://channels.openzeppelin.com/testnet/gen' : 'https://channels.openzeppelin.com/gen';
        checks.push({
            name: 'facilitator', status: 'fail',
            message: 'facilitatorApiKey is missing — OpenZeppelin Channels facilitator rejects unauthenticated requests',
            fix: `Get a free ${rawNetwork} key at ${genUrl} and set X402_FACILITATOR_API_KEY in .env`,
        });
    } else {
        try {
            const headers = {};
            if (facilitatorApiKey) headers['Authorization'] = `Bearer ${facilitatorApiKey}`;
            const response = await customFetch(`${facilitatorUrl}/supported`, { headers, signal: AbortSignal.timeout(5000) });
            if (response.ok) {
                checks.push({
                    name: 'facilitator', status: 'pass',
                    message: `Facilitator reachable and API key authenticated on ${rawNetwork}`,
                    detail: facilitatorUrl,
                });
            } else if (response.status === 401 || response.status === 403) {
                const genUrl = isTestnet ? 'https://channels.openzeppelin.com/testnet/gen' : 'https://channels.openzeppelin.com/gen';
                checks.push({
                    name: 'facilitator', status: 'fail',
                    message: `Facilitator rejected API key (HTTP ${response.status})`,
                    fix: `Verify X402_FACILITATOR_API_KEY is valid for ${rawNetwork}. Keys are per-network: get one at ${genUrl}`,
                    detail: `Status ${response.status} from ${facilitatorUrl}`,
                });
            } else {
                checks.push({
                    name: 'facilitator', status: 'fail', message: `Facilitator returned HTTP ${response.status}`,
                    fix: `Check facilitator service status at ${facilitatorUrl}`,
                });
            }
        } catch (err) {
            checks.push({
                name: 'facilitator', status: 'fail', message: `Facilitator endpoint unreachable at ${facilitatorUrl}`,
                fix: 'Check network connectivity or custom FACILITATOR_URL setting.',
                detail: err?.message || String(err),
            });
        }
    }

    // Check 3: Network & RPC consistency
    const defaultRpcUrl = isTestnet ? 'https://soroban-testnet.stellar.org' : 'https://soroban-rpc.mainnet.stellar.gateway.fm';
    const rpcUrl = getEnv('STELLAR_RPC_URL') || getEnv('RPC_URL') || defaultRpcUrl;
    const expectedPassphrase = isTestnet ? 'Test SDF Network ; July 2015' : 'Public Global Stellar Network ; September 2015';
    try {
        const rpcRes = await customFetch(rpcUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getHealth' }),
            signal: AbortSignal.timeout(5000),
        });
        if (rpcRes.ok) {
            checks.push({
                name: 'network', status: 'pass', message: `Soroban RPC endpoint operational for ${canonicalNetwork}`,
                detail: `${rpcUrl} (Passphrase: "${expectedPassphrase}")`,
            });
        } else {
            checks.push({
                name: 'network', status: 'fail', message: `Soroban RPC endpoint returned HTTP ${rpcRes.status}`,
                fix: `Verify STELLAR_RPC_URL for network ${canonicalNetwork}`,
            });
        }
    } catch (err) {
        checks.push({
            name: 'network', status: 'fail', message: `Soroban RPC endpoint unreachable at ${rpcUrl}`,
            fix: `Check network connection or set a working STELLAR_RPC_URL for ${canonicalNetwork}`,
            detail: err?.message || String(err),
        });
    }

    // Check 4: Secret Key check (if configured)
    const secretKey = getEnv('STELLAR_SECRET_KEY') || getEnv('SECRET_KEY') || getEnv('NIRIUM_SECRET_KEY');
    if (secretKey) {
        if (!/^S[A-Z2-7]{55}$/.test(secretKey)) {
            checks.push({
                name: 'secretKey', status: 'fail', message: 'Secret key format is invalid (must be a 56-character Stellar S... key)',
                fix: 'Ensure STELLAR_SECRET_KEY is a valid Stellar secret key starting with S...',
            });
        } else {
            checks.push({ name: 'secretKey', status: 'pass', message: 'Secret key format is valid (S...)' });
        }
    }

    // Check 5: MPP Configuration (if configured)
    const mppMode = getEnv('MPP_MODE');
    const mppSecret = getEnv('MPP_SECRET_KEY');
    if (mppMode || mppSecret) {
        if (mppMode && mppMode !== 'pull' && mppMode !== 'push') {
            checks.push({
                name: 'mpp', status: 'fail', message: `Invalid MPP_MODE: "${mppMode}" (must be "pull" or "push")`,
                fix: 'Set MPP_MODE=pull or MPP_MODE=push in .env',
            });
        } else if (mppSecret && !/^S[A-Z2-7]{55}$/.test(mppSecret)) {
            checks.push({
                name: 'mpp', status: 'fail', message: 'Invalid MPP_SECRET_KEY format (must be a 56-character S... key)',
                fix: 'Check MPP_SECRET_KEY in .env',
            });
        } else {
            checks.push({ name: 'mpp', status: 'pass', message: `MPP protocol configuration valid (mode: ${mppMode || 'pull'})` });
        }
    }

    const ok = checks.every((c) => c.status === 'pass');
    return { ok, network: canonicalNetwork, checks, timestamp: new Date().toISOString() };
}

function formatDoctorOutput(report) {
    const lines = [];
    lines.push(`🩺 Nirium Doctor — x402/MPP Diagnostic Report`);
    lines.push(`Target Network: ${report.network}`);
    lines.push(`Timestamp:      ${report.timestamp}`);
    lines.push(`--------------------------------------------------`);
    for (const check of report.checks) {
        const symbol = check.status === 'pass' ? '✔' : '❌';
        lines.push(`${symbol} [${check.name.toUpperCase()}] ${check.message}`);
        if (check.detail && check.status === 'pass') lines.push(`   Detail: ${check.detail}`);
        if (check.fix) lines.push(`   💡 Fix: ${check.fix}`);
    }
    lines.push(`--------------------------------------------------`);
    lines.push(report.ok ? `✅ All checks passed!` : `❌ Diagnostic failed. See fix suggestions above.`);
    return lines.join('\n');
}

// ═══════════════════════════════════════════════════════════════
// verify — independently check an audit CID's hash + agent signature
// ═══════════════════════════════════════════════════════════════

function decodeStellarPublicKey(gAddress) {
    if (!/^G[A-Z2-7]{55}$/.test(gAddress)) {
        throw new Error(`Invalid Stellar public key format: ${gAddress}`);
    }
    return Buffer.from(StrKey.decodeEd25519PublicKey(gAddress));
}

function verifyEd25519Signature(pubKeyGAddress, statement, base64Signature) {
    try {
        const rawPubKey = decodeStellarPublicKey(pubKeyGAddress);
        const spkiHeader = Buffer.from('302a300506032b6570032100', 'hex');
        const keyObject = crypto.createPublicKey({
            key: Buffer.concat([spkiHeader, rawPubKey]),
            format: 'der',
            type: 'spki',
        });
        const signatureBuf = Buffer.from(base64Signature, 'base64');
        return crypto.verify(null, Buffer.from(statement), keyObject, signatureBuf);
    } catch {
        return false;
    }
}

function verifyAuditDocument(doc, cid) {
    if (!doc || typeof doc !== 'object') {
        return { ok: false, cid, hashMatch: false, expectedHash: '', computedHash: '', signatureStatus: 'absent', error: 'Invalid audit document format' };
    }
    const expectedHash = doc.content_sha256 || '';
    const recordStr = doc.record ? JSON.stringify(doc.record) : '';
    const computedHash = crypto.createHash('sha256').update(recordStr).digest('hex');
    const hashMatch = expectedHash.length > 0 && expectedHash === computedHash;

    let signatureStatus = 'absent';
    let signerKey, statement, declaredStatement, agentId;
    if (doc.agent && doc.agent.key && doc.agent.signature) {
        signerKey = doc.agent.key;
        agentId = doc.agent.id;
        // Always recompute — never trust the document's own statement field.
        // The protocol signs `nirium-audit-v1:<content_sha256>`, derived
        // exclusively from the record hash. Trusting doc.agent.statement
        // would let an attacker reuse a valid signature after swapping the
        // record content.
        statement = `nirium-audit-v1:${computedHash}`;
        declaredStatement = doc.agent.statement;
        signatureStatus = verifyEd25519Signature(signerKey, statement, doc.agent.signature) ? 'valid' : 'invalid';
    }

    const ok = hashMatch && signatureStatus !== 'invalid';
    return { ok, cid, hashMatch, expectedHash, computedHash, signatureStatus, signerKey, statement, declaredStatement, agentId };
}

async function fetchAndVerifyCid(cid, gatewayUrl = 'https://gateway.pinata.cloud', fetchFn = globalThis.fetch) {
    const url = `${gatewayUrl.replace(/\/$/, '')}/ipfs/${cid}`;
    try {
        const res = await fetchFn(url);
        if (!res.ok) {
            return { ok: false, cid, hashMatch: false, expectedHash: '', computedHash: '', signatureStatus: 'absent', error: `IPFS gateway returned HTTP ${res.status}` };
        }
        const doc = await res.json();
        return verifyAuditDocument(doc, cid);
    } catch (err) {
        return { ok: false, cid, hashMatch: false, expectedHash: '', computedHash: '', signatureStatus: 'absent', error: `Failed to fetch CID from gateway: ${err?.message || String(err)}` };
    }
}

function formatVerifyOutput(result) {
    const lines = [];
    lines.push(`🔍 Nirium Audit Verifier`);
    if (result.cid) lines.push(`CID:            ${result.cid}`);
    lines.push(`--------------------------------------------------`);
    lines.push(result.hashMatch
        ? `✔ HASH:        MATCH (${result.computedHash.slice(0, 16)}...)`
        : `❌ HASH:        MISMATCH (Expected: ${result.expectedHash}, Computed: ${result.computedHash})`);
    if (result.signatureStatus === 'valid') {
        lines.push(`✔ SIGNATURE:   VALID (Signed by ${result.signerKey})`);
        if (result.statement) lines.push(`   Statement:  ${result.statement}`);
        if (result.agentId) lines.push(`   Agent ID:   ${result.agentId}`);
    } else if (result.signatureStatus === 'invalid') {
        lines.push(`❌ SIGNATURE:   INVALID (Signature check failed for key ${result.signerKey})`);
    } else {
        lines.push(`ℹ SIGNATURE:   ABSENT (No agent attestation embedded)`);
    }
    lines.push(`--------------------------------------------------`);
    if (result.error) {
        lines.push(`❌ ERROR:       ${result.error}`);
    } else {
        lines.push(result.ok ? `✅ VERIFICATION PASSED` : `❌ VERIFICATION FAILED`);
    }
    return lines.join('\n');
}

program.parse();
