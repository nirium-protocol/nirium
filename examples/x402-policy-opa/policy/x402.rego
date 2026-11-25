# Reference policy for examples/x402-policy-opa (#142).
# Input: {amount, destination, asset, network, agent} (amount in base units, as a string).
package nirium.x402

# Per-payment cap, in the asset's base units (1 USDC with 7 decimals).
max_amount := 10000000

# Destinations this agent may pay.
allowed_destinations := {
	"GMERCHANTALLOWED",
}

default decision := {"allow": false, "reason": "no rule allowed this payment"}

decision := {"allow": true} if {
	amount_ok
	destination_ok
}

decision := {"allow": false, "reason": "amount over per-payment cap"} if {
	not amount_ok
}

decision := {"allow": false, "reason": "destination not in allowlist"} if {
	amount_ok
	not destination_ok
}

amount_ok if {
	regex.match(`^[1-9][0-9]*$`, input.amount)
	to_number(input.amount) <= max_amount
}

destination_ok if input.destination in allowed_destinations
