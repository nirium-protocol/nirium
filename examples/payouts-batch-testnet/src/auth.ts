/**
 * Obtain a credential the Agent can send as `x-api-key`.
 *
 * Resolves NIRIUM_API_KEY from environment, or defaults to a test key for testnet.
 */
export async function resolveApiKey(baseUrl: string, address: string): Promise<string> {
    const fromEnv = process.env.NIRIUM_API_KEY?.trim();
    if (fromEnv) return fromEnv;

    try {
        const response = await fetch(`${baseUrl}/api/public/demo-auth`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ walletAddress: address }),
        });
        if (response.ok) {
            const data = (await response.json()) as Record<string, unknown>;
            const key = [data.apiKey, data.api_key, data.token, data.accessToken].find(
                (value): value is string => typeof value === 'string' && value.length > 0,
            );
            if (key) return key;
        }
    } catch {
        // Fallback for testnet local runs
    }

    return 'testnet-batch-payout-key';
}
