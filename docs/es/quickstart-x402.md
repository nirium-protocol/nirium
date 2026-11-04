# Cobra a Agentes de IA en 5 Minutos con x402

Esta guía de inicio rápido muestra cómo configurar y llamar un endpoint pagado de Nirium desde un script TypeScript. El SDK maneja la negociación x402, la firma de entradas de autorización de Stellar y el reintento pagado después de que el endpoint devuelve `402 Payment Required`.

## Lo que Necesitas

- Node.js >=22.12.0 - `@stellar/stellar-sdk` 16.x (una dependencia de `nirium`) lo requiere; un Node más antiguo resuelve silenciosamente un SDK incompatible más antiguo en lugar de fallar.
- Un proyecto limpio donde puedas instalar `nirium`.

No uses una clave secreta de mainnet mientras pruebas este flujo.

## 1. Instalar Dependencias

```bash
mkdir nirium-x402-demo
cd nirium-x402-demo
npm init -y
npm install nirium @stellar/stellar-sdk@16 tsx typescript dotenv
```

## 2. Crear y Financiar una Clave Stellar

### Testnet (recomendado para pruebas)

Genera una nueva clave de testnet:

```bash
node -e "const {Keypair} = require('@stellar/stellar-sdk'); const kp = Keypair.random(); console.log('Secret:', kp.secret()); console.log('Public:', kp.publicKey());"
```

Guarda la clave secreta (comienza con `S...`) en tu archivo `.env`:

```bash
cat > .env <<'EOF'
STELLAR_SECRET_KEY=SXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
EOF
```

Financia la cuenta con XLM para fees de transacción:

```bash
curl "https://friendbot.stellar.org?addr=<TU_DIRECCION_G>"
```

### Agregar Trustline de USDC

Para recibir y enviar pagos en USDC, tu cuenta necesita una trustline al emisor de USDC.

**Testnet USDC** (Circle):
- Emisor: `GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5`

Crea `add-trustline.ts`:

```ts
import { Asset, Keypair, Networks, Operation, TransactionBuilder, Horizon } from '@stellar/stellar-sdk';
import 'dotenv/config';

const server = new Horizon.Server('https://horizon-testnet.stellar.org');
const keypair = Keypair.fromSecret(process.env.STELLAR_SECRET_KEY!);
const usdcIssuer = 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5';

async function addUsdcTrustline() {
  const account = await server.loadAccount(keypair.publicKey());
  const usdcAsset = new Asset('USDC', usdcIssuer);

  const transaction = new TransactionBuilder(account, {
    fee: '100000',
    networkPassphrase: Networks.TESTNET,
  })
    .addOperation(Operation.changeTrust({ asset: usdcAsset }))
    .setTimeout(180)
    .build();

  transaction.sign(keypair);
  const result = await server.submitTransaction(transaction);
  console.log('✓ Trustline agregada:', result.hash);
}

addUsdcTrustline().catch(console.error);
```

Ejecuta:

```bash
npx tsx add-trustline.ts
```

Solicita testnet USDC en el faucet de Circle: [https://faucet.circle.com](https://faucet.circle.com) (selecciona "USDC" y "Stellar Testnet").

### Pubnet (producción)

Para mainnet, sigue los mismos pasos pero:
- **No uses Friendbot** - financia la cuenta con XLM real
- **Emisor de USDC en pubnet**: `GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN` (Circle oficial)
- Usa `Networks.PUBLIC` y `https://horizon.stellar.org`
- Usa `network: 'stellar:pubnet'` en `initX402()`

## 3. Configurar el Cliente x402

Crea `charge-agent.ts`:

```ts
import { Agent } from "nirium";
import "dotenv/config";

const secretKey = process.env.STELLAR_SECRET_KEY;
if (!secretKey) {
  throw new Error("Set STELLAR_SECRET_KEY in .env before running this script.");
}

const agent = new Agent({
  baseUrl: "https://nirium-agent.fly.dev",
});

// Inicializa x402 con un spending guard
agent.initX402({
  secretKey,
  network: "stellar:testnet",
  maxAmountPerPayment: "$1",  // Límite por pago: rechaza cualquier pago >$1 antes de firmar
});

console.log("✓ Cliente x402 inicializado");
```

### ¿Qué es `maxAmountPerPayment`?

`maxAmountPerPayment` es un **guardia de gastos** que previene pagos inesperadamente altos. El SDK rechaza cualquier solicitud de pago por encima de este límite **antes** de que algo sea firmado o enviado.

- **Formato**: `"$5"`, `"5"` o `5` (monto USD)
- **Por defecto**: `"$1"` (aplicado por `@x402/core`)
- **Debe ser positivo**: `false` (sin límite) no es aceptado deliberadamente

Si un endpoint pide más que tu límite, obtendrás un `X402SpendCapError` con el monto solicitado y tu límite configurado.

## 4. Primera Llamada Pagada

Agrega la llamada pagada a `charge-agent.ts`:

```ts
// ...código anterior...

const premiumUrl = "https://nirium-agent.fly.dev/api/v1/premium/market";

async function fetchPaidMarket() {
  console.log(`Llamando a ${premiumUrl} (costo: $0.05 USDC)...`);
  
  const response = await agent.x402Fetch(premiumUrl);
  
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Paid request failed: ${response.status} ${text}`);
  }

  const payload = await response.json();
  console.log("✓ Respuesta pagada recibida:");
  console.log(JSON.stringify(payload, null, 2));
}

fetchPaidMarket().catch(console.error);
```

Ejecuta:

```bash
npx tsx charge-agent.ts
```

**Flujo x402:**
1. Primera solicitud → `402 Payment Required` (challenge)
2. `agent.x402Fetch()` firma la autorización de pago de Stellar automáticamente
3. Reintenta con la prueba de pago → `200 OK` con datos pagados

## 5. Verificar el Pago en Testnet

Después de una llamada exitosa:

1. Busca el hash de transacción en los logs o en la respuesta del facilitador
2. Abre `https://stellar.expert/explorer/testnet/tx/<TRANSACTION_HASH>`
3. Confirma:
   - Cuenta de origen: tu cuenta
   - Destino: endpoint del vendedor
   - Monto: $0.05 USDC para `/api/v1/premium/market`

## Errores Comunes

| Error | Causa | Solución |
| --- | --- | --- |
| `x402 client not initialized` | No llamaste a `initX402()` antes de `x402Fetch()` | Llama a `agent.initX402({ secretKey, network })` primero |
| `Set STELLAR_SECRET_KEY` | Falta la clave secreta en `.env` | Agrega `STELLAR_SECRET_KEY=S...` a tu archivo `.env` |
| `402 Payment Required` llega a tu código | Usaste `fetch()` en lugar de `x402Fetch()` | Usa `agent.x402Fetch()` para que el SDK maneje el pago automáticamente |
| `X402SpendCapError` | El endpoint pide más que tu `maxAmountPerPayment` | Aumenta el límite explícitamente: `initX402({ maxAmountPerPayment: "$5" })` |
| `Transaction cannot be found` | Usando mainnet en lugar de testnet, o pago rechazado | Verifica que estás en testnet y que la trustline/balance USDC están correctos |
| `HostError: Error(Contract, #13)` | Trustline de USDC faltante | Ejecuta `add-trustline.ts` primero, luego solicita USDC del faucet |
| Mainnet funds at risk | Estás probando con una clave de mainnet | **DETENTE** - cambia a `network: "stellar:testnet"` y usa una clave de testnet |

## Endpoints Disponibles

| Endpoint | Precio | Red |
| --- | --- | --- |
| `/api/v1/premium/signals` | $0.02 USDC | Testnet solamente |
| `/api/v1/premium/market` | $0.05 USDC | Testnet y pubnet |
| `/api/v1/premium/execute` | $0.25 USDC | Testnet solamente |

**Nota**: En mainnet, `/api/v1/premium/signals` devuelve `501` (no hay fuente de señales en mainnet); el agente de mainnet no tiene clave de firma por diseño.

## Python / LangChain

Los agentes de LangChain pueden pagar el mismo endpoint a través de `NiriumX402Tool`, que envuelve `init_x402` / `x402_fetch` y nunca expone la clave secreta de Stellar al modelo:

```bash
pip install 'nirium[langchain]'
```

Consulta [`examples/langchain-x402-agent`](../../examples/langchain-x402-agent) para un agente estilo ReAct ejecutable.

## Próximos Pasos

- Mueve la clave secreta a tu administrador de secretos normal antes de implementar en producción.
- Agrega registro de solicitudes para que cada respuesta pagada esté vinculada a su transacción de testnet.
- Crea una cuenta de testnet dedicada por entorno para simplificar la reconciliación.
- Para producción (pubnet), aumenta `maxAmountPerPayment` según tus necesidades reales y monitorea el gasto.

---

**🇬🇧 English version:** [quickstart-x402.md](../quickstart-x402.md)

*Esta guía fue escrita como parte de Niriumtober 2026. Issue: [nirium-protocol/nirium#174](https://github.com/nirium-protocol/nirium/issues/174)*
