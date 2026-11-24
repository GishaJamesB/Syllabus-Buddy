import { brainRow, useBrainStatus, type BuddyService } from '../ai/useBuddy'
import { card, softBtn } from './styles'

export function BrainStatus({ buddy }: { buddy: BuddyService }) {
  const status = useBrainStatus(buddy)
  const row = brainRow(status)
  const download = status.phase === 'ready' ? status.download : null

  return (
    <section className={`${card} space-y-3`} aria-labelledby="brain-heading">
      <h3 id="brain-heading" className="text-xl font-extrabold text-purple">
        Buddy's brain
      </h3>
      <p role="status" className="text-lg font-bold">
        {row.label}
      </p>
      {download !== null && (
        <progress className="w-full" max={1} value={download} aria-label="On-device Buddy download" />
      )}
      {'canDownload' in row && row.canDownload && (
        <button type="button" className={softBtn} onClick={() => void buddy.downloadDeviceModel()}>
          Get on-device Buddy
        </button>
      )}
    </section>
  )
}
