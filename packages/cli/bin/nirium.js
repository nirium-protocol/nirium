#!/usr/bin/env node

// ═══════════════════════════════════════════════════════════════
// Nirium — Autonomous Agent CLI (v1.0.2)
// ═══════════════════════════════════════════════════════════════

import { Command } from 'commander';
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

const program = new Command();

program
    .name('nirium')
    .description('Nirium protocol development tool')
    .version('1.0.2');

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

// --- COMMAND: verify ---
program
    .command('verify')
    .argument('<cid>', 'IPFS Content Identifier (CID) of the audit document')
    .option('-g, --gateway <url>', 'IPFS gateway URL', 'https://gateway.pinata.cloud')
    .option('--json', 'Output result as JSON')
    .description('Independently verify IPFS audit document content hash & agent ed25519 signature')
    .action(async (cid, options) => {
        const { fetchAndVerifyCid, formatVerifyOutput } = await import('../dist/verify.js');
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
        const { runDoctorDiagnostics, formatDoctorOutput } = await import('../dist/doctor.js');
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
        const { executePayCommand } = await import('../dist/pay.js');
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
        const { executeServeCommand } = await import('../dist/serve.js');
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
        const { executeConfigCommand } = await import('../dist/config.js');
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

program.parse();
