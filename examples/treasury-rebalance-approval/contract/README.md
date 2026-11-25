# Modelo Rust del guardián de roles

`src/lib.rs` es una **especificación ejecutable host-side**, no el contrato
DeFindex desplegado ni un artefacto Soroban. Está aquí para que la regla
"RebalanceManager no puede retirar" se pueda comprobar con `cargo test` en
cualquier máquina, sin CLI, sin red y sin claves.

- `cargo test --manifest-path contract/Cargo.toml` — 8 pruebas, todas locales.
- No hay dependencias crates.io, no se genera WASM.
- En el entorno donde se escribió este PR había `rustc`/`cargo`, pero **no**
  `soroban` ni `stellar` CLI; por eso no se desplegó ni se verificó on-chain.
- El contrato real es DeFindex (terceros), audited por OtterSec; su
  `rebalance()` no acepta dirección de destino. Ver
  [`docs/FOR-REVIEWERS.md`](../../../docs/FOR-REVIEWERS.md) y el
  [README raíz](../../../README.md).
