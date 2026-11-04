package nirium.x402_test

import data.nirium.x402

ok := {"amount": "5000000", "destination": "GMERCHANTALLOWED", "asset": "CUSDC", "network": "stellar:testnet", "agent": "GAGENT"}

test_allow if x402.decision.allow with input as ok

test_deny_over_cap if {
	d := x402.decision with input as object.union(ok, {"amount": "10000001"})
	not d.allow
	d.reason == "amount over per-payment cap"
}

test_allow_at_cap if x402.decision.allow with input as object.union(ok, {"amount": "10000000"})

test_deny_destination if {
	d := x402.decision with input as object.union(ok, {"destination": "GOTHER"})
	not d.allow
	d.reason == "destination not in allowlist"
}

test_deny_non_integer if not x402.decision.allow with input as object.union(ok, {"amount": "1.5"})

test_deny_zero if not x402.decision.allow with input as object.union(ok, {"amount": "0"})

test_deny_no_input if not x402.decision.allow
