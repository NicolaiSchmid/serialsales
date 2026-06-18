import type {
  CaptionFetchResult,
  TranscriptSegment,
  YouTubeVideo,
} from './types'

const CHANNEL_FEED_URL =
  'https://www.youtube.com/feeds/videos.xml?channel_id=UCg_QbbJdZQo55Ur4SbunBJw'

const INNERTUBE_ENDPOINT =
  'https://youtubei.googleapis.com/youtubei/v1/player?prettyPrint=false'

const CLIENT_PROFILES = [
  {
    clientName: 'IOS',
    clientVersion: '20.10.4',
    clientNameHeader: '5',
    userAgent:
      'com.google.ios.youtube/20.10.4 (iPhone16,2; U; CPU iOS 18_3_2 like Mac OS X;)',
    context: {
      deviceMake: 'Apple',
      deviceModel: 'iPhone16,2',
      platform: 'MOBILE',
      osName: 'iOS',
      osVersion: '18.3.2.22D82',
    },
  },
  {
    clientName: 'ANDROID_VR',
    clientVersion: '1.62.20',
    clientNameHeader: '28',
    userAgent:
      'com.google.android.apps.youtube.vr.oculus/1.62.20 (Linux; U; Android 12L; eureka-user Build/SQ3A.220605.009.A1) gzip',
    context: {
      deviceMake: 'Oculus',
      deviceModel: 'Quest 3',
      platform: 'MOBILE',
      osName: 'Android',
      osVersion: '12L',
      androidSdkVersion: 32,
    },
  },
]

type CaptionTrack = {
  baseUrl?: string
  languageCode?: string
  vssId?: string
}

type Json3Response = {
  events?: Array<{
    tStartMs?: number
    dDurationMs?: number
    aAppend?: number
    segs?: Array<{ utf8?: string }>
  }>
}

export async function fetchLatestChannelVideos(
  fetchImpl: typeof fetch = fetch,
): Promise<Array<YouTubeVideo>> {
  const response = await fetchImpl(CHANNEL_FEED_URL)

  if (!response.ok) {
    throw new Error(`YouTube feed request failed: ${response.status}`)
  }

  const xml = await response.text()

  return [...xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)].map((entryMatch) => {
    const entry = entryMatch[1] ?? ''
    const id = readXmlTag(entry, 'yt:videoId') ?? ''

    return {
      id,
      title: decodeXml(readXmlTag(entry, 'title') ?? ''),
      url:
        readXmlAttribute(entry, 'link', 'href') ??
        `https://www.youtube.com/watch?v=${id}`,
      publishedAt: readXmlTag(entry, 'published'),
      updatedAt: readXmlTag(entry, 'updated'),
      thumbnailUrl: readXmlAttribute(entry, 'media:thumbnail', 'url'),
    }
  })
}

// Many seeded `.srt` keys carry only `<date>-<id>` with no human title, so we
// resolve it from YouTube's public oEmbed endpoint (no API key, no auth). The
// cron caches every result in index.json, so each id is fetched at most once.
export async function fetchVideoTitle(
  videoId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<string | null> {
  const endpoint = `https://www.youtube.com/oembed?url=${encodeURIComponent(
    `https://www.youtube.com/watch?v=${videoId}`,
  )}&format=json`

  try {
    const response = await fetchImpl(endpoint)

    if (!response.ok) {
      return null
    }

    const data = (await response.json()) as { title?: unknown }

    return typeof data.title === 'string' && data.title.trim()
      ? data.title.trim()
      : null
  } catch {
    return null
  }
}

export async function fetchVideoTranscript(
  videoId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<CaptionFetchResult> {
  const tracks = await fetchCaptionTracks(videoId, fetchImpl)
  const track = pickEnglishTrack(tracks)

  if (!track?.baseUrl) {
    return { status: 'no_captions', reason: 'No English caption track found' }
  }

  const url = new URL(track.baseUrl)
  url.searchParams.set('fmt', 'json3')

  const response = await fetchImpl(url.toString(), {
    headers: { 'User-Agent': CLIENT_PROFILES[0].userAgent },
  })

  if (!response.ok) {
    throw new Error(`Caption request failed: ${response.status}`)
  }

  const text = await response.text()

  if (!text.trim()) {
    return { status: 'no_captions', reason: 'Caption response was empty' }
  }

  const json = JSON.parse(text) as Json3Response
  const segments = parseJson3Segments(json)

  if (segments.length === 0) {
    return { status: 'no_captions', reason: 'Caption response had no text' }
  }

  return {
    status: 'ok',
    language: track.languageCode ?? 'en',
    segments,
  }
}

async function fetchCaptionTracks(
  videoId: string,
  fetchImpl: typeof fetch,
): Promise<Array<CaptionTrack>> {
  for (const client of CLIENT_PROFILES) {
    const response = await fetchImpl(INNERTUBE_ENDPOINT, {
      method: 'POST',
      headers: {
        Accept: '*/*',
        'Content-Type': 'application/json',
        Origin: 'https://www.youtube.com',
        'User-Agent': client.userAgent,
        'X-YouTube-Client-Name': client.clientNameHeader,
        'X-YouTube-Client-Version': client.clientVersion,
      },
      body: JSON.stringify({
        context: {
          client: {
            clientName: client.clientName,
            clientVersion: client.clientVersion,
            hl: 'en',
            gl: 'US',
            ...client.context,
          },
          user: { lockedSafetyMode: false },
          request: { useSsl: true },
        },
        videoId,
        contentCheckOk: true,
        racyCheckOk: true,
      }),
    })

    if (!response.ok) {
      continue
    }

    const data = (await response.json()) as {
      captions?: {
        playerCaptionsTracklistRenderer?: {
          captionTracks?: Array<CaptionTrack>
        }
      }
    }
    const tracks =
      data?.captions?.playerCaptionsTracklistRenderer?.captionTracks

    if (Array.isArray(tracks) && tracks.length > 0) {
      return tracks
    }
  }

  return []
}

function pickEnglishTrack(tracks: Array<CaptionTrack>) {
  return (
    tracks.find((track) => track.vssId === '.en') ??
    tracks.find((track) => track.vssId === 'a.en') ??
    tracks.find((track) => track.languageCode === 'en') ??
    tracks.find((track) => track.vssId?.includes('.en'))
  )
}

function parseJson3Segments(json: Json3Response): Array<TranscriptSegment> {
  return (
    (json.events ?? [])
      // `aAppend` events are the rolling-window newline pushes, not new speech.
      .filter((event) => event.segs && event.aAppend !== 1)
      .map((event) => ({
        startMs: event.tStartMs ?? 0,
        durationMs: event.dDurationMs ?? 0,
        text: decodeXml(
          event.segs
            ?.map((segment) => segment.utf8 ?? '')
            .join('')
            .replace(/<[^>]+>/g, '') ?? '',
        ).trim(),
      }))
      .filter((segment) => segment.text.length > 0)
      // Guard against rolling-window variants that re-emit a line verbatim: drop
      // any segment whose text repeats the one immediately before it.
      .filter(
        (segment, index, all) =>
          index === 0 || segment.text !== all[index - 1].text,
      )
  )
}

function readXmlTag(xml: string, tagName: string) {
  const escapedTag = tagName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = xml.match(new RegExp(`<${escapedTag}>([\\s\\S]*?)<\\/${escapedTag}>`))
  return match?.[1] ? decodeXml(match[1]) : null
}

function readXmlAttribute(xml: string, tagName: string, attrName: string) {
  const escapedTag = tagName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const escapedAttr = attrName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = xml.match(
    new RegExp(`<${escapedTag}\\b[^>]*\\s${escapedAttr}="([^"]+)"`),
  )

  return match?.[1] ? decodeXml(match[1]) : null
}

function decodeXml(value: string) {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex: string) =>
      String.fromCodePoint(Number.parseInt(hex, 16)),
    )
    .replace(/&#(\d+);/g, (_, dec: string) =>
      String.fromCodePoint(Number.parseInt(dec, 10)),
    )
}
