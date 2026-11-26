/**
 * The adapter. x402Serve() returns Express middleware `(req, res, next)`, and
 * Hono and Fastify do not hand you Express objects. This file builds just
 * enough of them from a web-standard `Request` and turns what the middleware
 * writes back into a web-standard `Response`.
 *
 * It does not reimplement any x402 logic. The payment guard (402 until a valid
 * payment arrives) and settlement (verify, run the handler, settle, only then
 * release the response) all stay inside x402Serve() and @x402/express. The
 * middleware needs a real-looking `res` because it temporarily replaces
 * `res.writeHead/write/end/flushHeaders` to hold the handler's response back
 * until the payment has settled, so those methods behave like Node's.
 */

type Headers_ = Record<string, string | string[]>

/** The slice of Express's `req` that x402Serve() and @x402/express read. */
function makeReq(request: Request, ip: string | undefined, body: unknown) {
  const url = new URL(request.url)
  const headers: Record<string, string> = {}
  request.headers.forEach((value, key) => {
    headers[key.toLowerCase()] = value
  })
  const query: Record<string, string | string[]> = {}
  for (const [key, value] of url.searchParams) {
    const prev = query[key]
    query[key] = prev === undefined ? value : ([] as string[]).concat(prev, value)
  }
  return {
    method: request.method,
    url: url.pathname + url.search,
    originalUrl: url.pathname + url.search,
    path: url.pathname,
    protocol: url.protocol.replace(':', ''),
    hostname: url.hostname,
    headers,
    header: (name: string) => headers[name.toLowerCase()],
    get: (name: string) => headers[name.toLowerCase()],
    query,
    body,
    ip,
  }
}

/** The slice of Express's `res` (a Node ServerResponse) that the middleware uses. */
class ShimResponse {
  statusCode = 200
  headersSent = false
  private headers = new Map<string, string | string[]>()
  private chunks: Buffer[] = []
  private listeners: Record<string, Array<() => void>> = {}

  constructor(private readonly onDone: (response: Response) => void) {}

  status(code: number) {
    this.statusCode = code
    return this
  }
  setHeader(name: string, value: string | number | string[]) {
    this.headers.set(name.toLowerCase(), Array.isArray(value) ? value : String(value))
    return this
  }
  set(name: string, value: string | number | string[]) {
    return this.setHeader(name, value)
  }
  getHeader(name: string) {
    return this.headers.get(name.toLowerCase())
  }
  getHeaders(): Headers_ {
    return Object.fromEntries(this.headers)
  }
  removeHeader(name: string) {
    this.headers.delete(name.toLowerCase())
  }
  writeHead(status: number, headers?: Record<string, string | number | string[]>) {
    this.statusCode = status
    for (const [k, v] of Object.entries(headers ?? {})) this.setHeader(k, v)
    return this
  }
  flushHeaders() {}
  write(chunk: string | Uint8Array) {
    this.chunks.push(Buffer.from(chunk))
    return true
  }
  json(body: unknown) {
    if (!this.getHeader('content-type')) this.setHeader('content-type', 'application/json; charset=utf-8')
    return this.end(JSON.stringify(body))
  }
  send(body: unknown) {
    if (typeof body === 'string' || body instanceof Uint8Array) {
      if (!this.getHeader('content-type')) this.setHeader('content-type', 'text/html; charset=utf-8')
      return this.end(body)
    }
    return this.json(body)
  }
  on(event: string, listener: () => void) {
    ;(this.listeners[event] ??= []).push(listener)
    return this
  }
  once(event: string, listener: () => void) {
    return this.on(event, listener)
  }
  end(chunk?: string | Uint8Array) {
    if (chunk) this.write(chunk)
    this.headersSent = true
    const headers = new Headers()
    for (const [name, value] of this.headers) {
      for (const v of Array.isArray(value) ? value : [value]) headers.append(name, v)
    }
    const body = Buffer.concat(this.chunks)
    const empty = body.length === 0 || this.statusCode === 204 || this.statusCode === 304
    this.onDone(new Response(empty ? null : new Uint8Array(body), { status: this.statusCode, headers }))
    for (const listener of this.listeners['finish'] ?? []) listener()
    return this
  }
}

/**
 * Runs an Express-style middleware against a web `Request`.
 *
 * `downstream` runs your paid handler and returns its `Response`. It is only
 * called if the middleware calls `next()`, i.e. after a valid payment was
 * verified. Its response is written through the middleware's `res`, which is
 * what makes @x402/express settle the payment before anything is released, and
 * skip settlement when the handler answers with a 4xx/5xx.
 */
export async function runExpressMiddleware(
  middleware: (req: any, res: any, next: (err?: unknown) => unknown) => unknown,
  request: Request,
  downstream: () => Promise<Response>,
  options: { ip?: string; body?: unknown } = {},
): Promise<Response> {
  let finish!: (response: Response) => void
  const done = new Promise<Response>((resolve) => (finish = resolve))
  const res = new ShimResponse(finish)
  let failure: unknown

  await middleware(makeReq(request, options.ip, options.body), res, async (err?: unknown) => {
    if (err) {
      failure = err // the middleware re-raises a handler error through next(err)
      return
    }
    const response = await downstream()
    res.status(response.status)
    response.headers.forEach((value, key) => {
      if (key.toLowerCase() === 'set-cookie') return
      res.setHeader(key, value)
    })
    const cookies = response.headers.getSetCookie()
    if (cookies.length) res.setHeader('set-cookie', cookies)
    res.end(new Uint8Array(await response.arrayBuffer()))
  })

  if (failure) throw failure
  return done
}
