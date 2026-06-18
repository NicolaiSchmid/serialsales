import { createFileRoute } from '@tanstack/react-router'
import { zipSync } from 'fflate'
import { usePostHog } from '@posthog/react'
import { useEffect, useMemo, useState } from 'react'

import { captionLinesFromSrt } from '../lib/transcripts/format'
import { orpc } from '../lib/orpc/client'
import type { TranscriptFile } from '../lib/orpc/router'

export const Route = createFileRoute('/')({
  component: Home,
})

type Paragraph = {
  start: string | null
  text: string
}

function Home() {
  const posthog = usePostHog()
  const [files, setFiles] = useState<Array<TranscriptFile>>([])
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set())
  const [activeFile, setActiveFile] = useState<TranscriptFile | null>(null)
  const [paragraphs, setParagraphs] = useState<Array<Paragraph>>([])
  const [previewState, setPreviewState] = useState<'idle' | 'loading' | 'error'>('idle')
  const [isLoading, setIsLoading] = useState(true)
  const [isDownloading, setIsDownloading] = useState(false)
  const [query, setQuery] = useState('')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let isMounted = true

    async function loadFiles() {
      try {
        const data = await orpc.listTranscriptFiles()

        if (isMounted) {
          setFiles(data.files)
        }
      } catch (cause) {
        if (isMounted) {
          setError(cause instanceof Error ? cause.message : String(cause))
        }
      } finally {
        if (isMounted) {
          setIsLoading(false)
        }
      }
    }

    void loadFiles()

    return () => {
      isMounted = false
    }
  }, [])

  // Close the drawer with Escape and lock background scroll while it is open.
  useEffect(() => {
    if (!activeFile) {
      return
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setActiveFile(null)
      }
    }

    document.addEventListener('keydown', onKeyDown)
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    return () => {
      document.removeEventListener('keydown', onKeyDown)
      document.body.style.overflow = previousOverflow
    }
  }, [activeFile])

  // Capture a search only once the query settles, so a single live search
  // ("episode") records one event instead of one per keystroke.
  useEffect(() => {
    const normalizedQuery = query.trim()

    if (normalizedQuery.length < 3) {
      return
    }

    const timeout = setTimeout(() => {
      posthog.capture('search_performed', { query: normalizedQuery })
    }, 600)

    return () => clearTimeout(timeout)
  }, [query, posthog])

  const filteredFiles = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase()

    if (!normalizedQuery) {
      return files
    }

    return files.filter((file) => file.title.toLowerCase().includes(normalizedQuery))
  }, [files, query])

  const selectedFiles = useMemo(
    () => files.filter((file) => selectedKeys.has(file.key)),
    [files, selectedKeys],
  )

  async function openTranscript(file: TranscriptFile) {
    setActiveFile(file)
    setParagraphs([])
    setPreviewState('loading')
    posthog.capture('transcript_opened', {
      key: file.key,
      title: file.title,
      video_id: file.videoId,
    })

    try {
      const transcript = await orpc.getTranscriptFile({ key: file.key })
      setParagraphs(srtToParagraphs(transcript.text))
      setPreviewState('idle')
    } catch (cause) {
      setPreviewState('error')
      posthog.captureException(cause instanceof Error ? cause : new Error(String(cause)), {
        key: file.key,
      })
    }
  }

  function toggleSelected(key: string) {
    setSelectedKeys((current) => {
      const next = new Set(current)

      if (next.has(key)) {
        next.delete(key)
      } else {
        next.add(key)
      }

      return next
    })
  }

  function clearSelected() {
    setSelectedKeys(new Set())
  }

  async function downloadZip(filesToDownload: Array<TranscriptFile>) {
    if (filesToDownload.length === 0) {
      return
    }

    setIsDownloading(true)

    try {
      const entries: Record<string, Uint8Array> = {}

      for (const file of filesToDownload) {
        const transcript = await orpc.getTranscriptFile({ key: file.key })

        entries[file.name] = new TextEncoder().encode(transcript.text)
      }

      const zipped = zipSync(entries, { level: 6 })

      triggerDownload(new Blob([zipped], { type: 'application/zip' }), 'serialsales-transcripts.zip')
      posthog.capture('transcripts_bulk_downloaded', {
        count: filesToDownload.length,
        is_filtered: filesToDownload.length !== files.length,
      })
    } finally {
      setIsDownloading(false)
    }
  }

  async function downloadSingle(file: TranscriptFile) {
    const transcript = await orpc.getTranscriptFile({ key: file.key })

    triggerDownload(
      new Blob([transcript.text], { type: 'text/plain;charset=utf-8' }),
      file.name,
    )
    posthog.capture('transcript_downloaded', {
      key: file.key,
      title: file.title,
      video_id: file.videoId,
    })
  }

  return (
    <>
      <main className="app-shell">
        <header className="masthead">
          <p className="eyebrow">Serial Sales</p>
          <h1>Transcript Archive</h1>
          <p className="lede">
            Every episode, transcribed and searchable.
            {files.length > 0 ? ` ${files.length} transcripts and counting.` : ''}
          </p>
        </header>

        <div className="controls">
          <label className="search">
            <SearchIcon />
            <input
              aria-label="Search transcripts"
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search transcripts"
              type="search"
              value={query}
            />
            {query ? (
              <button aria-label="Clear search" onClick={() => setQuery('')} type="button">
                <CloseIcon />
              </button>
            ) : null}
          </label>

          <div className="controls-meta">
            <span className="count">
              {filteredFiles.length}
              {filteredFiles.length === files.length ? '' : ` / ${files.length}`} shown
            </span>
            <button
              className="btn"
              disabled={filteredFiles.length === 0 || isDownloading}
              onClick={() => void downloadZip(filteredFiles)}
              type="button"
            >
              {isDownloading ? 'Preparing…' : 'Download all'}
            </button>
          </div>
        </div>

        {error ? <p className="notice error">{error}</p> : null}

        {isLoading ? (
          <div className="grid" aria-hidden>
            {Array.from({ length: 8 }).map((_, index) => (
              <div className="card card--skeleton" key={index}>
                <div className="thumb" />
                <div className="card-body">
                  <div className="skeleton-line" />
                  <div className="skeleton-line skeleton-line--short" />
                </div>
              </div>
            ))}
          </div>
        ) : filteredFiles.length === 0 ? (
          <div className="empty-state">
            <p>{files.length === 0 ? 'No transcripts in the archive yet.' : 'No transcripts match your search.'}</p>
          </div>
        ) : (
          <div className="grid">
            {filteredFiles.map((file) => {
              const isSelected = selectedKeys.has(file.key)

              return (
                <article className={`card${isSelected ? ' card--selected' : ''}`} key={file.key}>
                  <button
                    className="thumb"
                    onClick={() => void openTranscript(file)}
                    type="button"
                  >
                    {file.thumbnailUrl ? (
                      <img
                        alt=""
                        loading="lazy"
                        onError={(event) => {
                          event.currentTarget.style.visibility = 'hidden'
                        }}
                        src={file.thumbnailUrl}
                      />
                    ) : (
                      <span className="thumb-fallback">SRT</span>
                    )}
                  </button>

                  <label
                    className="card-check"
                    onClick={(event) => event.stopPropagation()}
                  >
                    <input
                      aria-label={`Select ${file.title}`}
                      checked={isSelected}
                      onChange={() => toggleSelected(file.key)}
                      type="checkbox"
                    />
                    <CheckIcon />
                  </label>

                  <div className="card-body">
                    <button
                      className="card-title"
                      onClick={() => void openTranscript(file)}
                      type="button"
                    >
                      {file.title}
                    </button>
                    <div className="card-meta">
                      <span>{formatDate(file.publishedAt)}</span>
                      {file.youtubeUrl ? (
                        <a
                          href={file.youtubeUrl}
                          onClick={() => posthog.capture('youtube_link_opened', { key: file.key, title: file.title, source: 'card' })}
                          rel="noreferrer"
                          target="_blank"
                        >
                          YouTube
                        </a>
                      ) : null}
                    </div>
                  </div>
                </article>
              )
            })}
          </div>
        )}
      </main>

      {selectedFiles.length > 0 ? (
        <div className="bulkbar" role="status">
          <span>{selectedFiles.length} selected</span>
          <div className="bulkbar-actions">
            <button className="btn btn--ghost" onClick={clearSelected} type="button">
              Clear
            </button>
            <button
              className="btn"
              disabled={isDownloading}
              onClick={() => void downloadZip(selectedFiles)}
              type="button"
            >
              {isDownloading ? 'Preparing…' : 'Download selected'}
            </button>
          </div>
        </div>
      ) : null}

      <div
        className={`drawer-root${activeFile ? ' drawer-root--open' : ''}`}
        aria-hidden={activeFile ? undefined : true}
      >
        <button
          className="drawer-scrim"
          aria-label="Close transcript"
          onClick={() => setActiveFile(null)}
          tabIndex={activeFile ? 0 : -1}
          type="button"
        />
        <aside className="drawer" aria-label="Transcript">
          {activeFile ? (
            <>
              <header className="drawer-head">
                <div className="drawer-head-text">
                  <p className="eyebrow">{formatDate(activeFile.publishedAt)}</p>
                  <h2>{activeFile.title}</h2>
                </div>
                <button
                  className="icon-btn"
                  aria-label="Close"
                  onClick={() => setActiveFile(null)}
                  type="button"
                >
                  <CloseIcon />
                </button>
              </header>

              <div className="drawer-actions">
                {activeFile.youtubeUrl ? (
                  <a
                    className="btn btn--ghost"
                    href={activeFile.youtubeUrl}
                    onClick={() => posthog.capture('youtube_link_opened', { key: activeFile.key, title: activeFile.title, source: 'drawer' })}
                    rel="noreferrer"
                    target="_blank"
                  >
                    Watch on YouTube
                  </a>
                ) : null}
                <button
                  className="btn btn--ghost"
                  onClick={() => activeFile && void downloadSingle(activeFile)}
                  type="button"
                >
                  Download .srt
                </button>
              </div>

              <div className="transcript">
                {previewState === 'loading' ? (
                  <p className="muted">Loading transcript…</p>
                ) : previewState === 'error' ? (
                  <p className="muted">Could not load this transcript. Try again.</p>
                ) : paragraphs.length === 0 ? (
                  <p className="muted">This transcript is empty.</p>
                ) : (
                  paragraphs.map((paragraph, index) => (
                    <p key={index}>
                      {paragraph.start ? <span className="ts">{paragraph.start}</span> : null}
                      {paragraph.text}
                    </p>
                  ))
                )}
              </div>
            </>
          ) : null}
        </aside>
      </div>
    </>
  )
}

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')

  link.href = url
  link.download = filename
  link.click()
  URL.revokeObjectURL(url)
}

const DATE_FORMATTER = new Intl.DateTimeFormat('en-US', {
  year: 'numeric',
  month: 'short',
  day: 'numeric',
})

function formatDate(value: string | null) {
  if (!value) {
    return 'Undated'
  }

  const date = new Date(`${value}T00:00:00Z`)

  if (Number.isNaN(date.getTime())) {
    return 'Undated'
  }

  return DATE_FORMATTER.format(date)
}

// Parse SRT into readable paragraphs: drop the cue index and timestamp noise,
// group a handful of lines together, and keep a single faint mm:ss marker.
function srtToParagraphs(srt: string): Array<Paragraph> {
  // captionLinesFromSrt collapses YouTube's rolling-window duplication, so each
  // spoken line appears once regardless of how the stored SRT was generated.
  const lines = captionLinesFromSrt(srt)
  const paragraphs: Array<Paragraph> = []
  const linesPerParagraph = 5

  for (let i = 0; i < lines.length; i += linesPerParagraph) {
    const chunk = lines.slice(i, i + linesPerParagraph)

    paragraphs.push({
      start: formatClock(chunk[0]?.startMs ?? 0),
      text: chunk.map((line) => line.text).join(' '),
    })
  }

  return paragraphs
}

function formatClock(milliseconds: number): string {
  const totalSeconds = Math.floor(Math.max(0, milliseconds) / 1000)
  const seconds = totalSeconds % 60
  const minutes = Math.floor(totalSeconds / 60) % 60
  const hours = Math.floor(totalSeconds / 3600)
  const pad = (value: number) => value.toString().padStart(2, '0')

  return hours > 0
    ? `${hours}:${pad(minutes)}:${pad(seconds)}`
    : `${pad(minutes)}:${pad(seconds)}`
}

function SearchIcon() {
  return (
    <svg aria-hidden height="18" viewBox="0 0 24 24" width="18">
      <circle cx="11" cy="11" fill="none" r="7" stroke="currentColor" strokeWidth="2" />
      <line stroke="currentColor" strokeLinecap="round" strokeWidth="2" x1="16.5" x2="21" y1="16.5" y2="21" />
    </svg>
  )
}

function CloseIcon() {
  return (
    <svg aria-hidden height="18" viewBox="0 0 24 24" width="18">
      <line stroke="currentColor" strokeLinecap="round" strokeWidth="2" x1="6" x2="18" y1="6" y2="18" />
      <line stroke="currentColor" strokeLinecap="round" strokeWidth="2" x1="18" x2="6" y1="6" y2="18" />
    </svg>
  )
}

function CheckIcon() {
  return (
    <svg aria-hidden height="14" viewBox="0 0 24 24" width="14">
      <polyline
        fill="none"
        points="4 12.5 9.5 18 20 6"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="3"
      />
    </svg>
  )
}
