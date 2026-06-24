import { ORPCError, os } from '@orpc/server'
import { env } from 'cloudflare:workers'
import { z } from 'zod'

import {
  parseTranscriptMeta,
  transcriptNameFromKey,
} from '../transcripts/format'

const TRANSCRIPTS_PREFIX = 'transcripts/'

const transcriptKeyInput = z.object({
  key: z.string().min(1).startsWith(TRANSCRIPTS_PREFIX),
})

export type TranscriptFile = {
  key: string
  name: string
  size: number
  uploaded: string | null
  title: string
  videoId: string | null
  thumbnailUrl: string | null
  youtubeUrl: string | null
  publishedAt: string | null
  isShort: boolean | null
}

export const appRouter = {
  listTranscriptFiles: os.handler(async () => {
    // The cron-maintained index is the source of truth: it carries titles
    // resolved from the channel feed or oEmbed for keys that don't embed one.
    // Fall back to deriving straight from the bucket if the index is missing
    // or unreadable.
    const files = (await readIndexFiles()) ?? (await listFilesFromBucket())

    // Newest first — an archive reads best as a reverse-chronological feed.
    files.sort((a, b) => (b.publishedAt ?? b.name).localeCompare(a.publishedAt ?? a.name))

    return { files }
  }),

  getTranscriptFile: os.input(transcriptKeyInput).handler(async ({ input }) => {
    return getTranscript(input.key)
  }),
}

async function readIndexFiles(): Promise<Array<TranscriptFile> | null> {
  const object = await env.TRANSCRIPTS.get('index.json')

  if (!object) {
    return null
  }

  try {
    const data = (await object.json()) as { files?: Array<Record<string, unknown>> }

    if (!Array.isArray(data.files)) {
      return null
    }

    const files: Array<TranscriptFile> = []

    for (const entry of data.files) {
      const key = entry.key

      if (typeof key !== 'string' || !key.startsWith(TRANSCRIPTS_PREFIX)) {
        continue
      }

      const meta = parseTranscriptMeta(key)
      const videoId = (entry.videoId as string) ?? meta.videoId

      if (!videoId) {
        continue
      }

      const storedTitle = entry.title
      const title =
        typeof storedTitle === 'string' && storedTitle && storedTitle !== videoId
          ? storedTitle
          : meta.title

      files.push({
        key,
        name: typeof entry.name === 'string' ? entry.name : transcriptNameFromKey(key),
        size: typeof entry.size === 'number' ? entry.size : 0,
        uploaded: typeof entry.uploaded === 'string' ? entry.uploaded : null,
        title,
        videoId,
        thumbnailUrl: (entry.thumbnailUrl as string) ?? meta.thumbnailUrl,
        youtubeUrl: (entry.youtubeUrl as string) ?? meta.youtubeUrl,
        publishedAt: (entry.publishedAt as string) ?? meta.publishedAt,
        isShort: typeof entry.isShort === 'boolean' ? entry.isShort : null,
      })
    }

    return files.length > 0 ? files : null
  } catch {
    return null
  }
}

async function listFilesFromBucket(): Promise<Array<TranscriptFile>> {
  const files: Array<TranscriptFile> = []
  let cursor: string | undefined

  do {
    const page = await env.TRANSCRIPTS.list({
      cursor,
      limit: 1000,
      prefix: TRANSCRIPTS_PREFIX,
    })

    for (const object of page.objects) {
      const meta = parseTranscriptMeta(object.key)

      // Skip control files and stray/partial seed objects that have no
      // resolvable video id so they never render as broken cards.
      if (!meta.videoId || object.key.endsWith('/')) {
        continue
      }

      files.push({
        key: object.key,
        name: transcriptNameFromKey(object.key),
        size: object.size,
        uploaded: object.uploaded?.toISOString() ?? null,
        ...meta,
        // No index to probe against in this fallback; the UI infers from size.
        isShort: null,
      })
    }

    cursor = page.truncated ? page.cursor : undefined
  } while (cursor)

  return files
}

async function getTranscript(key: string) {
  const object = await env.TRANSCRIPTS.get(key)

  if (!object) {
    throw new ORPCError('NOT_FOUND', {
      message: 'Transcript not found',
    })
  }

  return {
    key,
    name: transcriptNameFromKey(key),
    size: object.size,
    text: await object.text(),
  }
}

export type AppRouter = typeof appRouter
