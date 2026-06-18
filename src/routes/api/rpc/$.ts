import { RPCHandler } from '@orpc/server/fetch'
import { createFileRoute } from '@tanstack/react-router'
import type {} from '@tanstack/react-start'

import { appRouter } from '../../../lib/orpc/router'

const handler = new RPCHandler(appRouter)

async function handleRpcRequest({ request }: { request: Request }) {
  const { matched, response } = await handler.handle(request, {
    prefix: '/api/rpc',
  })

  if (matched) {
    return response
  }

  return new Response('Not found', { status: 404 })
}

export const Route = createFileRoute('/api/rpc/$')({
  server: {
    handlers: {
      POST: handleRpcRequest,
    },
  },
})
