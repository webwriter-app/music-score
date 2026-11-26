export const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

export async function until(condition: () => unknown, ms = 60000) {
  const end = performance.now() + ms
  while (performance.now() < end) {
    if (await condition()) return true
    await wait(50)
  }
  return false
}
