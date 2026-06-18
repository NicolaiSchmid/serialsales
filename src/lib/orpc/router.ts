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
}

export const appRouter = {
  listTranscriptFiles: os.handler(async () => {
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
        })
      }

      cursor = page.truncated ? page.cursor : undefined
    } while (cursor)

    // Newest first — an archive reads best as a reverse-chronological feed.
    files.sort((a, b) => (b.publishedAt ?? b.name).localeCompare(a.publishedAt ?? a.name))

    return { files }
  }),

  getTranscriptFile: os.input(transcriptKeyInput).handler(async ({ input }) => {
    const object = await env.TRANSCRIPTS.get(input.key)

    if (!object) {
      throw new ORPCError('NOT_FOUND', {
        message: 'Transcript not found',
      })
    }

    return {
      key: input.key,
      name: transcriptNameFromKey(input.key),
      size: object.size,
      text: await object.text(),
    }
  }),
}

export type AppRouter = typeof appRouter
