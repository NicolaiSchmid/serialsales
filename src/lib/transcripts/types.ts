export type YouTubeVideo = {
  id: string
  title: string
  url: string
  publishedAt: string | null
  updatedAt: string | null
  thumbnailUrl: string | null
}

export type TranscriptSegment = {
  startMs: number
  durationMs: number
  text: string
}

export type TranscriptArtifact = {
  video: YouTubeVideo
  language: string
  fetchedAt: string
  segments: Array<TranscriptSegment>
}

export type CaptionFetchResult =
  | {
      status: 'ok'
      language: string
      segments: Array<TranscriptSegment>
    }
  | {
      status: 'no_captions'
      reason: string
    }
