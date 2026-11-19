// Calls into app.py. Every method on python's Api class is available as `await hostRpc.<name>(...args)`.
window.hostRpc = new Proxy(
  {},
  {
    get:
      (_, method) =>
      async (...args) => {
        const r = await fetch(`/api/${String(method)}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ args }),
        })
        const body = await r.json()
        if (!r.ok) throw new Error(body.error)
        return body.result
      },
  },
)
