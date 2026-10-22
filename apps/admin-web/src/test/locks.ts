/**
 * PD-23 test helper: jsdom has no Web Locks API. This stand-in queues each
 * named lock FIFO, like the real exclusive lock.
 */
export function installFakeLocks() {
  const tails = new Map<string, Promise<unknown>>()
  const requested: string[] = []
  const locks = {
    request<T>(name: string, callback: () => Promise<T>): Promise<T> {
      requested.push(name)
      const prev = tails.get(name) ?? Promise.resolve()
      const run = prev.then(() => callback())
      tails.set(
        name,
        run.then(
          () => undefined,
          () => undefined,
        ),
      )
      return run
    },
  }
  Object.defineProperty(globalThis.navigator, 'locks', { value: locks, configurable: true })
  return { requested }
}

export function removeFakeLocks() {
  delete (globalThis.navigator as { locks?: unknown }).locks
}

