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

        files.push({
          key: object.key,
          name: object.key.split('/').at(-1) ?? object.key,
          size: object.size,
          uploaded: object.uploaded?.toISOString() ?? null,
        })
      }

      cursor = page.truncated ? page.cursor : undefined
    } while (cursor)

    files.sort((a, b) => a.name.localeCompare(b.name))

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
