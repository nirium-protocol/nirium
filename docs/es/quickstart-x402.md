# Cobra a Agentes de IA en 5 Minutos con x402

Esta guía de inicio rápido muestra cómo llamar un endpoint pagado de Nirium desde un script TypeScript. El SDK maneja la negociación x402, la firma de entradas de autorización de Stellar y el reintento pagado después de que el endpoint devuelve `402 Payment Required`.

## Lo que Necesitas

- Node.js >=22.12.0 - `@stellar/stellar-sdk` 16.x (una dependencia de `nirium`) lo requiere; un Node más antiguo resuelve silenciosamente un SDK incompatible más antiguo en lugar de fallar.
- Una clave secreta de testnet de Stellar con fondos. Usa solo una cuenta de testnet desechable.
- Un proyecto limpio donde puedas instalar `nirium`.

No uses una clave secreta de mainnet mientras pruebas este flujo.

## 1. Crear un Proyecto de Script

```bash
mkdir nirium-x402-demo
cd nirium-x402-demo
npm init -y
npm install nirium tsx typescript dotenv
```

Agrega un archivo de entorno local:

```bash
cat > .env <<'EOF'
STELLAR_SECRET_KEY=SXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
NIRIUM_PREMIUM_URL=https://nirium-agent.fly.dev/api/v1/premium/signals
EOF
```

Reemplaza `STELLAR_SECRET_KEY` con una clave secreta de testnet con fondos.

## 2. Agregar la Llamada Pagada

Crea `charge-agent.ts`:

```ts
import { Agent } from "nirium";
import "dotenv/config";

const secretKey = process.env.STELLAR_SECRET_KEY;
const premiumUrl =
  process.env.NIRIUM_PREMIUM_URL ??
  "https://nirium-agent.fly.dev/api/v1/premium/signals";

if (!secretKey) {
  throw new Error("Set STELLAR_SECRET_KEY in .env before running this script.");
}

const agent = new Agent({
  baseUrl: "https://nirium-agent.fly.dev",
});

agent.initX402({
  secretKey,
  network: "stellar:testnet",
});

const response = await agent.x402Fetch(premiumUrl);

if (!response.ok) {
  const text = await response.text();
  throw new Error(`Paid request failed: ${response.status} ${text}`);
}

const payload = await response.json();
console.log(JSON.stringify(payload, null, 2));
```

Ejecútalo con tu `.env` cargado:

```bash
npx tsx charge-agent.ts
```

La primera solicitud recibe un desafío `402 Payment Required`. `agent.x402Fetch()` firma la autorización de pago de Stellar, reintenta la solicitud y devuelve la respuesta pagada.

## 3. Verificar el Pago de Testnet

Después de una llamada exitosa, verifica la transacción en la testnet de Stellar:

1. Encuentra el hash de transacción o la referencia de pago devuelta por el endpoint o los registros del facilitador.
2. Abre `https://stellar.expert/explorer/testnet/tx/<TRANSACTION_HASH>`.
3. Confirma que la cuenta de origen coincida con tu cuenta de testnet.
4. Confirma que el destino y la cantidad coincidan con el precio del endpoint.
5. Guarda el enlace del explorador con tus notas de integración.

Si la respuesta no incluye un hash de transacción, verifica los registros del facilitador o del servidor para el registro de pago liquidado. La respuesta pagada aún debe probar que el flujo x402 se completó porque el endpoint solo devuelve datos protegidos después de la autorización de pago.

## 4. Cambiar el Precio o Endpoint

El vendedor controla los precios en el endpoint protegido. Para cobrar una cantidad diferente, actualiza los requisitos de pago x402 del lado del servidor para la ruta que expones a los agentes. Mantén estos valores del lado del cliente alineados con ese endpoint:

```bash
NIRIUM_PREMIUM_URL=https://your-api.example.com/paid/agent-signal
```

Luego vuelve a ejecutar:

```bash
npx tsx charge-agent.ts
```

## Solución de Problemas

| Problema | Solución |
| --- | --- |
| `x402 client not initialized` | Llama a `agent.initX402()` antes de `agent.x402Fetch()`. |
| `Set STELLAR_SECRET_KEY` | Agrega una clave secreta de testnet con fondos a `.env`. |
| `402 Payment Required` se devuelve a tu código | Usa `agent.x402Fetch()` en lugar de `fetch()` para que el SDK pueda firmar y reintentar el pago. |
| No se puede encontrar la transacción | Asegúrate de estar verificando la testnet de Stellar y que el pago no fue rechazado antes de la liquidación. |
| Fondos de mainnet en riesgo | Detente y vuelve a `network: "stellar:testnet"` con una cuenta de testnet. |

## Python / LangChain

Los agentes de LangChain pueden pagar el mismo endpoint a través de `NiriumX402Tool`, que envuelve `init_x402` / `x402_fetch` y nunca expone la clave secreta de Stellar al modelo:

```bash
pip install 'nirium[langchain]'
```

Consulta [`examples/langchain-x402-agent`](../../examples/langchain-x402-agent) para un agente estilo ReAct ejecutable.

## Próximos Pasos

- Mueve la clave secreta a tu administrador de secretos normal antes de implementar.
- Agrega registro de solicitudes para que cada respuesta pagada esté vinculada a su transacción de testnet.
- Crea una cuenta de testnet dedicada por entorno para simplificar la reconciliación.

---

**🇬🇧 English version:** [quickstart-x402.md](../quickstart-x402.md)

*Esta guía fue traducida como parte de Niriumtober 2026. Issue: [nirium-protocol/nirium#174](https://github.com/nirium-protocol/nirium/issues/174)*
