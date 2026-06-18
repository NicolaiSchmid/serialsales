import startWorker from '@tanstack/react-start/server-entry'

import {
  handlePostHogProxy,
  isPostHogProxyRequest,
} from './lib/analytics/posthog-proxy'
import { syncTranscripts } from './lib/transcripts/sync'

export default {
  fetch(request, _env, ctx) {
    if (isPostHogProxyRequest(new URL(request.url))) {
      return handlePostHogProxy(request, ctx)
    }
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
