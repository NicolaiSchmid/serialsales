import startWorker from '@tanstack/react-start/server-entry'

import { syncTranscripts } from './lib/transcripts/sync'

export default {
  fetch(request) {
    return startWorker.fetch(request)
  },
  scheduled(controller, env, context) {
    context.waitUntil(
      syncTranscripts(env.TRANSCRIPTS, {
        cron: controller.cron,
        maxDownloads: 10,
        reason: 'scheduled',
      }),
    )
  },
} satisfies ExportedHandler<Env>
