import type { TranscriptArtifact, YouTubeVideo } from './types'
import {
  parseTranscriptMeta,
  transcriptKeyForVideo,
  transcriptNameFromKey,
  transcriptTextToSrt,
  videoIdFromTranscriptKey,
} from './format'
import {
  fetchLatestChannelVideos,
  fetchVideoTitle,
  fetchVideoTranscript,
} from './youtube'

const TRANSCRIPTS_PREFIX = 'transcripts/'
const VIDEOS_PREFIX = 'videos/'
const FAILURES_PREFIX = 'failures/'
const MAX_FAILURE_AGE_MS = 24 * 60 * 60 * 1000
// Cap oEmbed title lookups per run to stay well within subrequest limits;
// resolved titles are cached in index.json, so this only matters until the
// archive is fully resolved.
const MAX_TITLE_LOOKUPS = 60

type SyncOptions = {
  cron?: string
  maxDownloads?: number
  reason: 'scheduled' | 'manual'
}

type FailureRecord = {
  video: YouTubeVideo
  failedAt: string
  reason: string
  status: 'error' | 'no_captions'
}

type IndexEntry = {
  key: string
  name: string
  size: number
  uploaded: string | null
  videoId: string
  title: string
  publishedAt: string | null
  thumbnailUrl: string | null
  youtubeUrl: string | null
}

type SyncResult = {
  checkedAt: string
  cron: string | null
  reason: SyncOptions['reason']
  totalVideos: number
  existingTranscripts: number
  queued: Array<{ id: string; title: string }>
  downloaded: Array<{ id: string; key: string }>
  skipped: Array<{ id: string; reason: string }>
  failed: Array<{ id: string; reason: string }>
}

export async function syncTranscripts(
  bucket: R2Bucket,
  options: SyncOptions,
): Promise<SyncResult> {
  const checkedAt = new Date().toISOString()
  const videos = await fetchLatestChannelVideos()
  const existingIds = await listExistingTranscriptIds(bucket)
  const queue = await buildDownloadQueue(bucket, videos, existingIds)
  const queued = queue.slice(0, options.maxDownloads ?? 10)
  const result: SyncResult = {
    checkedAt,
    cron: options.cron ?? null,
    reason: options.reason,
    totalVideos: videos.length,
    existingTranscripts: existingIds.size,
    queued: queued.map((video) => ({ id: video.id, title: video.title })),
    downloaded: [],
    skipped: [],
    failed: [],
  }

  await putJson(bucket, 'sync/queue.json', {
    checkedAt,
    videos: queue.map((video) => ({ id: video.id, title: video.title })),
  })

  for (const video of queued) {
    try {
      const transcript = await fetchVideoTranscript(video.id)

      if (transcript.status === 'no_captions') {
        result.skipped.push({ id: video.id, reason: transcript.reason })
        await putFailure(bucket, video, transcript.reason, 'no_captions')
        continue
      }

      const key = transcriptKeyForVideo(video, transcript.language)
      const artifact: TranscriptArtifact = {
        video,
        language: transcript.language,
        fetchedAt: new Date().toISOString(),
        segments: transcript.segments,
      }

      await bucket.put(key, transcriptTextToSrt(transcript.segments), {
        httpMetadata: { contentType: 'text/plain; charset=utf-8' },
        customMetadata: {
          videoId: video.id,
          language: transcript.language,
          source: 'youtube-captions',
        },
      })
      await putJson(bucket, `${VIDEOS_PREFIX}${video.id}.json`, artifact)
      await bucket.delete(`${FAILURES_PREFIX}${video.id}.json`)

      existingIds.add(video.id)
      result.downloaded.push({ id: video.id, key })
    } catch (cause) {
      const reason = cause instanceof Error ? cause.message : String(cause)

      result.failed.push({ id: video.id, reason })
      await putFailure(bucket, video, reason, 'error')
    }
  }

  await writeTranscriptIndex(bucket, checkedAt, videos)
  await putJson(bucket, 'sync/latest.json', result)

  return result
}

async function buildDownloadQueue(
  bucket: R2Bucket,
  videos: Array<YouTubeVideo>,
  existingIds: Set<string>,
) {
  const queue: Array<YouTubeVideo> = []

  for (const video of videos) {
    if (!video.id || existingIds.has(video.id)) {
      continue
    }

    if (await hasRecentFailure(bucket, video.id)) {
      continue
    }

    queue.push(video)
  }

  return queue
}

async function listExistingTranscriptIds(bucket: R2Bucket) {
  const ids = new Set<string>()
  let cursor: string | undefined

  do {
    const page = await bucket.list({
      cursor,
      limit: 1000,
      prefix: TRANSCRIPTS_PREFIX,
    })

    for (const object of page.objects) {
      const id =
        object.customMetadata?.videoId ?? videoIdFromTranscriptKey(object.key)

      if (id) {
        ids.add(id)
      }
    }

    cursor = page.truncated ? page.cursor : undefined
  } while (cursor)

  return ids
}

async function hasRecentFailure(bucket: R2Bucket, videoId: string) {
  const object = await bucket.get(`${FAILURES_PREFIX}${videoId}.json`)

  if (!object) {
    return false
  }

  const failure = (await object.json()) as FailureRecord
  const failedAt = Date.parse(failure.failedAt)

  return Number.isFinite(failedAt) && Date.now() - failedAt < MAX_FAILURE_AGE_MS
}

async function putFailure(
  bucket: R2Bucket,
  video: YouTubeVideo,
  reason: string,
  status: FailureRecord['status'],
) {
  await putJson(bucket, `${FAILURES_PREFIX}${video.id}.json`, {
    failedAt: new Date().toISOString(),
    reason,
    status,
    video,
  } satisfies FailureRecord)
}

// The index is the UI's source of truth, so it carries the full display
// metadata (title, publication date, thumbnail) for every transcript. Titles
// come from the key when present; for `<date>-<id>` seed keys with no embedded
// title we resolve it via oEmbed and cache the result back into index.json, so
// each id is looked up at most once. Titles from the channel feed are preferred
// when available — they are free, authoritative, and cover the latest ~15
// videos, so the newest entries never wait on the rate-limited lookup queue.
// Entries without a resolvable video id — stray/partial seed objects — are
// dropped so they never render as broken cards.
async function writeTranscriptIndex(
  bucket: R2Bucket,
  generatedAt: string,
  videos: Array<YouTubeVideo>,
) {
  const titleCache = await readIndexTitleCache(bucket)
  // The channel feed carries real titles for the latest ~15 videos. Prefer them
  // for seed keys with no embedded title, so the newest entries never need a
  // per-video lookup and the InnerTube fallback only covers the older backlog.
  const feedTitles = new Map<string, string>()

  for (const video of videos) {
    if (video.id && video.title && video.title !== video.id) {
      feedTitles.set(video.id, video.title)
    }
  }

  const pending: Array<{ entry: IndexEntry; needsTitle: boolean }> = []
  let cursor: string | undefined

  do {
    const page = await bucket.list({
      cursor,
      limit: 1000,
      prefix: TRANSCRIPTS_PREFIX,
    })

    for (const object of page.objects) {
      const meta = parseTranscriptMeta(object.key)
      const videoId = object.customMetadata?.videoId ?? meta.videoId

      if (!videoId) {
        continue
      }

      // A title that equals the id means the key had no human-readable title.
      const titleFromKey = meta.title !== videoId
      const feedTitle = feedTitles.get(videoId)
      const cached = titleCache.get(videoId)

      pending.push({
        entry: {
          key: object.key,
          name: transcriptNameFromKey(object.key),
          size: object.size,
          uploaded: object.uploaded?.toISOString() ?? null,
          videoId,
          title: titleFromKey
            ? meta.title
            : (feedTitle ?? cached ?? meta.title),
          publishedAt: meta.publishedAt,
          thumbnailUrl: meta.thumbnailUrl,
          youtubeUrl: meta.youtubeUrl,
        },
        needsTitle: !titleFromKey && !feedTitle && !cached,
      })
    }

    cursor = page.truncated ? page.cursor : undefined
  } while (cursor)

  let lookups = 0

  for (const item of pending) {
    if (!item.needsTitle || lookups >= MAX_TITLE_LOOKUPS) {
      continue
    }

    lookups += 1
    const resolved = await fetchVideoTitle(item.entry.videoId)

    if (resolved) {
      item.entry.title = resolved
    }
  }

  const files = pending.map((item) => item.entry)

  // Newest first — the archive reads as a reverse-chronological feed.
  files.sort((a, b) =>
    (b.publishedAt ?? b.name).localeCompare(a.publishedAt ?? a.name),
  )

  await putJson(bucket, 'index.json', {
    generatedAt,
    files,
  })
}

async function readIndexTitleCache(bucket: R2Bucket) {
  const cache = new Map<string, string>()
  const object = await bucket.get('index.json')

  if (!object) {
    return cache
  }

  try {
    const data = (await object.json()) as {
      files?: Array<{ videoId?: string; title?: string }>
    }

    for (const file of data.files ?? []) {
      if (
        file.videoId &&
        typeof file.title === 'string' &&
        file.title &&
        file.title !== file.videoId
      ) {
        cache.set(file.videoId, file.title)
      }
    }
  } catch {
    // A malformed index just means we re-resolve titles this run.
  }

  return cache
}

async function putJson(bucket: R2Bucket, key: string, value: unknown) {
  await bucket.put(key, `${JSON.stringify(value, null, 2)}\n`, {
    httpMetadata: { contentType: 'application/json; charset=utf-8' },
  })
}
