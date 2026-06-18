import { createFileRoute } from '@tanstack/react-router'
import { zipSync } from 'fflate'
import { useEffect, useMemo, useState } from 'react'

import { orpc } from '../lib/orpc/client'
import type { TranscriptFile } from '../lib/orpc/router'

export const Route = createFileRoute('/')({
  component: Home,
})

function Home() {
  const [files, setFiles] = useState<Array<TranscriptFile>>([])
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set())
  const [activeKey, setActiveKey] = useState<string | null>(null)
  const [activeText, setActiveText] = useState('')
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

  const filteredFiles = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase()

    if (!normalizedQuery) {
      return files
    }

    return files.filter((file) => file.name.toLowerCase().includes(normalizedQuery))
  }, [files, query])

  const selectedFiles = useMemo(
    () => files.filter((file) => selectedKeys.has(file.key)),
    [files, selectedKeys],
  )

  async function openTranscript(file: TranscriptFile) {
    setActiveKey(file.key)
    setActiveText('Loading transcript...')

    try {
      const transcript = await orpc.getTranscriptFile({ key: file.key })
      setActiveText(transcript.text)
    } catch (cause) {
      setActiveText(
        `Could not load transcript: ${cause instanceof Error ? cause.message : String(cause)}`,
      )
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

  function selectVisible() {
    setSelectedKeys(new Set(filteredFiles.map((file) => file.key)))
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
      const blob = new Blob([zipped], { type: 'application/zip' })
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')

      link.href = url
      link.download = 'serialsales-transcripts.zip'
      link.click()
      URL.revokeObjectURL(url)
    } finally {
      setIsDownloading(false)
    }
  }

  async function downloadSingle(file: TranscriptFile) {
    const transcript = await orpc.getTranscriptFile({ key: file.key })
    const blob = new Blob([transcript.text], { type: 'text/plain;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')

    link.href = url
    link.download = file.name
    link.click()
    URL.revokeObjectURL(url)
  }

  return (
    <main className="app-shell">
      <section className="masthead">
        <p className="eyebrow">Serial Sales</p>
        <h1>Transcript Archive</h1>
        <div className="search-bar">
          <input
            aria-label="Filter transcript files"
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Filter transcript files"
            type="search"
            value={query}
          />
          <span>{filteredFiles.length} files</span>
        </div>
      </section>

      <section className="toolbar" aria-label="Transcript actions">
        <button type="button" onClick={selectVisible} disabled={filteredFiles.length === 0}>
          Select visible
        </button>
        <button type="button" onClick={clearSelected} disabled={selectedKeys.size === 0}>
          Clear
        </button>
        <button
          type="button"
          onClick={() => void downloadZip(selectedFiles)}
          disabled={selectedFiles.length === 0 || isDownloading}
        >
          Download selected
        </button>
        <button
          type="button"
          onClick={() => void downloadZip(filteredFiles)}
          disabled={filteredFiles.length === 0 || isDownloading}
        >
          Download all visible
        </button>
      </section>

      {error ? <p className="notice error">{error}</p> : null}
      {isLoading ? <p className="notice">Loading transcripts...</p> : null}

      <section className="workspace">
        <div className="file-list" aria-label="Transcript files">
          {filteredFiles.map((file) => (
            <article key={file.key} className="file-row">
              <input
                aria-label={`Select ${file.name}`}
                checked={selectedKeys.has(file.key)}
                onChange={() => toggleSelected(file.key)}
                type="checkbox"
              />
              <button type="button" onClick={() => void openTranscript(file)}>
                <span>{file.name}</span>
                <small>{formatBytes(file.size)}</small>
              </button>
              <button type="button" onClick={() => void downloadSingle(file)}>
                Download
              </button>
            </article>
          ))}
          {!isLoading && filteredFiles.length === 0 ? (
            <p className="empty-state">No transcript files found in R2 yet.</p>
          ) : null}
        </div>

        <aside className="preview" aria-label="Transcript preview">
          <header>
            <span>Preview</span>
            {activeKey ? (
              <button
                type="button"
                onClick={() => {
                  const file = files.find((item) => item.key === activeKey)

                  if (file) {
                    void downloadSingle(file)
                  }
                }}
              >
                Download
              </button>
            ) : null}
          </header>
          <pre>{activeText || 'Select a transcript to preview it.'}</pre>
        </aside>
      </section>
    </main>
  )
}

function formatBytes(bytes: number) {
  if (bytes < 1024) {
    return `${bytes} B`
  }

  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`
  }

  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}
