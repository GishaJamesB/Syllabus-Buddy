export type OnDeviceStatus = 'available' | 'downloading' | 'downloadable' | 'unavailable'

interface LanguageModelApi {
  availability(options?: object): Promise<'available' | 'downloading' | 'downloadable' | 'unavailable'>
}

function api(): LanguageModelApi | undefined {
  return (globalThis as { LanguageModel?: LanguageModelApi }).LanguageModel
}

export async function getOnDeviceStatus(): Promise<OnDeviceStatus> {
  const lm = api()
  if (!lm) return 'unavailable'
  try {
    return await lm.availability()
  } catch {
    return 'unavailable'
  }
}

export async function prepareOnDeviceModel(
  initialize: (onProgress: (p: number) => void) => Promise<void>,
  onProgress: (fraction: number) => void,
): Promise<OnDeviceStatus> {
  await initialize(onProgress)
  return getOnDeviceStatus()
}
