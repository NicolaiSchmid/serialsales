import type { TranscriptSegment, YouTubeVideo } from './types'

export type TranscriptMeta = {
  videoId: string | null
  title: string
  publishedAt: string | null
  thumbnailUrl: string | null
  youtubeUrl: string | null
}

const DATE_PREFIX_PATTERN = /^(\d{4})(\d{2})(\d{2})\s*-\s*/

export function transcriptKeyForVideo(video: YouTubeVideo, language: string) {
  const date = (video.publishedAt ?? video.updatedAt ?? '').slice(0, 10)
  const datePrefix = date ? date.replaceAll('-', '') : 'undated'
  const title = sanitizeKeyPart(video.title || video.id)

  return `transcripts/${datePrefix} - ${title} [${video.id}].${language}.srt`
}

export function transcriptTextToSrt(segments: Array<TranscriptSegment>) {
  return `${segments
    .map((segment, index) => {
      const start = formatSrtTimestamp(segment.startMs)
      const end = formatSrtTimestamp(segment.startMs + segment.durationMs)

      return `${index + 1}\n${start} --> ${end}\n${segment.text}`
    })
    .join('\n\n')}\n`
}

export type CaptionLine = { startMs: number; text: string }

// YouTube auto (ASR) captions are delivered as a "rolling window": each spoken
// line is re-emitted across several overlapping cues so it can scroll up the
// screen, which makes a naive read repeat every line ~3 times. Walking the cue
// lines in order and dropping any line identical to the one just emitted
// reconstructs the spoken transcript exactly. Clean captions (e.g. our json3
// fetch) carry each line once, so this is a no-op for them.
export function captionLinesFromSrt(srt: string): Array<CaptionLine> {
  const blocks = srt.replace(/\r/g, '').trim().split(/\n\n+/)
  const lines: Array<CaptionLine> = []
  let previous: string | null = null

  for (const block of blocks) {
    const rows = block.split('\n')
    let index = /^\d+$/.test((rows[0] ?? '').trim()) ? 1 : 0
    const stamp = (rows[index] ?? '').match(
      /(\d{2}):(\d{2}):(\d{2})[,.](\d{3})\s*-->/,
    )
    // A line with no timestamp inherits the previous cue's start so it still
    // lands in the right place in the transcript.
    const startMs = stamp
      ? (Number(stamp[1]) * 3600 + Number(stamp[2]) * 60 + Number(stamp[3])) *
          1000 +
        Number(stamp[4])
      : (lines.at(-1)?.startMs ?? 0)

    if (stamp) {
      index += 1
    }

    for (const row of rows.slice(index)) {
      const text = row.replace(/\s+/g, ' ').trim()

      if (!text || text === previous) {
        continue
      }

      lines.push({ startMs, text })
      previous = text
    }
  }

  return lines
}

// Rewrites a (possibly rolling-window) SRT into a clean one with a single cue
// per spoken line. Each line keeps the start time of its first appearance and
// runs until the next line begins, so timings stay faithful to the source.
export function cleanSrt(srt: string): string {
  const lines = captionLinesFromSrt(srt)

  if (lines.length === 0) {
    return ''
  }

  return `${lines
    .map((line, index) => {
      const start = formatSrtTimestamp(line.startMs)
      const end = formatSrtTimestamp(
        Math.max(lines[index + 1]?.startMs ?? line.startMs + 4000, line.startMs),
      )

      return `${index + 1}\n${start} --> ${end}\n${line.text}`
    })
    .join('\n\n')}\n`
}

export function transcriptNameFromKey(key: string) {
  return key.split('/').at(-1) ?? key
}

export function videoIdFromTranscriptKey(key: string) {
  return (
    key.match(/\[([A-Za-z0-9_-]{6,})\]/)?.[1] ??
    key.match(/-([A-Za-z0-9_-]{11})\.en-orig\.srt$/)?.[1] ??
    null
  )
}

// Everything the UI needs — title, publication date, thumbnail — is encoded in
// the yt-dlp filename (`<YYYYMMDD> - <title> [<videoId>].<lang>.srt`) plus the
// video id. Deriving it here keeps a single source of truth shared by the cron
// index writer and the API, with no extra reads and no scraping.
export function parseTranscriptMeta(key: string): TranscriptMeta {
  const name = transcriptNameFromKey(key)
  const videoId = videoIdFromTranscriptKey(key)
  const base = name.replace(/\.(?:[\w-]+\.)?srt$/i, '')

  let title = base
  let publishedAt: string | null = null

  const dateMatch = title.match(DATE_PREFIX_PATTERN)
  if (dateMatch) {
    publishedAt = `${dateMatch[1]}-${dateMatch[2]}-${dateMatch[3]}`
    title = title.slice(dateMatch[0].length)
  }

  title = title
    .replace(/\s*\[[A-Za-z0-9_-]{6,}\]\s*$/, '')
    // yt-dlp substitutes fullwidth glyphs for characters illegal in filenames.
    .replace(/＂/g, '"')
    .replace(/＇/g, "'")
    .replace(/／/g, '/')
    .replace(/：/g, ':')
    .replace(/？/g, '?')
    .replace(/＊/g, '*')
    .trim()

  return {
    videoId,
    title: title || name,
    publishedAt,
    thumbnailUrl: videoId
      ? `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`
      : null,
    youtubeUrl: videoId ? `https://www.youtube.com/watch?v=${videoId}` : null,
  }
}

function sanitizeKeyPart(value: string) {
  return value
    .normalize('NFKD')
    .replace(/[^\w\s'.()$!-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120)
}

function formatSrtTimestamp(milliseconds: number) {
  const totalMs = Math.max(0, Math.round(milliseconds))
  const ms = totalMs % 1000
  const totalSeconds = Math.floor(totalMs / 1000)
  const seconds = totalSeconds % 60
  const totalMinutes = Math.floor(totalSeconds / 60)
  const minutes = totalMinutes % 60
  const hours = Math.floor(totalMinutes / 60)

  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)},${pad(ms, 3)}`
}

function pad(value: number, length = 2) {
  return value.toString().padStart(length, '0')
}
