# adonisjs-better-auth-adapter

Better Auth database adapter for AdonisJS Lucid.

It provides:

- a Lucid-backed Better Auth adapter
- Better Auth `createSchema` support
- a node ace configure hook that publishes starter files

## Status

- AdonisJS v7
- Node `>=24`
- Lucid is already installed and configured in the consumer app
- validated on fresh AdonisJS Hypermedia apps
- SQLite / `better-sqlite3` is the validated path today
- PostgreSQL is intended, but not currently covered by the same validation matrix

## Installation

```sh
npm install better-auth @adonisjs/lucid adonisjs-better-auth-adapter
node ace configure adonisjs-better-auth-adapter
```

The configure hook adds:

- `config/better_auth.ts`
- `auth.ts`
- `BETTER_AUTH_SECRET` and `BETTER_AUTH_URL` entries to `.env`
- `.env.example` entries for `BETTER_AUTH_SECRET` and `BETTER_AUTH_URL`

## Generated Files

`config/better_auth.ts`

```ts
import type { BetterAuthOptions } from 'better-auth'

const betterAuthConfig: BetterAuthOptions = {
  secret: process.env.BETTER_AUTH_SECRET,
  baseURL: process.env.BETTER_AUTH_URL,
  emailAndPassword: {
    enabled: true,
  },
}

export default betterAuthConfig
```

`auth.ts`

```ts
import app from '@adonisjs/core/services/app'
import db from '@adonisjs/lucid/services/db'
import { betterAuth, type Auth, type BetterAuthOptions } from 'better-auth'
import { lucidAdapter } from 'adonisjs-better-auth-adapter'
import betterAuthConfig from '#config/better_auth'

const database = lucidAdapter({ client: db.connection() })

type RuntimeBetterAuthOptions = BetterAuthOptions & {
  database: typeof database
}

let auth: Auth<RuntimeBetterAuthOptions>

await app.booted(async () => {
  auth = betterAuth({
    ...betterAuthConfig,
    database,
  })
})

export { auth }
```

## Runtime Integration

The generated `auth.ts` is meant for the booted Adonis runtime. For runtime requests, mount Better Auth behind an Adonis controller that creates a fresh Web `Request` for `auth.handler(...)`. Passing `request.request` directly through `toNodeHandler(...)` is not reliable once Adonis bodyparser has already consumed the stream.

Example controller (`app/controllers/better_auth_controller.ts`):

```ts
import type { HttpContext } from '@adonisjs/core/http'

export default class BetterAuthController {
  async handle({ request, response }: HttpContext) {
    const { auth } = await import('../../auth.js')

    const headers = new Headers()

    for (const [key, value] of Object.entries(request.headers())) {
      if (typeof value === 'string') {
        headers.set(key, value)
      }
    }

    const webRequest = new Request(request.completeUrl(true), {
      method: request.method(),
      headers,
      body:
        request.method() === 'GET' || request.method() === 'HEAD'
          ? undefined
          : JSON.stringify(request.all()),
    })

    const webResponse = await auth.handler(webRequest)

    response.status(webResponse.status)

    webResponse.headers.forEach((value, key) => {
      if (key.toLowerCase() !== 'set-cookie') {
        response.header(key, value)
      }
    })

    for (const cookie of webResponse.headers.getSetCookie()) {
      response.append('set-cookie', cookie)
    }

    response.send(await webResponse.text())
  }
}
```

Example route (`start/routes.ts`):

```ts
import BetterAuthController from '#controllers/better_auth_controller'
import router from '@adonisjs/core/services/router'

router.any('/api/auth/*', [BetterAuthController, 'handle'])
```

## Shield / CSRF Note

If your app uses Shield CSRF protection, exempt the Better Auth routes:

```ts
csrf: {
  enabled: true,
  exceptRoutes: ['/api/auth/*'],
}
```

Without this exemption, Shield intercepts Better Auth POST routes before they reach the auth handler.

## CLI Schema Generation

Better Auth CLI imports its target file directly. The generated runtime `auth.ts` depends on the booted Adonis container, so for schema generation you need a separate CLI-safe entrypoint.

Example `auth_cli.ts`:

```ts
import path from 'node:path'
import process from 'node:process'

import { Emitter } from '@adonisjs/core/events'
import { AppFactory } from '@adonisjs/core/factories/app'
import { LoggerFactory } from '@adonisjs/core/factories/logger'
import { defineConfig } from '@adonisjs/lucid'
import { Database } from '@adonisjs/lucid/database'
import { betterAuth } from 'better-auth'
import { lucidAdapter } from 'adonisjs-better-auth-adapter'

process.loadEnvFile(path.join(process.cwd(), '.env'))

const { default: betterAuthConfig } = await import('./config/better_auth.js')
const logger = new LoggerFactory().create()
const app = new AppFactory().create(new URL(`file://${process.cwd()}/`), () => {})
const emitter = new Emitter(app)

const db = new Database(
  defineConfig({
    connection: 'sqlite',
    connections: {
      sqlite: {
        client: 'better-sqlite3',
        connection: {
          filename: path.join(process.cwd(), 'tmp/db.sqlite3'),
        },
        useNullAsDefault: true,
      },
    },
  }),
  logger,
  emitter
)

export const auth = betterAuth({
  ...betterAuthConfig,
  database: lucidAdapter({ client: db.connection('sqlite') }),
})
```

Generate the migration:

```sh
npx @better-auth/cli@latest generate --config ./auth_cli.ts
```

The adapter writes a Lucid migration under `database/migrations` by default.

## Validated Consumer Flow

After generating the migration, the validated next steps are:

1. Apply the migration:

```sh
node ace migration:run
```

2. Mount the Better Auth route bridge at `/api/auth/*` using the controller and route shown in [Runtime Integration](#runtime-integration).

3. Exempt Better Auth routes from Shield CSRF as shown in [Shield / CSRF Note](#shield--csrf-note).

4. Prove the auth flow works end-to-end:

- `POST /api/auth/sign-up/email` — create a user with name, email, and password
- `POST /api/auth/sign-in/email` — log in using a separate cookie jar from signup
- `GET /api/auth/get-session` — confirm the session is authenticated
- Verify persisted user and session rows in SQLite

This flow was validated against fresh AdonisJS Hypermedia apps with SQLite / `better-sqlite3`.

## Model Name Collisions

Some Adonis starter kits already ship their own `users` table and generated schema types. To avoid collisions, add these model names to your Better Auth config:

```ts
user: {
  modelName: 'better_auth_user',
},
session: {
  modelName: 'better_auth_session',
},
account: {
  modelName: 'better_auth_account',
},
verification: {
  modelName: 'better_auth_verification',
}
```

## Verification

Useful commands while developing this package:

```sh
npm run lint
npm run typecheck
npm run quick:test
npm run contract:test
npm run build
```

## Troubleshooting

- If `node ace configure adonisjs-better-auth-adapter` fails with a module/import error, verify the package was installed from a fresh tarball or registry publish and that better-auth, `adonisjs-better-auth-adapter`, and `@opentelemetry/api` resolve in the consumer app.
- Better Auth CLI must use `auth_cli.ts`, not runtime `auth.ts`, because the runtime file depends on the booted Adonis container.
- Better Auth POST routes need CSRF exemption when Shield is enabled.
- Passing `request.request` directly through `toNodeHandler(...)` is not reliable after Adonis bodyparser has consumed the stream — use `auth.handler(webRequest)` with a reconstructed Web `Request` instead.
- name collisions with starter app auth tables/types can be resolved by configuring explicit `modelName` values as shown in [Model Name Collisions](#model-name-collisions).
