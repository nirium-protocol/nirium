# Treasury rebalance con aprobación humana (Stellar testnet)

Example de extremo a extremo para `nirium-protocol/nirium#358`: el **owner**
configura una **manager key** dedicada al rebalance, un agente propone el
rebalance con esa key, un humano aprueba **`y/N`** en la terminal y solo
después se firma y se envía la transacción. El mismo example demuestra, con un
test negativo, que esa manager key **no puede retirar ni transferir fondos**
fuera del vault.

Todo ocurre en `stellar:testnet`. Mainnet, scheduling, yield/APY y receipts
están fuera de alcance.

## Roles y permisos

| Rol | Quién lo tiene | Puede | No puede |
|---|---|---|---|
| `owner` / Manager del vault | clave del dueño del vault (`OWNER_SECRET_KEY`) | cambiar el `RebalanceManager`, rebalancear, retirar **sus propias** acciones | — |
| `RebalanceManager` | clave delegada (`MANAGER_SECRET_KEY`) | proponer y firmar `rebalance()` | retirar, transferir hacia otra dirección, cambiar roles |
| `Agent` de Nirium | cliente HTTP | construir XDR sin firmar y broadcast de XDR ya firmado | firmar; nunca recibe una clave `S...` |

`rebalance()` solo acepta instrucciones `Invest`/`Unwind` sobre estrategias del
mismo vault y **no acepta dirección de destino**: un retiro no es solo una
operación denegada, es una operación **inexpresible** en ese rol. Ver
[`docs/FOR-REVIEWERS.md`](../../docs/FOR-REVIEWERS.md) y el
[README raíz](../../README.md).

## Flujo en una sola ventana

```
owner firma set_treasury_rebalance_manager
  → submit_treasury_tx                      (hash #1)
manager key propone rebalance (XDR sin firma)
  → humano escribe y / N
  → si y: manager firma localmente → submit_treasury_tx   (hash #2)
  → si N: 0 firmas nuevas, 0 envíos nuevos
gate local: manager key denegada para withdraw y transfer antes de firmar
```

## Demo offline (un comando, sin red ni claves)

```bash
cd examples/treasury-rebalance-approval
python main.py --demo
python main.py --demo --decline    # misma corrida con NO
```

Salida real del PR (`exit 0` en ambos casos; acortada):

```
Demo offline: sin red, sin claves, sin transacciones reales.
Propuesta de rebalance (testnet)
  vault: CVAULT-DEMO
  instructions: 1
    - Invest 1000000 en CSTRATEGY-DEMO
Resumen del flujo (testnet):
  - owner firmó y envió set_treasury_rebalance_manager
  - manager key propuso el rebalance (XDR aún sin firmar)
  - humano aprobó: manager firmó y envió el rebalance
  - manager key denegada para withdraw y transfer antes de firmar
  hashes:
    set_rebalance_manager: PENDING | N/A (hash PENDING: no hubo envío real en esta ejecución)
    rebalance: PENDING | N/A (hash PENDING: no hubo envío real en esta ejecución)
  negado withdraw: GMANAGER-DEMO-... is not authorized for withdraw (firmado=False, enviado=False)
  negado transfer: GMANAGER-DEMO-... is not authorized for transfer (firmado=False, enviado=False)
  aprobado=True ejecutado=True
OK: flujo completo; rebalance firmado y enviado solo tras aprobación.
Hashes de testnet: PENDING / N/A (demo no emite transacciones).
```

Con `--decline`: `aprobado=False ejecutado=False`, la manager key tiene **0**
firmas y el único `submit` es el de configuración del owner.

## Ejecución real en testnet (la hace el usuario con sus claves)

```bash
cd examples/treasury-rebalance-approval
pip install -r requirements.txt
cp .env.example .env
# rellenar OWNER_SECRET_KEY, MANAGER_SECRET_KEY y VAULT_ID con datos testnet propios
python main.py        # imprime el resumen y pregunta y/N antes de firmar el rebalance
```

Variables principales:

| Variable | Required | Default |
|---|---|---|
| `OWNER_SECRET_KEY` | sí | — (`S...` de testnet) |
| `MANAGER_SECRET_KEY` | sí | — (`S...` de testnet, delegado) |
| `VAULT_ID` | sí | — (vault DeFindex en testnet) |
| `ENTER_AT` / `EXIT_AT` | no | `1.0` / `2.0` (mandato humano) |
| `MIN_IDLE_STROOPS` | no | sin mínimo |
| `NIRIUM_API_KEY` | no | token demo público con la G-address del owner |
| `NIRIUM_BASE_URL` | no | `https://nirium-agent.fly.dev` |
| `NETWORK_PASSPHRASE` | no | `Test SDF Network ; September 2015` (otro valor falla) |

Cualquier passphrase que no sea la de testnet se rechaza **antes de firmar**.

### Hashes de transacciones (Stellar Expert, testnet)

| Paso | Hash | Stellar Expert |
|---|---|---|
| `set_treasury_rebalance_manager` (owner) | `PENDING` | `N/A` — no ejecutado en este PR |
| `rebalance` (manager, tras aprobación) | `PENDING` | `N/A` — no ejecutado en este PR |
| intento de retiro con manager key | `N/A` (rechazado antes de firmar) | `N/A` |

No se han inventado hashes: este PR se escribió sin claves, sin fondos y sin
acceso a testnet, así que no hay transacciones reales que enlazar. El script
imprime los hashes reales y sus links al final de cada corrida; pégalos aquí
cuando lo ejecutes con tu propio vault testnet.

## Test negativo: la manager key no puede sacar fondos

Prueba local (sin red, sin firmar, sin enviar), incluida en la suite:

```bash
python -m pytest -v \
  test/test_flow.py::test_manager_withdraw_denied_before_any_network_call_or_signature \
  test/test_flow.py::test_declining_approval_signs_and_submits_nothing_for_rebalance
# 2 passed in 0.36s, exit 0
```

Salida del demo que se puede pegar en la revisión:

```
negado withdraw: GMANAGER-DEMO-... is not authorized for withdraw (firmado=False, enviado=False)
negado transfer: GMANAGER-DEMO-... is not authorized for transfer (firmado=False, enviado=False)
```

`deny_operation()` se ejecuta **antes** de construir el XDR de retiro, por lo
que el agente no recibe ninguna llamada y la manager key no produce ninguna
firma. En paralelo, `contract/src/lib.rs` modela la misma regla y `cargo test`
la verifica en 8 tests host-side.

### Intento en testnet (no ejecutado en este PR)

```bash
python main.py --negative-testnet
# gate local; 0 firmas, 0 envíos. exit 0

python main.py --negative-testnet --i-understand-testnet-only
# SOLO con tus claves testnet: construye un withdraw de las acciones del owner,
# lo firma con la manager key y espera el rechazo del contrato.
# Salida esperada: "RECHAZADO como se esperaba: ..." (exit 0).
# Si el envío se acepta (exit 2), no uses ese vault: revisa los roles on-chain.
```

El modo `negative-testnet` sin el flag explícito no firma ni envía nada. Sin
credenciales falla cerrado, p. ej. en este PR:

```
Error: OWNER_SECRET_KEY no está configurada (usa .env local).
exit 1
```

## Declinar no firma ni envía

El segundo test del comando anterior es el de declinación.

El test comprueba que después de `declined()` la manager key tiene
`signed_xdrs == []`, que solo hubo un `submit_treasury_tx` (el del owner, paso
1) y que la secuencia de eventos del agente es
`[set_treasury_rebalance_manager, submit_treasury_tx, propose_treasury_rebalance]`.
El `ask_human_approval()` de `main.py` usa la misma decisión en la corrida real.

## Secretos

- Las claves se leen de `.env` (gitignored) y solo se usan en `StellarSigner`
  para firmar en esta máquina.
- `Agent` recibe el token HTTP, nunca una clave `S...`.
- `SecretRing` sustituye secretos conocidos y cualquier patrón `S...` en
  mensajes de error; los tests cubren logs, stdout/stderr y todos los cuerpos
  HTTP (los `submit` contienen **solo** `{"xdr": ...}`).
- `.env.example` contiene placeholders, no secretos reales.

## Tests y evidencia real de este PR

Comandos ejecutados en
`C:\Users\User\AppData\Local\Temp\opencode\v21\nirium\examples\treasury-rebalance-approval`:

| Comando | Resultado | Exit |
|---|---|---|
| `.venv-nirium\Scripts\python.exe -m pytest -q` | `23 passed in 4.91s` | `0` |
| `python -m pytest -v test/test_flow.py::test_manager_withdraw... test/test_flow.py::test_declining...` | `2 passed in 0.36s` | `0` |
| `cargo test --manifest-path contract/Cargo.toml` | `8 passed; 0 failed` | `0` |
| `python main.py --demo` | flujo completo, hashes `PENDING` | `0` |
| `python main.py --demo --decline` | 0 firmas manager, 0 envíos del rebalance | `0` |
| `python main.py --negative-testnet` sin credenciales | falla cerrado, sin firma | `1` |

### Herramientas

```
rustc --version       -> rustc 1.100.0 (0ef1bc386 2026-11-09)   exit 0
cargo --version       -> cargo 1.100.0 (3acc79c0c 2026-11-05)   exit 0
where soroban         -> no encontrado                            exit 1
where stellar         -> no encontrado                            exit 1
python --version      -> Python 3.13.17                           exit 0
```

No hay CLI `soroban`/`stellar`, así que **no** se compiló a WASM, **no** se
desplegó ningún contrato y **no** se ejecutó ninguna transacción testnet. El
modelo Rust se verifica solo con `cargo test` (host); no se declara PASS
on-chain. Los contratos reales viven fuera de este repo (ver
[`CONTRIBUTING.md`](../../CONTRIBUTING.md)).

## Layout

```
main.py                  CLI: --demo / --demo --decline / live / --negative-testnet
src/roles.py             política owner vs RebalanceManager (fail-closed)
src/approval.py          y/N; todo lo que no sea SÍ explícito es NO
src/flow.py              configurar → proponer → aprobar → ejecutar → denegar
src/sign.py              firma local; rechaza passphrase de mainnet
src/redaction.py         secretos nunca en logs, excepciones ni bodies
src/fake_agent.py        agente en memoria para demo/tests (sin red)
test/                    23 tests: roles, aprobación, flujo, secretos, request bodies
contract/src/lib.rs      modelo Rust host-side del gate de roles (8 tests)
```

SDK usado: `Agent.set_treasury_rebalance_manager`, `propose_treasury_rebalance`,
`build_treasury_rebalance`, `submit_treasury_tx` y `withdraw_from_treasury_vault`
del `packages/sdk-python` de este repo.
