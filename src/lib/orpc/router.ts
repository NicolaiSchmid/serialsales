import { ORPCError, os } from '@orpc/server'
import { env } from 'cloudflare:workers'
import { z } from 'zod'

const transcriptKeyInput = z.object({
  key: z.string().min(1),
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

const VIDEO_ID_PATTERN = /\[([A-Za-z0-9_-]{11})\]/
const DATE_PREFIX_PATTERN = /^(\d{4})(\d{2})(\d{2})\s*-\s*/

// The R2 objects are yt-dlp `.srt` files named
// `<date> - <title> [<videoId>].<lang>.srt`, so everything we need for a rich
// listing can be parsed from the key — no extra reads, no stored metadata.
function parseTranscriptName(name: string) {
  const base = name.replace(/\.(?:[\w-]+\.)?srt$/i, '')
  const videoId = base.match(VIDEO_ID_PATTERN)?.[1] ?? null

  let title = base
  let publishedAt: string | null = null

  const dateMatch = title.match(DATE_PREFIX_PATTERN)
  if (dateMatch) {
    publishedAt = `${dateMatch[1]}-${dateMatch[2]}-${dateMatch[3]}`
    title = title.slice(dateMatch[0].length)
  }

  title = title
    .replace(/\s*\[[A-Za-z0-9_-]{11}\]\s*$/, '')
    // yt-dlp substitutes fullwidth glyphs for characters illegal in filenames.
    .replace(/＂/g, '"')
    .replace(/＇/g, "'")
    .replace(/／/g, '/')
    .replace(/：/g, ':')
    .replace(/？/g, '?')
    .replace(/＊/g, '*')
    .trim()

  return {
    title: title || name,
    videoId,
    publishedAt,
    thumbnailUrl: videoId ? `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg` : null,
    youtubeUrl: videoId ? `https://www.youtube.com/watch?v=${videoId}` : null,
  }
}

export const appRouter = {
  listTranscriptFiles: os.handler(async () => {
    const files: Array<TranscriptFile> = []
    let cursor: string | undefined

    do {
      const page = await env.TRANSCRIPTS.list({ cursor, limit: 1000 })

      for (const object of page.objects) {
        if (object.key.endsWith('/')) {
          continue
        }

        const name = object.key.split('/').at(-1) ?? object.key

        files.push({
          key: object.key,
          name,
          size: object.size,
          uploaded: object.uploaded?.toISOString() ?? null,
          ...parseTranscriptName(name),
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
      name: input.key.split('/').at(-1) ?? input.key,
      size: object.size,
      text: await object.text(),
    }
  }),
}

export type AppRouter = typeof appRouter
