export type VoiceGateResult<T> = { ran: true; value: T } | { ran: false }

/**
 * One voice turn per worker. While one client (a browser tab) has a request running or waiting,
 * its further requests wait their turn, and every other client is turned away (`voice.busy`).
 *
 * The same client must wait rather than be turned away: a new press cancels the reply that is
 * still speaking, and that reply only stops after its current sentence.
 *
 * Invariants:
 * - At most one request runs at a time.
 * - The gate is free again once the owning client has nothing running or waiting, also on failure.
 */
export class VoiceRequestGate {
  private owner: string | null = null
  private inFlight = 0
  private tail: Promise<unknown> = Promise.resolve()

  public async run<T>(clientId: string, task: () => Promise<T>): Promise<VoiceGateResult<T>> {
    if (this.owner !== null && this.owner !== clientId) {
      return { ran: false }
    }
    this.owner = clientId
    this.inFlight += 1

    const previous = this.tail
    const current = previous.catch(() => undefined).then(task)
    this.tail = current
    try {
      return { ran: true, value: await current }
    } finally {
      this.inFlight -= 1
      if (this.inFlight === 0) {
        this.owner = null
      }
    }
  }
}
