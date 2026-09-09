/** Invalid conversation input; HTTP translation belongs to the host. */
export class HarnessInputError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'HarnessInputError'
  }
}
export const badRequest = (message: string) => new HarnessInputError(message)
