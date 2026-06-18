import { createORPCClient } from '@orpc/client'
import { RPCLink } from '@orpc/client/fetch'
import type { RouterClient } from '@orpc/server'

import type { AppRouter } from './router'

const link = new RPCLink({
  url: `${globalThis.location?.origin ?? 'http://localhost:3000'}/api/rpc`,
})

export const orpc: RouterClient<AppRouter> = createORPCClient(link)
