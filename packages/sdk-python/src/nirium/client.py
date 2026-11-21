# ═══════════════════════════════════════════════════════════════
# Nirium Python SDK — Official Client: x402 (MPP experimental)
# Versión: solo en pyproject.toml / setup.py / __init__.__version__ (no aquí:
# un número en un comentario se desincroniza y ya mintió antes).
# Synced with backend API (real Horizon data, Soroban execution)
# ═══════════════════════════════════════════════════════════════
import asyncio
import collections
import hashlib
import json
import logging
import random
import aiohttp  # type: ignore
import websockets  # type: ignore
import inspect
import time
from decimal import Decimal, InvalidOperation
from typing import Awaitable, Callable, Dict, Any, List, Optional, Union, NoReturn
from stellar_sdk import Keypair, Network, Server, TransactionBuilder, Asset  # type: ignore
from stellar_sdk import Account, Address, SorobanServer, scval  # type: ignore
from stellar_sdk.xdr import SorobanTransactionData  # type: ignore
from stellar_sdk.auth import authorize_entry  # type: ignore
import stellar_sdk.xdr as stellar_xdr  # type: ignore
import base64 as _b64
import math as _math

# Cuenta nula: la transacción de pago es una plantilla y el facilitador la
# re-emite con su propia cuenta y secuencia al pagar el fee de red.
_X402_NULL_ACCOUNT = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF"

logger = logging.getLogger("nirium.client")


# USDC (Circle) Stellar Asset Contract per network: the only asset the default
# per-payment cap knows how to price. Derived from USDC:GBBD47IF...LLFLA5
# (testnet) and USDC:GA5ZSEJY...KZVN (mainnet, home domain circle.com).
_X402_USDC_SAC = {
    "stellar:testnet": "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA",
    "stellar:pubnet": "CCW67TSZV3SSS2HXMBQ5JFGCKJNXKZM7UQUWUZPUTHXSTZLEO7SJMI75",
}
_X402_USDC_DECIMALS = 7
_X402_DEFAULT_MAX_AMOUNT = "$1"
_X402_NETWORKS = ("stellar:testnet", "stellar:pubnet")
# Same aliases the LangChain tool accepts, mapped to the CAIP-2 ids the 402
# challenge uses, so the network check compares like with like.
_X402_NETWORK_ALIASES = {
    "testnet": "stellar:testnet",
    "stellar:testnet": "stellar:testnet",
    "mainnet": "stellar:pubnet",
    "pubnet": "stellar:pubnet",
    "public": "stellar:pubnet",
    "stellar:pubnet": "stellar:pubnet",
    "stellar:public": "stellar:pubnet",
    "stellar:mainnet": "stellar:pubnet",
}

X402Approver = Callable[[Dict[str, Any]], Union[bool, Awaitable[bool]]]


class X402NetworkMismatchError(RuntimeError):
    """The 402 challenge offered no payment option on the configured network.

    Raised before anything is built or signed.
    """

    code = "X402_NETWORK_MISMATCH"
    signer_called = False

    def __init__(self, url: str, network: str, offered: List[str]):
        self.url = url
        self.network = network
        self.offered = offered
        super().__init__(
            f"x402_fetch refused to pay {url}: the client is configured for {network} "
            f"but the server only offered {', '.join(offered) or 'no network'}. "
            "Nothing was signed or sent."
        )


class X402SpendCapError(RuntimeError):
    """The payment is above the per-payment cap, or in an asset the cap cannot
    price, and no ``approve`` callback accepted it. Raised before signing."""

    code = "X402_SPEND_CAP_EXCEEDED"
    signer_called = False

    def __init__(self, url: str, requirement: Dict[str, Any], cap: str, reason: str):
        self.url = url
        self.amount = requirement.get("amount")
        self.asset = requirement.get("asset")
        self.network = requirement.get("network")
        self.pay_to = requirement.get("payTo")
        self.cap = cap
        self.reason = reason
        super().__init__(
            f"x402_fetch refused to pay {url}: {reason} The per-payment cap is {cap}. "
            "Nothing was signed or sent. Raise it with init_x402(max_amount_per_payment=...) "
            "or pass approve=... to decide case by case."
        )


class X402PolicyError(RuntimeError):
    """Raised when an x402 payment is refused by the pre-sign policy hook.

    Raised before signing, so no signature was released.
    """

    code = "X402_POLICY_REFUSED"
    signer_called = False

    def __init__(
        self,
        outcome: str,
        message: str,
        decision: Optional[Any] = None,
        context_hash: Optional[str] = None,
    ):
        self.outcome = outcome
        self.message = message
        self.decision = decision
        self.context_hash = context_hash
        super().__init__(f"x402 policy {outcome}: {message}")


class X402PolicyDecision:
    """Normalized policy decision returned by or parsed from the policy hook."""

    def __init__(
        self,
        decision: str,
        context_hash: Optional[str] = None,
        reason: Optional[str] = None,
        policy_version: Optional[str] = None,
        expires_at: Optional[float] = None,
        decision_id: Optional[str] = None,
    ):
        self.decision = decision.upper().strip()
        self.context_hash = context_hash
        self.contextHash = context_hash
        self.reason = reason
        self.policy_version = policy_version
        self.policyVersion = policy_version
        self.expires_at = expires_at
        self.expiresAt = expires_at
        self.decision_id = decision_id
        self.decisionId = decision_id

    def __repr__(self) -> str:
        return (
            f"X402PolicyDecision(decision={self.decision!r}, "
            f"contextHash={self.contextHash!r}, "
            f"policyVersion={self.policyVersion!r}, "
            f"expiresAt={self.expiresAt!r}, "
            f"reason={self.reason!r})"
        )


class X402PolicyContext(dict):
    """Context object passed to the policy evaluation callback."""

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        if "payTo" in self and "payee" not in self:
            self["payee"] = self["payTo"]
        if "payee" in self and "payTo" not in self:
            self["payTo"] = self["payee"]
        if "url" in self and "resource" not in self:
            self["resource"] = self["url"]
        if "resource" in self and "url" not in self:
            self["url"] = self["resource"]
        if "contextHash" in self and "context_hash" not in self:
            self["context_hash"] = self["contextHash"]
        if "context_hash" in self and "contextHash" not in self:
            self["contextHash"] = self["context_hash"]
        if "contextVersion" in self and "context_version" not in self:
            self["context_version"] = self["contextVersion"]
        if "context_version" in self and "contextVersion" not in self:
            self["contextVersion"] = self["context_version"]

    def __getattr__(self, name: str) -> Any:
        if name in self:
            return self[name]
        alternatives = {
            "context_version": "contextVersion",
            "contextVersion": "context_version",
            "context_hash": "contextHash",
            "contextHash": "context_hash",
            "pay_to": "payTo",
            "payTo": "pay_to",
            "payee": "payTo",
            "resource": "url",
            "url": "resource",
        }
        if name in alternatives and alternatives[name] in self:
            return self[alternatives[name]]
        raise AttributeError(f"'X402PolicyContext' object has no attribute {name!r}")

    def __setattr__(self, name: str, value: Any) -> None:
        self[name] = value


def _sha256_hex(val: Union[str, bytes]) -> str:
    if isinstance(val, str):
        val = val.encode("utf-8")
    return hashlib.sha256(val).hexdigest()


def _parse_decision(val: Any) -> Optional[X402PolicyDecision]:
    if val is None:
        return None
    if isinstance(val, str):
        v = val.upper().strip()
        return X402PolicyDecision(decision=v)
    if isinstance(val, dict):
        d = val.get("decision")
        if not d or not isinstance(d, str):
            return None
        return X402PolicyDecision(
            decision=d,
            context_hash=val.get("contextHash") or val.get("context_hash"),
            reason=val.get("reason"),
            policy_version=val.get("policyVersion") or val.get("policy_version"),
            expires_at=val.get("expiresAt") or val.get("expires_at"),
            decision_id=val.get("decisionId") or val.get("decision_id"),
        )
    if hasattr(val, "decision") and isinstance(val.decision, str):
        return X402PolicyDecision(
            decision=val.decision,
            context_hash=getattr(val, "contextHash", getattr(val, "context_hash", None)),
            reason=getattr(val, "reason", None),
            policy_version=getattr(val, "policyVersion", getattr(val, "policy_version", None)),
            expires_at=getattr(val, "expiresAt", getattr(val, "expires_at", None)),
            decision_id=getattr(val, "decisionId", getattr(val, "decision_id", None)),
        )
    return None


def _parse_usd_cap(value: Any) -> Decimal:
    """'$5', '5', 5 or 0.5 -> Decimal. Must be a positive amount."""
    if isinstance(value, bool) or value is None:
        raise ValueError("max_amount_per_payment must be a positive USD amount, e.g. '$1'")
    raw = str(value).strip().lstrip("$").strip()
    try:
        cap = Decimal(raw)
    except InvalidOperation:
        raise ValueError(f"max_amount_per_payment is not a USD amount: {value!r}") from None
    if not cap.is_finite() or cap <= 0:
        raise ValueError("max_amount_per_payment must be a positive USD amount, e.g. '$1'")
    return cap


class WebSocketMaxRetriesExceeded(Exception):
    """Raised when consecutive WebSocket reconnection retries exceed the configured limit."""
    pass


class WebSocketStatus:
    CONNECTING = "connecting"
    CONNECTED = "connected"
    RECONNECTING = "reconnecting"
    DISCONNECTED = "disconnected"
    CLOSED = "closed"


class Agent:
    """
    Nirium Agent — Full API + WebSocket client for the Nirium autonomous agent.

    Usage:
        agent = Agent(api_url="http://localhost:3002", api_key="nrm_your_key")
        market = await agent.get_market()
        print(f"XLM Price: ${market['xlmPrice']:.4f}")
    """

    def __init__(self, api_url: str = "http://localhost:3002", api_key: Optional[str] = None, token: Optional[str] = None):
        self.api_url = api_url.rstrip('/')
        self.ws_url = self.api_url.replace("http", "ws") + "/ws/signals"
        self.api_key = api_key
        self.token = token

        api_key_local = self.api_key
        token_local = self.token

        self.headers: Dict[str, str] = {"Content-Type": "application/json"}
        if api_key_local is not None:
            self.headers["x-api-key"] = api_key_local
        elif token_local is not None:
            self.headers["Authorization"] = f"Bearer {token_local}"

        self.callbacks: Dict[str, List[Callable]] = {
            "signal": [],
            "log": [],
            "connected": [],
            "status": [],
            "error": [],
        }
        self._active_ws: Optional[Any] = None
        self._ws_running: bool = False
        self._ws_close_requested: bool = False
        self._close_event: asyncio.Event = asyncio.Event()
        self.last_x402_settlement: Optional[Dict[str, Any]] = None

    # ─── Decorators ────────────────────────────────────────────

    def on(self, event_type: str):
        """Decorator to register event callbacks."""
        def decorator(func: Callable):
            if event_type not in self.callbacks:
                self.callbacks[event_type] = []
            self.callbacks[event_type].append(func)
            return func
        return decorator

    async def _emit(self, event_type: str, data: Any):
        for callback in self.callbacks.get(event_type, []):
            if asyncio.iscoroutinefunction(callback):
                await callback(data)
            else:
                callback(data)

    # ─── HTTP Helpers ─────────────────────────────────────────

    async def _get(
        self,
        path: str,
        extra_headers: Optional[Dict[str, str]] = None,
        params: Optional[Dict[str, Any]] = None,
    ) -> Any:
        headers = {**self.headers, **(extra_headers or {})}
        query = {k: str(v) for k, v in (params or {}).items() if v is not None}
        async with aiohttp.ClientSession(headers=headers) as session:
            async with session.get(f"{self.api_url}{path}", params=query or None) as resp:
                resp.raise_for_status()
                return await resp.json()

    async def _post(self, path: str, payload: Optional[Dict[str, Any]] = None, extra_headers: Optional[Dict[str, str]] = None) -> Any:
        headers = {**self.headers, **(extra_headers or {})}
        async with aiohttp.ClientSession(headers=headers) as session:
            async with session.post(f"{self.api_url}{path}", json=payload or {}) as resp:
                resp.raise_for_status()
                return await resp.json()

    async def _delete(self, path: str) -> Any:
        async with aiohttp.ClientSession(headers=self.headers) as session:
            async with session.delete(f"{self.api_url}{path}") as resp:
                resp.raise_for_status()
                return await resp.json()

    # ─── Health ───────────────────────────────────────────────

    async def ping(self) -> bool:
        """Check if the agent is reachable."""
        try:
            data = await self._get("/health")
            return data.get("status") in ("operational", "online")
        except Exception:
            return False

    async def health(self) -> Dict[str, Any]:
        """Get detailed health info."""
        return await self._get("/health")

    async def system_health(self) -> Dict[str, Any]:
        """Get full system health (Horizon, Soroban, WebSocket, IPFS, LLM)."""
        return await self._get("/api/system/health")

    # ─── Market Data ─────────────────────────────────────────

    async def get_tickers(self) -> Dict[str, Any]:
        """Get asset price tickers (XLM, USDC) from Stellar Horizon."""
        return await self._get("/api/tickers")

    async def get_market(self) -> Dict[str, Any]:
        """Fetch real market state from Horizon (XLM price, SDEX spread, fees, paths)."""
        return await self._get("/api/market")

    async def get_stats(self) -> Dict[str, Any]:
        """Get global protocol statistics."""
        return await self._get("/api/stats/global")

    async def get_loop_status(self) -> Dict[str, Any]:
        """Get autonomous loop status."""
        return await self._get("/api/loop/status")

    async def start_loop(self, config: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        """Start the autonomous scanning loop."""
        return await self._post("/api/loop/start", {"config": config or {}})

    async def stop_loop(self) -> Dict[str, Any]:
        """Stop the autonomous scanning loop."""
        return await self._post("/api/loop/stop")

    async def trigger_scan(self) -> Dict[str, Any]:
        """Trigger a manual market scan."""
        return await self._post("/api/loop/scan")

    # ─── Execution ───────────────────────────────────────────

    async def execute(
        self,
        strategy: str,
        asset: str,
        params: Optional[Dict[str, Any]] = None,
        stellar_account: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Execute a strategy via real Soroban contract transaction on Stellar.

        Strategies: flash-loan-arb, path-arbitrage, cross-dex, blend-yield, soroswap-swap

        Args:
            strategy: Strategy name (maps to a NiriumVault contract function)
            asset: Base asset symbol (e.g. 'XLM')
            params: Optional dict — supports 'amount' in stroops (default 1000)
            stellar_account: Your Stellar wallet address. Required for legal consent verification.
        """
        extra: Dict[str, str] = {}
        if stellar_account:
            extra["x-stellar-account"] = stellar_account
        payload: Dict[str, Any] = {"strategy": strategy, "asset": asset}
        if params:
            payload.update(params)
        return await self._post("/api/execute", payload, extra_headers=extra)

    async def execute_demo(self, strategy: str, asset: str) -> Dict[str, Any]:
        """Execute a strategy in demo mode (Soroban dry-run, no TX submitted).

        Returns a professional market assessment message.
        Response keys: success, simulated_profit, gas_consumed, message
        """
        return await self._post("/api/execute-demo", {
            "strategy": strategy,
            "asset": asset,
        })

    # ─── Signals ─────────────────────────────────────────────

    async def get_recent_signals(self, count: int = 20) -> Any:
        """Get recent market signals."""
        return await self._get(f"/api/signals/recent?count={count}")

    async def create_subscription(self, filters: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        """Create a signal subscription with optional filters."""
        return await self._post("/api/subscriptions", {"filters": filters or {}})

    async def get_subscriptions(self) -> Dict[str, Any]:
        """List all active subscriptions for the current user."""
        return await self._get("/api/subscriptions")

    async def delete_subscription(self, subscription_id: str) -> Dict[str, Any]:
        """Delete a subscription by ID."""
        return await self._delete(f"/api/subscriptions/{subscription_id}")

    async def get_subscription_stats(self) -> Dict[str, Any]:
        """Get subscription stats (total, connected clients, recent signals)."""
        return await self._get("/api/subscriptions/stats")

    async def get_strategies(self) -> Dict[str, Any]:
        """List available strategies from loaded skills."""
        return await self._get("/api/strategies")

    # ─── Skills ──────────────────────────────────────────────

    async def get_skills(self) -> Any:
        """List all loaded skills (built-in + user-installed)."""
        return await self._get("/api/skills")

    async def install_skill(self, source: str) -> Dict[str, Any]:
        """Install a skill by slug."""
        return await self._post("/api/skills/install", {"source": source})

    async def uninstall_skill(self, slug: str) -> Dict[str, Any]:
        """Uninstall a user-installed skill by slug."""
        return await self._delete(f"/api/skills/{slug}")

    async def get_skill_marketplace(self) -> Dict[str, Any]:
        """List skills available in the marketplace."""
        return await self._get("/api/skills/marketplace")

    async def execute_skill_action(
        self,
        slug: str,
        action: str,
        params: Optional[Dict[str, Any]] = None,
        context: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        """Execute a custom action on an installed skill."""
        return await self._post(f"/api/skills/{slug}/actions/{action}", {"params": params or {}, "context": context or {}})

    # ─── Auth Management ─────────────────────────────────────

    async def get_auth_token(self, wallet_address: str) -> Dict[str, Any]:
        """Get a JWT token for a Stellar wallet address."""
        return await self._post("/api/auth/token", {"walletAddress": wallet_address})

    async def create_auth_key(self, name: str, tier: Optional[str] = None) -> Dict[str, Any]:
        """Create a new API key. Requires auth."""
        payload: Dict[str, Any] = {"name": name}
        if tier:
            payload["tier"] = tier
        return await self._post("/api/auth/keys", payload)

    async def get_auth_keys(self) -> Dict[str, Any]:
        """List API keys for the current user. Requires auth."""
        return await self._get("/api/auth/keys")

    async def revoke_auth_key(self, key_id: str) -> Dict[str, Any]:
        """Revoke an API key by ID. Requires auth."""
        return await self._delete(f"/api/auth/keys/{key_id}")

    # ─── Revenue & Info ──────────────────────────────────────

    async def get_revenue(self) -> Dict[str, Any]:
        """Get x402/MPP revenue stats and payment feed."""
        return await self._get("/api/revenue")

    async def get_info(self) -> Dict[str, Any]:
        """Get protocol info (endpoints, LLM provider, version)."""
        return await self._get("/api/info")

    # ─── Execution Nodes ─────────────────────────────────────

    async def get_nodes(self) -> Dict[str, Any]:
        """List execution nodes with live status, custody model and network."""
        return await self._get("/api/nodes")

    # ─── Payouts / Disbursements ─────────────────────────────
    #
    # Non-custodial by construction: the node builds an unsigned XDR, you sign
    # it with your own wallet and broadcast it via submit_payout. Nirium never
    # holds funds and never sees your keys.
    #
    # Licensed for independent service payments only (contractors, freelancers,
    # B2B) — never for subordinate-employee salary. See get_payout_terms().

    async def create_payout_run(
        self,
        recipients: List[Dict[str, Any]],
        acknowledge_terms: bool,
        asset: Optional[str] = None,
        memo: Optional[str] = None,
        run_id: Optional[str] = None,
        treasury: Optional[str] = None,
        client_info: Optional[Dict[str, str]] = None,
    ) -> Dict[str, Any]:
        """Build a batch payout (up to 100 recipients) and get back an unsigned XDR.

        ``acknowledge_terms`` must be True on every network — the node replies 403
        without it. On mainnet the node is invite-only (institutional tier) and
        additionally requires ``client_info`` with legalName, taxId and repName.
        """
        payload: Dict[str, Any] = {
            "recipients": recipients,
            "acknowledgeTerms": acknowledge_terms,
        }
        for key, value in (
            ("asset", asset), ("memo", memo), ("runId", run_id),
            ("treasury", treasury), ("clientInfo", client_info),
        ):
            if value is not None:
                payload[key] = value
        return await self._post("/api/payroll/run", payload)

    async def submit_payout(self, run_id: str, signed_xdr: str) -> Dict[str, Any]:
        """Broadcast the payout XDR after signing it with your own wallet."""
        return await self._post("/api/payroll/submit", {"runId": run_id, "signedXdr": signed_xdr})

    async def onboard_payout_recipient(
        self,
        employee: str,
        asset: Optional[str] = None,
        sponsor: Optional[str] = None,
        limit: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Build a self-signed USDC trustline so a new recipient can receive payouts."""
        payload: Dict[str, Any] = {"employee": employee}
        for key, value in (("asset", asset), ("sponsor", sponsor), ("limit", limit)):
            if value is not None:
                payload[key] = value
        return await self._post("/api/payroll/onboard", payload)

    async def submit_payout_onboard(self, signed_xdr: str) -> Dict[str, Any]:
        """Broadcast the signed trustline XDR from onboard_payout_recipient."""
        return await self._post("/api/payroll/onboard/submit", {"signedXdr": signed_xdr})

    async def get_payout_runs(self) -> Dict[str, Any]:
        """Public payout history for the current network: amount, asset, recipient count and tx hash.

        It does not include run ids or IPFS receipt CIDs; your own run's CID comes back
        from submit_payout()."""
        return await self._get("/api/payroll/runs")

    async def get_payout_terms(self) -> Dict[str, Any]:
        """Payouts Terms v1.0 — the text ``acknowledge_terms`` accepts."""
        return await self._get("/api/payroll/terms")

    async def get_payout_info(self) -> Dict[str, Any]:
        """Payouts node metadata: pricing tiers, mainnet access, legal notice."""
        return await self._get("/api/payroll/info")

    # ─── Audit Trail ─────────────────────────────────────────

    async def anchor_audit_record(
        self,
        hash: Optional[str] = None,
        record: Optional[Dict[str, Any]] = None,
        tx_hash: Optional[str] = None,
        network: Optional[str] = None,
        tag: Optional[str] = None,
        agent: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        """Anchor evidence to IPFS and get back a CID.

        This is an integrity seal, not notarization and not legal proof of content.
        Anchor a ``hash`` of your data rather than the data itself: IPFS content
        cannot be deleted, so raw personal data would outlive any erasure request.

        Pass ``agent`` as ``{"key": "G...", "signature": "<base64>", "id": "..."}``
        to attest *who* produced the evidence: sign the exact string
        ``nirium-audit-v1:<content_sha256>`` with that ed25519 key. An invalid
        signature is rejected with 400 and nothing is anchored.
        """
        if hash is None and record is None:
            raise ValueError("provide `hash` (sha-256 of your evidence) or `record` (JSON object)")
        payload: Dict[str, Any] = {}
        for key, value in (
            ("hash", hash), ("record", record), ("txHash", tx_hash),
            ("network", network), ("tag", tag), ("agent", agent),
        ):
            if value is not None:
                payload[key] = value
        return await self._post("/api/audit/log", payload)

    async def get_audit_info(self) -> Dict[str, Any]:
        """Audit Trail node metadata: limits, pricing and disclaimer."""
        return await self._get("/api/audit/info")

    # ─── Reporting ───────────────────────────────────────────

    async def get_reporting_summary(
        self,
        from_date: Optional[str] = None,
        to_date: Optional[str] = None,
        network: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Institutional-format summary of payouts, x402 receipts and anchors.

        Not certified regulatory reporting — what you file remains your responsibility.
        """
        return await self._get(
            "/api/reporting/summary",
            params={"from": from_date, "to": to_date, "network": network},
        )

    async def get_reporting_export(
        self,
        type: str,
        from_date: Optional[str] = None,
        to_date: Optional[str] = None,
        network: Optional[str] = None,
        limit: Optional[int] = None,
    ) -> Dict[str, Any]:
        """Export rows as JSON. ``type`` is one of: payroll | payments | anchors."""
        return await self._get(
            "/api/reporting/export",
            params={
                "type": type, "format": "json", "from": from_date,
                "to": to_date, "network": network, "limit": limit,
            },
        )

    # ─── Treasury (DeFindex) ───────────────────────────────────
    #
    # Nirium never holds these funds. It holds the RebalanceManager role of a
    # DeFindex vault the client deploys and owns — every write below returns
    # an UNSIGNED XDR; you decide whether and when to sign it and call
    # ``submit_treasury_tx``. ``rebalance()`` never takes a destination
    # address, so withdrawal is not something the role can express.

    async def get_treasury_info(self) -> Dict[str, Any]:
        """Treasury node metadata: role, custody model, fees, security notes."""
        return await self._get("/api/treasury/info")

    async def get_treasury_vault(self, vault_id: str, holder: Optional[str] = None) -> Dict[str, Any]:
        """Read a vault's roles, assets and managed funds.

        Pass ``holder`` to also get its balance in the vault's asset.
        """
        return await self._get(f"/api/treasury/vault/{vault_id}", params={"holder": holder})

    async def get_treasury_vaults(self, manager: Optional[str] = None) -> Dict[str, Any]:
        """List vaults Nirium has deployed or read, on the current network."""
        return await self._get("/api/treasury/vaults", params={"manager": manager})

    async def get_treasury_strategy_asset(self, strategy_id: str) -> Dict[str, Any]:
        """Read which asset a strategy manages, as declared by the strategy itself — pairs it correctly before you deploy."""
        return await self._get(f"/api/treasury/strategy/{strategy_id}")

    async def deploy_treasury_vault(
        self,
        manager: str,
        caller: str,
        assets: List[Dict[str, Any]],
        name: str,
        symbol: str,
        emergency_manager: Optional[str] = None,
        fee_receiver: Optional[str] = None,
        rebalance_manager: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Build an unsigned XDR to deploy a DeFindex vault.

        ``manager`` keeps control (rescue, pause, revoke); Nirium only ever
        holds ``rebalance_manager``, which cannot withdraw or change roles.
        ``assets`` is ``[{"address": "C...", "strategies": [{"address": "C...", "name": "..."}]}]``.
        Sign the returned XDR with ``caller`` and submit via
        ``submit_treasury_tx``.
        """
        payload: Dict[str, Any] = {
            "manager": manager, "caller": caller, "assets": assets,
            "name": name, "symbol": symbol,
        }
        for key, value in (
            ("emergencyManager", emergency_manager), ("feeReceiver", fee_receiver),
            ("rebalanceManager", rebalance_manager),
        ):
            if value is not None:
                payload[key] = value
        return await self._post("/api/treasury/deploy", payload)

    async def deposit_to_treasury_vault(
        self,
        vault: str,
        from_: str,
        amounts: List[Any],
        invest: Optional[bool] = None,
        max_slippage_bps: Optional[int] = None,
    ) -> Dict[str, Any]:
        """Build an unsigned deposit XDR.

        ``amounts`` is one amount per vault asset, in stroops, as strings —
        an i128 does not survive a JSON number. Sign with ``from_`` and
        submit via ``submit_treasury_tx``.
        """
        payload: Dict[str, Any] = {"vault": vault, "from": from_, "amounts": [str(a) for a in amounts]}
        if invest is not None:
            payload["invest"] = invest
        if max_slippage_bps is not None:
            payload["maxSlippageBps"] = max_slippage_bps
        return await self._post("/api/treasury/deposit", payload)

    async def withdraw_from_treasury_vault(
        self,
        vault: str,
        from_: str,
        shares: Optional[Any] = None,
        max_slippage_bps: Optional[int] = None,
    ) -> Dict[str, Any]:
        """Build an unsigned withdraw XDR. Omit ``shares`` to withdraw everything.

        Sign with ``from_`` and submit via ``submit_treasury_tx``.
        """
        payload: Dict[str, Any] = {"vault": vault, "from": from_}
        if shares is not None:
            payload["shares"] = str(shares)
        if max_slippage_bps is not None:
            payload["maxSlippageBps"] = max_slippage_bps
        return await self._post("/api/treasury/withdraw", payload)

    async def set_treasury_rebalance_manager(
        self, vault: str, manager: str, rebalance_manager: str,
    ) -> Dict[str, Any]:
        """Build an unsigned XDR handing the RebalanceManager role to a new address.

        Only the vault's current Manager can sign it — the same door that
        grants Nirium the role also revokes it.
        """
        return await self._post("/api/treasury/set-rebalance-manager", {
            "vault": vault, "manager": manager, "rebalanceManager": rebalance_manager,
        })

    async def build_treasury_rebalance(
        self, vault: str, instructions: List[Dict[str, Any]], caller: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Build an unsigned rebalance XDR.

        ``instructions`` is
        ``[{"kind": "Unwind" | "Invest", "strategy": "C...", "amount": "1000000"}]``
        — the vault's own strategies only, no other instruction is
        expressible. Sign with the vault's RebalanceManager and submit via
        ``submit_treasury_tx``. To have Nirium sign with its own key instead,
        see ``execute_treasury_rebalance``.
        """
        payload: Dict[str, Any] = {"vault": vault, "instructions": instructions}
        if caller is not None:
            payload["caller"] = caller
        return await self._post("/api/treasury/rebalance", payload)

    async def propose_treasury_rebalance(
        self, vault: str, caller: str, enter_at: float, exit_at: float,
        min_idle: Optional[Any] = None,
    ) -> Dict[str, Any]:
        """Ask the agent what it would propose for this vault — the same decision
        logic the autonomous signer uses (rate vs. your own ``enter_at``/``exit_at``),
        but this never signs. Returns an unsigned XDR for you to review and sign
        yourself, or an empty ``instructions`` list with a ``reason`` if there's
        nothing to do right now. Public: no allowlist, no invite — works for any
        vault where ``caller`` is already the on-chain rebalanceManager. Unlike
        ``execute_treasury_rebalance``, Nirium never executes on your behalf here,
        so this doesn't wait on the same written legal opinion the fully autonomous path does.

        ``enter_at``/``exit_at`` are your mandate, not a Nirium default. ``min_idle``
        is stroops, as a string or number — omit for no minimum (0).
        """
        payload: Dict[str, Any] = {
            "vault": vault, "caller": caller, "enterAt": enter_at, "exitAt": exit_at,
        }
        if min_idle is not None:
            payload["minIdle"] = str(min_idle)
        return await self._post("/api/treasury/rebalance/propose", payload)

    async def execute_treasury_rebalance(
        self, vault: str, instructions: List[Dict[str, Any]], caller: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Sign and submit a rebalance with Nirium's own RebalanceManager key and wait for confirmation.

        Only available where that key actually lives — mainnet's
        receive-only box returns 501 by design, not a broken 500.
        """
        payload: Dict[str, Any] = {"vault": vault, "instructions": instructions}
        if caller is not None:
            payload["caller"] = caller
        return await self._post("/api/treasury/rebalance/execute", payload)

    async def submit_treasury_tx(self, xdr: str) -> Dict[str, Any]:
        """Broadcast an XDR you already signed (deploy/deposit/withdraw/rebalance/set-rebalance-manager) and wait for confirmation."""
        return await self._post("/api/treasury/submit", {"xdr": xdr})


    # ─── Admin ───────────────────────────────────────────────

    async def configure_llm(
        self,
        provider: str,
        model: Optional[str] = None,
        api_key: Optional[str] = None,
        ollama_url: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Update the active LLM provider (admin only)."""
        payload: Dict[str, Any] = {"provider": provider}
        if model:
            payload["model"] = model
        if api_key:
            payload["apiKey"] = api_key
        if ollama_url:
            payload["ollamaUrl"] = ollama_url
        return await self._post("/api/config/llm", payload)

    # ─── Webhooks ────────────────────────────────────────────

    async def register_webhook(self, url: str, events: List[str], secret: Optional[str] = None) -> Dict[str, Any]:
        """Register a webhook endpoint with HMAC signing."""
        return await self._post("/api/webhooks", {"url": url, "events": events, "secret": secret})

    async def get_webhooks(self) -> List[Dict[str, Any]]:
        """List all registered webhooks."""
        return await self._get("/api/webhooks")

    async def delete_webhook(self, webhook_id: str) -> Dict[str, Any]:
        """Delete a webhook by ID."""
        return await self._delete(f"/api/webhooks/{webhook_id}")

    async def test_webhook(self, webhook_id: str) -> Dict[str, Any]:
        """Send a test event to a webhook."""
        return await self._post(f"/api/webhooks/{webhook_id}/test")

    # ─── x402 Protocol ───────────────────────────────────────

    def init_x402(
        self,
        secret_key: str,
        network: str = "stellar:testnet",
        rpc_url: str = "",
        max_amount_per_payment: Any = _X402_DEFAULT_MAX_AMOUNT,
        approve: Optional[X402Approver] = None,
        policy: Optional[Any] = None,
        current_version: Optional[Any] = None,
        policy_timeout_ms: Optional[int] = None,
        on_decision: Optional[Callable[[Dict[str, Any]], None]] = None,
        now: Optional[Callable[[], float]] = None,
    ):
        """
        Initialize the x402 pay-per-request client (protocol v2).

        The payer signs a Soroban auth entry; the facilitator submits the
        transaction and sponsors the network fee, so the payer needs no XLM.

        Args:
            secret_key: Stellar secret key (S...) used to sign the auth entry.
            network: CAIP-2 network ID ('stellar:testnet' or 'stellar:pubnet').
            rpc_url: Soroban RPC override. Defaults per network.
            max_amount_per_payment: Most this client pays in one request, in USD,
                for USDC ('$1' by default, like the TypeScript SDK). A payment
                above it, or in any asset other than the network's USDC, is
                refused before signing unless ``approve`` accepts it.
            approve: Optional callback (sync or async). It receives the payment
                option (url, network, asset, payTo, amount) whenever the cap
                cannot accept it on its own, and must return True to sign.
            policy: Optional pre-sign policy hook (callable or object with evaluate).
                Receives the payment context and returns ALLOW, DENY, or WAIT.
                DENY and WAIT refuse the payment without calling the signer.
            current_version: Optional callable returning current policy version for stale-check.
            policy_timeout_ms: Hard deadline for pre-sign policy evaluation in ms (default 5000).
            on_decision: Optional observer callback receiving record of policy outcome.
            now: Optional callable returning epoch milliseconds, for testing.

        A 402 whose options are all on a different network than ``network`` is
        always refused: the client never falls back to another network.
        """
        network = _X402_NETWORK_ALIASES.get(str(network).strip().lower(), network)
        if network not in _X402_NETWORKS:
            raise ValueError(
                f"network must be one of {', '.join(_X402_NETWORKS)}, got {network!r}"
            )
        if approve is not None and not callable(approve):
            raise ValueError("approve must be a callable or None")
        if policy is not None and not callable(policy) and not hasattr(policy, "evaluate"):
            raise ValueError("init_x402: policy must be a callable or an object with an evaluate method.")
        if current_version is not None and not callable(current_version):
            raise ValueError("init_x402: current_version must be a callable or None.")
        if policy_timeout_ms is not None and (not isinstance(policy_timeout_ms, int) or policy_timeout_ms <= 0):
            raise ValueError("init_x402: policy_timeout_ms must be a positive integer (ms).")
        if on_decision is not None and not callable(on_decision):
            raise ValueError("init_x402: on_decision must be a callable or None.")
        if now is not None and not callable(now):
            raise ValueError("init_x402: now must be a callable returning epoch milliseconds.")

        cap = _parse_usd_cap(max_amount_per_payment)
        self._x402_cap_label = f"${cap.normalize():f}"
        self._x402_cap_atomic = int(cap * (10 ** _X402_USDC_DECIMALS))
        self._x402_approve = approve
        self._x402_policy = policy
        self._x402_current_version = current_version
        self._x402_policy_timeout_ms = policy_timeout_ms or 5000
        self._x402_on_decision = on_decision
        self._x402_now = now
        is_testnet = network == "stellar:testnet"
        self._x402_keypair = Keypair.from_secret(secret_key)
        self._x402_network = network
        self._x402_passphrase = (
            Network.TESTNET_NETWORK_PASSPHRASE if is_testnet
            else Network.PUBLIC_NETWORK_PASSPHRASE
        )
        self._x402_rpc_url = rpc_url or (
            "https://soroban-testnet.stellar.org" if is_testnet
            # El SDF no corre RPC público de mainnet; gateway.fm es el mismo
            # default que usan el SDK de TypeScript y @stellar/mpp.
            else "https://soroban-rpc.mainnet.stellar.gateway.fm"
        )

    async def _x402_select_requirement(
        self, url: str, accepts: List[Dict[str, Any]]
    ) -> Dict[str, Any]:
        """Pick the option to pay, or raise before anything is signed.

        Only options on the configured network count; there is no fallback to
        another network. Among them, the cheapest USDC option within the cap
        wins. Anything else (above the cap, another asset, a malformed amount)
        is signed only if the ``approve`` callback returns True.
        """
        network = self._x402_network
        on_network = [
            a for a in accepts
            if isinstance(a, dict) and a.get("network") == network
        ]
        if not on_network:
            offered = sorted({str(a.get("network")) for a in accepts if isinstance(a, dict)})
            raise X402NetworkMismatchError(url, network, offered)

        exact = [a for a in on_network if a.get("scheme") == "exact"]
        if not exact:
            raise RuntimeError(
                f"unsupported x402 scheme: {on_network[0].get('scheme')}"
            )

        usdc = _X402_USDC_SAC[network]
        cap = getattr(self, "_x402_cap_atomic", 10 ** _X402_USDC_DECIMALS)
        cap_label = getattr(self, "_x402_cap_label", _X402_DEFAULT_MAX_AMOUNT)

        def amount_of(a: Dict[str, Any]) -> Optional[int]:
            raw = a.get("amount")
            if isinstance(raw, str) and raw.isdigit():
                return int(raw)
            return None

        within = [
            a for a in exact
            if a.get("asset") == usdc
            and amount_of(a) is not None
            and 0 < amount_of(a) <= cap  # type: ignore[operator]
        ]
        if within:
            return min(within, key=lambda a: amount_of(a))  # type: ignore[arg-type,return-value]

        candidate = min(exact, key=lambda a: amount_of(a) if amount_of(a) is not None else 2**127)
        amount = amount_of(candidate)
        if amount is None or amount <= 0:
            reason = f"the server asked for an invalid amount ({candidate.get('amount')!r})."
        elif candidate.get("asset") != usdc:
            reason = (
                f"the server asked for {amount} atomic units of {candidate.get('asset')}, "
                f"which is not {network} USDC, so the cap cannot price it."
            )
        else:
            reason = (
                f"the server asked for {Decimal(amount) / (10 ** _X402_USDC_DECIMALS)} USDC."
            )

        approver = getattr(self, "_x402_approve", None)
        if approver is not None and amount is not None and amount > 0:
            decision = approver({
                "url": url,
                "network": network,
                "scheme": candidate.get("scheme"),
                "asset": candidate.get("asset"),
                "payTo": candidate.get("payTo"),
                "amount": candidate.get("amount"),
                "reason": reason,
            })
            if inspect.isawaitable(decision):
                decision = await decision
            if decision is True:
                return candidate
        raise X402SpendCapError(url, candidate, cap_label, reason)

    def _x402_report_decision(
        self,
        outcome: str,
        context: Optional[X402PolicyContext] = None,
        decision: Optional[X402PolicyDecision] = None,
        err: Optional[str] = None,
    ) -> None:
        policy = getattr(self, "_x402_policy", None)
        cb = getattr(
            policy,
            "on_decision",
            getattr(policy, "onDecision", getattr(self, "_x402_on_decision", None)),
        )
        if cb and callable(cb):
            try:
                rec = {
                    "outcome": outcome,
                    "context": context,
                    "decision": decision,
                    "error": err,
                }
                res = cb(rec)
                if inspect.isawaitable(res):
                    try:
                        loop = asyncio.get_running_loop()
                        loop.create_task(res)
                    except RuntimeError:
                        pass
            except Exception:
                pass

    async def _x402_authorize_entry_with_policy(
        self,
        entry: Any,
        max_ledger: int,
        accepted: Dict[str, Any],
        url: str,
        method: str,
    ) -> Any:
        policy = getattr(self, "_x402_policy", None)
        account = self._x402_keypair.public_key
        network_passphrase = self._x402_passphrase

        if self._x402_keypair.public_key != account:
            self._x402_report_decision("SIGNER_CHANGED", err="base signer address changed before gate evaluation")
            raise X402PolicyError("SIGNER_CHANGED", "base signer address changed before gate evaluation")

        from stellar_sdk.auth import build_authorization_preimage, authorization_payload_hash  # type: ignore

        preimage = build_authorization_preimage(entry, max_ledger, network_passphrase)
        payload_hash = authorization_payload_hash(preimage).hex()

        if preimage.type == stellar_xdr.EnvelopeType.ENVELOPE_TYPE_SOROBAN_AUTHORIZATION:
            auth = preimage.soroban_authorization
            preimage_type = "legacy"
        elif preimage.type == stellar_xdr.EnvelopeType.ENVELOPE_TYPE_SOROBAN_AUTHORIZATION_WITH_ADDRESS:
            auth = preimage.soroban_authorization_with_address
            preimage_type = "cap71"
            bound_address = Address.from_xdr_sc_address(auth.address).address
            if bound_address != account:
                raise X402PolicyError("CONTEXT_MISMATCH", "CAP-71 preimage is bound to a different address than the signer")
        else:
            raise X402PolicyError("CONTEXT_MISMATCH", f"unsupported preimage type {preimage.type}")

        fn = auth.invocation.function
        if fn.type != stellar_xdr.SorobanAuthorizedFunctionType.SOROBAN_AUTHORIZED_FUNCTION_TYPE_CONTRACT_FN:
            raise X402PolicyError("CONTEXT_MISMATCH", f"unexpected authorized function {fn.type}")

        contract_fn = fn.contract_fn
        contract_id = Address.from_xdr_sc_address(contract_fn.contract_address).address
        function_name = contract_fn.function_name.sc_symbol.decode()
        if function_name != "transfer" or len(contract_fn.args) != 3:
            raise X402PolicyError("CONTEXT_MISMATCH", f"expected transfer(from,to,amount), got {function_name}/{len(contract_fn.args)}")

        from_addr = Address.from_xdr_sc_val(contract_fn.args[0]).address
        to_addr = Address.from_xdr_sc_val(contract_fn.args[1]).address
        amount_val = str(scval.from_int128(contract_fn.args[2]))

        if contract_id != accepted.get("asset"):
            raise X402PolicyError("CONTEXT_MISMATCH", "asset contract differs from requirements.asset")
        if to_addr != accepted.get("payTo"):
            raise X402PolicyError("CONTEXT_MISMATCH", "destination differs from requirements.payTo")
        if str(amount_val) != str(accepted.get("amount")):
            raise X402PolicyError("CONTEXT_MISMATCH", "amount differs from requirements.amount")
        if from_addr != account:
            raise X402PolicyError("CONTEXT_MISMATCH", "from differs from signer address")

        auth_view = {
            "preimageXdr": preimage.to_xdr(),
            "preimageType": preimage_type,
            "payloadHash": payload_hash,
            "networkPassphrase": network_passphrase,
            "nonce": str(auth.nonce.int64),
            "signatureExpirationLedger": int(auth.signature_expiration_ledger.uint32),
            "contractId": contract_id,
            "functionName": function_name,
            "from": from_addr,
            "to": to_addr,
            "amount": amount_val,
        }

        context_hash = _sha256_hex(
            json.dumps({"v": 1, "url": url, "method": method, "payloadHash": payload_hash}, separators=(",", ":"), ensure_ascii=False)
        )

        context = X402PolicyContext(
            contextVersion=1,
            context_version=1,
            url=url,
            method=method,
            resource=url,
            network=self._x402_network,
            asset=accepted.get("asset", ""),
            payTo=accepted.get("payTo", ""),
            payee=accepted.get("payTo", ""),
            amount=str(accepted.get("amount", "")),
            signer=account,
            contextHash=context_hash,
            context_hash=context_hash,
            requirements=accepted,
            authorization=auth_view,
        )

        now_fn = getattr(self, "_x402_now", None) or (lambda: time.time() * 1000.0)

        def read_clock(decision: Optional[X402PolicyDecision] = None) -> float:
            try:
                t = now_fn()
            except Exception as e:
                refuse("CLOCK_INVALID", f"clock threw ({e})", decision=decision)
            if not isinstance(t, (int, float)) or _math.isnan(t) or _math.isinf(t):
                refuse("CLOCK_INVALID", f"clock returned {t!r}, not epoch milliseconds", decision=decision)
            return float(t)

        def refuse(outcome: str, msg: str, decision: Optional[X402PolicyDecision] = None) -> NoReturn:
            self._x402_report_decision(outcome, context=context, decision=decision, err=msg)
            raise X402PolicyError(outcome, msg, decision=decision, context_hash=context_hash)

        if self._x402_keypair.public_key != account:
            refuse("SIGNER_CHANGED", "signer address changed before policy evaluation")

        start_time = read_clock()
        timeout_sec = accepted.get("maxTimeoutSeconds", 300)
        base_timeout_ms = getattr(
            policy,
            "timeout_ms",
            getattr(policy, "timeoutMs", getattr(self, "_x402_policy_timeout_ms", 5000)),
        )
        if timeout_sec and timeout_sec > 0:
            effective_timeout_ms = max(1, min(base_timeout_ms, int((timeout_sec * 1000) / 2)))
        else:
            effective_timeout_ms = base_timeout_ms
        deadline = start_time + effective_timeout_ms

        eval_fn = getattr(policy, "evaluate", policy if callable(policy) else None)
        if eval_fn is None:
            refuse("MALFORMED", "policy is neither callable nor has evaluate method")

        try:
            eval_res = eval_fn(context)
            if inspect.isawaitable(eval_res):
                raw_decision = await asyncio.wait_for(eval_res, timeout=effective_timeout_ms / 1000.0)
            else:
                raw_decision = eval_res
        except asyncio.TimeoutError:
            refuse("TIMEOUT", f"no decision within {effective_timeout_ms} ms")
        except Exception as e:
            refuse("ENGINE_ERROR", f"policy evaluation failed: {e}")

        decision = _parse_decision(raw_decision)
        if decision is None or decision.decision not in ("ALLOW", "DENY", "WAIT"):
            refuse("MALFORMED", f"unknown or missing verdict: {raw_decision!r}")

        if decision.decision == "DENY":
            refuse("DENY", decision.reason or "payment denied by policy", decision=decision)

        if decision.decision == "WAIT":
            refuse("WAIT", decision.reason or "payment waiting on approval", decision=decision)

        # Verdict is ALLOW: Must echo the exact contextHash (otherwise UNBOUND)
        if not decision.contextHash or decision.contextHash != context_hash:
            refuse("UNBOUND", "ALLOW is not bound to this authorization", decision=decision)

        now_t = read_clock(decision=decision)
        if now_t >= deadline:
            refuse("TIMEOUT", "decision arrived after the deadline", decision=decision)

        if decision.expiresAt is not None:
            exp_t = decision.expiresAt
            if exp_t < 1e11:
                exp_t *= 1000.0
            if now_t >= exp_t:
                refuse("EXPIRED", "ALLOW expired before signing", decision=decision)

        ver_fn = getattr(
            policy,
            "current_version",
            getattr(policy, "currentVersion", getattr(self, "_x402_current_version", None)),
        )
        if ver_fn is not None:
            if not decision.policyVersion:
                refuse("MALFORMED", "ALLOW has no policyVersion to check against currentVersion", decision=decision)
            try:
                ver_res = ver_fn(context)
                if inspect.isawaitable(ver_res):
                    curr_ver = await asyncio.wait_for(ver_res, timeout=effective_timeout_ms / 1000.0)
                else:
                    curr_ver = ver_res
            except asyncio.TimeoutError:
                refuse("TIMEOUT", f"currentVersion timed out after {effective_timeout_ms} ms", decision=decision)
            except Exception as e:
                refuse("VERSION_UNAVAILABLE", f"currentVersion failed: {e}", decision=decision)

            if not curr_ver:
                refuse("VERSION_UNAVAILABLE", "currentVersion returned empty version", decision=decision)

            if str(curr_ver) != str(decision.policyVersion):
                refuse("STALE", f"ALLOW was issued under policy {decision.policyVersion}, current is {curr_ver}", decision=decision)

        now_t = read_clock(decision=decision)
        if decision.expiresAt is not None:
            exp_t = decision.expiresAt
            if exp_t < 1e11:
                exp_t *= 1000.0
            if now_t >= exp_t:
                refuse("EXPIRED", "ALLOW expired before signing", decision=decision)

        self._x402_report_decision("ALLOWED", context=context, decision=decision)
        self._x402_last_policy_context = context
        self._x402_last_policy_decision = decision

        # Check identity before signing: SIGNER_CHANGED if account changed
        if self._x402_keypair.public_key != account:
            refuse("SIGNER_CHANGED", "signer address changed while the policy was evaluated", decision=decision)

        try:
            signed_entry = authorize_entry(entry, self._x402_keypair, max_ledger, network_passphrase)
            self._x402_report_decision("SIGNED", context=context, decision=decision)
            return signed_entry
        except Exception as e:
            self._x402_report_decision("SIGNER_ERROR", context=context, decision=decision, err=str(e))
            raise

    def _x402_prepare_transaction(self, accepted: Dict[str, Any]) -> tuple[Any, int, SorobanServer]:
        extra = accepted.get("extra") or {}
        if not extra.get("areFeesSponsored"):
            raise RuntimeError("x402 exact scheme requires areFeesSponsored to be true")

        soroban = SorobanServer(self._x402_rpc_url)
        timeout = int(accepted.get("maxTimeoutSeconds", 300))
        max_ledger = soroban.get_latest_ledger().sequence + _math.ceil(timeout / 5)

        tx = (
            TransactionBuilder(
                source_account=Account(_X402_NULL_ACCOUNT, 0),
                network_passphrase=self._x402_passphrase,
                base_fee=100,
            )
            .append_invoke_contract_function_op(
                contract_id=accepted["asset"],
                function_name="transfer",
                parameters=[
                    Address(self._x402_keypair.public_key).to_xdr_sc_val(),  # from
                    Address(accepted["payTo"]).to_xdr_sc_val(),              # to
                    scval.to_int128(int(accepted["amount"])),                # amount
                ],
            )
            .set_timeout(timeout)
            .build()
        )

        prepared = soroban.prepare_transaction(tx)
        return prepared, max_ledger, soroban

    async def _x402_build_transaction(
        self,
        accepted: Dict[str, Any],
        url: str = "",
        method: str = "GET",
    ) -> str:
        """
        Build the signed payment transaction for one payment requirement.

        Prepares the Soroban transaction first, evaluates pre-sign policy over
        the actual authorization entry (if configured), signs the entry, and
        re-simulates for fee estimation.
        """
        prepared, max_ledger, soroban = self._x402_prepare_transaction(accepted)
        op = prepared.transaction.operations[0]

        signed_auth = []
        for e in (op.auth or []):
            if getattr(self, "_x402_policy", None) is not None:
                signed_e = await self._x402_authorize_entry_with_policy(
                    entry=e,
                    max_ledger=max_ledger,
                    accepted=accepted,
                    url=url,
                    method=method,
                )
            else:
                signed_e = authorize_entry(e, self._x402_keypair, max_ledger, self._x402_passphrase)
            signed_auth.append(signed_e)
        op.auth = signed_auth

        sim = soroban.simulate_transaction(prepared)
        if getattr(sim, "error", None):
            raise RuntimeError(f"x402 payment simulation failed: {sim.error}")
        data = sim.transaction_data
        prepared.transaction.soroban_data = (
            SorobanTransactionData.from_xdr(data) if isinstance(data, str) else data
        )
        prepared.transaction.fee = 100 + int(sim.min_resource_fee)
        return prepared.to_xdr()

    def _x402_http_payload(self, body: Optional[Any]) -> Dict[str, Any]:
        if body is None:
            return {}
        if isinstance(body, (dict, list)):
            return {"json": body}
        return {"data": body}

    def _x402_store_settlement(self, headers: Any) -> None:
        raw = (
            headers.get("PAYMENT-RESPONSE")
            or headers.get("payment-response")
            or headers.get("X-PAYMENT-RESPONSE")
            or headers.get("x-payment-response")
            or headers.get("Payment-Receipt")
            or headers.get("payment-receipt")
        )
        if not raw:
            self.last_x402_settlement = None
            return
        try:
            decoded = json.loads(_b64.b64decode(raw).decode("utf-8"))
        except (ValueError, json.JSONDecodeError, TypeError):
            try:
                decoded = json.loads(raw)
            except (ValueError, json.JSONDecodeError, TypeError):
                self.last_x402_settlement = None
                return
        self.last_x402_settlement = decoded if isinstance(decoded, dict) else None

    async def _x402_read_payload(self, resp: Any) -> Dict[str, Any]:
        text = await resp.text()
        if not text:
            return {}
        try:
            parsed = json.loads(text)
        except json.JSONDecodeError:
            return {"body": text}
        return parsed if isinstance(parsed, dict) else {"body": parsed}

    async def x402_fetch(
        self,
        url: str,
        method: str = "GET",
        body: Optional[Any] = None,
    ) -> Dict[str, Any]:
        """
        Fetch a paid resource via x402 (protocol v2).

        Reads the payment requirements from the ``payment-required`` response
        header, signs a Soroban auth entry for the exact amount, and retries
        with the ``PAYMENT-SIGNATURE`` header.

        ``body`` is forwarded on both the challenge request and the paid retry
        so POST/PUT callers do not need a second payment client.

        Returns the JSON payload from the paid resource.
        """
        if not hasattr(self, "_x402_keypair"):
            raise RuntimeError("x402 client not initialized. Call agent.init_x402() first.")

        payload = self._x402_http_payload(body)
        self.last_x402_settlement = None
        async with aiohttp.ClientSession() as session:
            async with session.request(method, url, **payload) as resp:
                if resp.status != 402:
                    return await self._x402_read_payload(resp)
                # v2 entrega los requirements en un header base64; el body va vacío.
                raw = resp.headers.get("payment-required")

            if not raw:
                raise RuntimeError(
                    "402 response carried no `payment-required` header — the server "
                    "may not be an x402 v2 endpoint."
                )

            challenge = json.loads(_b64.b64decode(raw).decode("utf-8"))
            accepts = challenge.get("accepts") or []
            if not accepts:
                raise RuntimeError("x402 challenge listed no acceptable payment methods")

            accepted = await self._x402_select_requirement(url, accepts)

            tx_xdr = await self._x402_build_transaction(accepted, url=url, method=method)

            payment = {
                "x402Version": challenge.get("x402Version", 2),
                "accepted": accepted,
                "payload": {"transaction": tx_xdr},
            }
            header = _b64.b64encode(json.dumps(payment).encode("utf-8")).decode("ascii")

            # v2 usa PAYMENT-SIGNATURE. X-PAYMENT es de v1: mandarlo hace que el
            # servidor ignore el pago por completo y reemita el 402 sin explicar.
            async with session.request(
                method, url, headers={"PAYMENT-SIGNATURE": header}, **payload
            ) as paid:
                if paid.status >= 400:
                    rejected = await paid.text()
                    raise RuntimeError(
                        f"x402 payment rejected (HTTP {paid.status}): {rejected[:300]}"
                    )
                self._x402_store_settlement(paid.headers)
                return await self._x402_read_payload(paid)

    # ─── MPP Protocol (Charge Mode) ─────────────────────────

    def init_mpp(self, secret_key: str, network: str = "stellar:testnet"):
        """
        Initialize MPP Charge client for per-request Soroban SAC payments.

        Python SDK implements the MPP charge flow directly:
        1. GET resource -> receive 402 + charge challenge
        2. Sign Soroban auth entries for SAC USDC transfer
        3. Retry with signed auth in X-PAYMENT header

        Args:
            secret_key: Stellar secret key (S...) for signing
            network: CAIP-2 network ID ('stellar:testnet' or 'stellar:pubnet')
        """
        self._mpp_keypair = Keypair.from_secret(secret_key)
        self._mpp_network = network
        self._mpp_passphrase = (
            Network.TESTNET_NETWORK_PASSPHRASE if "testnet" in network
            else Network.PUBLIC_NETWORK_PASSPHRASE
        )
        self._mpp_horizon = Server(
            "https://horizon-testnet.stellar.org" if "testnet" in network
            else "https://horizon.stellar.org"
        )

    async def mpp_fetch(self, url: str, method: str = "GET") -> Dict[str, Any]:
        """
        Fetch a paid resource via MPP Charge protocol.

        Sends the initial request, receives 402 with charge challenge,
        builds and signs a USDC payment, retries with payment proof.
        In pull mode, the server assembles and broadcasts the Soroban tx.

        Returns the JSON payload from the paid resource.
        """
        if not hasattr(self, "_mpp_keypair"):
            raise RuntimeError("MPP client not initialized. Call agent.init_mpp() first.")

        async with aiohttp.ClientSession() as session:
            # Step 1: Initial request — expect 402
            async with session.request(method, url) as resp:
                if resp.status != 402:
                    return await resp.json()

                challenge = await resp.json()

            # Step 2: Build USDC payment from challenge
            pay_req = challenge.get("paymentRequirements", [{}])[0]
            dest = pay_req.get("receiver") or pay_req.get("destination", "")
            amount = pay_req.get("maxAmountRequired") or pay_req.get("amount", "0.01")
            usdc_issuer = "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5"
            usdc_asset = Asset("USDC", usdc_issuer)

            account = self._mpp_horizon.load_account(self._mpp_keypair.public_key)
            tx = (
                TransactionBuilder(
                    source_account=account,
                    network_passphrase=self._mpp_passphrase,
                    base_fee=100,
                )
                .append_payment_op(dest, usdc_asset, str(amount))
                .set_timeout(30)
                .build()
            )
            tx.sign(self._mpp_keypair)
            xdr = tx.to_xdr()

            # Step 3: Retry with payment proof
            payment_header = json.dumps({"transaction": xdr, "mode": "pull"})
            headers = {"X-PAYMENT": payment_header, "Content-Type": "application/json"}
            async with session.request(method, url, headers=headers) as resp:
                resp.raise_for_status()
                return await resp.json()

    # ─── WebSocket ───────────────────────────────────────────

    async def close(self):
        """
        Gracefully close active WebSocket connection and stop subscriptions.
        """
        self._ws_close_requested = True
        self._ws_running = False
        self._close_event.set()
        if self._active_ws is not None:
            try:
                await self._active_ws.close()
            except Exception:
                pass
            self._active_ws = None
        await self._emit("status", WebSocketStatus.CLOSED)

    async def subscribe(
        self,
        callback: Optional[Callable] = None,
        max_retries: Optional[int] = None,
        initial_delay: float = 1.0,
        max_delay: float = 30.0,
        backoff_factor: float = 2.0,
        jitter: float = 0.2,
        dedupe_size: int = 1000,
    ):
        """
        Start real-time WebSocket connection for signals with resilient exponential backoff,
        jitter, retry capping, deduplication, and typed event channels.

        Args:
            callback: Optional callback for "signal" events (preserves legacy API).
            max_retries: Maximum consecutive reconnection attempts before raising WebSocketMaxRetriesExceeded.
            initial_delay: Initial reconnect delay in seconds (default: 1.0).
            max_delay: Maximum reconnect delay in seconds (default: 30.0).
            backoff_factor: Multiplier for exponential backoff (default: 2.0).
            jitter: Fractional random jitter factor applied to delay (default: 0.2, i.e. +/- 20%).
            dedupe_size: Number of recent message IDs to track for deduplication.
        """
        if callback:
            self.callbacks.setdefault("signal", []).append(callback)

        auth_query = f"?token={self.token}" if self.token else ""
        url = f"{self.ws_url}{auth_query}"

        self._ws_running = True
        self._ws_close_requested = False
        self._close_event.clear()
        attempt = 0
        seen_ids: collections.deque = collections.deque(maxlen=dedupe_size)
        seen_set: set = set()

        def _dedupe_check(msg_data: Dict[str, Any]) -> bool:
            """Returns True if message is a new unseen signal, False if duplicate."""
            msg_id = (
                msg_data.get("id")
                or msg_data.get("signal_id")
                or msg_data.get("txHash")
            )
            if not msg_id:
                raw_str = json.dumps(msg_data, sort_keys=True)
                msg_id = hashlib.sha256(raw_str.encode("utf-8")).hexdigest()

            if msg_id in seen_set:
                return False

            if len(seen_ids) >= dedupe_size and seen_ids:
                oldest = seen_ids.popleft()
                seen_set.discard(oldest)

            seen_ids.append(msg_id)
            seen_set.add(msg_id)
            return True

        while self._ws_running and not self._ws_close_requested:
            try:
                await self._emit(
                    "status",
                    WebSocketStatus.CONNECTING if attempt == 0 else WebSocketStatus.RECONNECTING,
                )
                async with websockets.connect(url) as ws:
                    self._active_ws = ws
                    logger.info("Connected to Nirium Signal Stream")
                    await self._emit("status", WebSocketStatus.CONNECTED)
                    await self._emit("connected", None)

                    async for message in ws:
                        if self._ws_close_requested:
                            break
                        # Reset retry counter upon successful message exchange
                        attempt = 0
                        data = json.loads(message)
                        event = data.get("type", "signal")

                        # Deduplicate only signal messages
                        if event == "signal":
                            if not _dedupe_check(data):
                                logger.debug(f"Dropped duplicate signal: {data.get('id')}")
                                continue

                        if event in self.callbacks:
                            await self._emit(event, data)
                        if (
                            event != "signal"
                            and len(self.callbacks.get("signal", [])) > 0
                            and event not in ("connected", "status", "error", "log")
                        ):
                            await self._emit("signal", data)

                    if not self._ws_close_requested:
                        raise ConnectionResetError("WebSocket connection closed by remote server")

            except Exception as e:
                self._active_ws = None
                if self._ws_close_requested:
                    logger.info("WebSocket connection closed by user request.")
                    await self._emit("status", WebSocketStatus.CLOSED)
                    break

                attempt += 1
                await self._emit("status", WebSocketStatus.DISCONNECTED)
                await self._emit(
                    "error",
                    {"error": str(e), "exception": e, "attempt": attempt},
                )

                if max_retries is not None and attempt >= max_retries:
                    logger.error(
                        f"WS Reconnect failed after {attempt} attempts. Max retries exceeded."
                    )
                    await self._emit("status", WebSocketStatus.CLOSED)
                    raise WebSocketMaxRetriesExceeded(
                        f"WebSocket connection failed after {attempt} consecutive attempts: {e}"
                    ) from e

                # Calculate exponential backoff with jitter
                base_delay = min(
                    max_delay, initial_delay * (backoff_factor ** (attempt - 1))
                )
                jitter_range = base_delay * jitter
                actual_delay = max(
                    0.05, base_delay + random.uniform(-jitter_range, jitter_range)
                )

                logger.warning(
                    f"WS Disconnected: {e}. Reconnecting (attempt {attempt}/{max_retries or 'inf'}) in {actual_delay:.2f}s..."
                )
                try:
                    await asyncio.wait_for(self._close_event.wait(), timeout=actual_delay)
                    # If close event was triggered during backoff sleep, terminate immediately
                    break
                except asyncio.TimeoutError:
                    # Backoff sleep elapsed normally, proceed to reconnect
                    pass
