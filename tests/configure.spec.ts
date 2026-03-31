import { test } from '@japa/runner'
import { AppFactory } from '@adonisjs/application/factories'
import { EnvEditor } from '@adonisjs/env/editor'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

import { configure } from '../configure.js'

type ConfigureFixtureOutput = {
  envContents: string
  envExampleContents: string
  hasFile(relativePath: string): Promise<boolean>
  read(relativePath: string): Promise<string>
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath)
    return true
  } catch {
    return false
  }
}

async function seedEnvFiles(appRoot: string) {
  await fs.writeFile(path.join(appRoot, '.env'), 'APP_KEY=app-key\nNODE_ENV=test\n')
  await fs.writeFile(path.join(appRoot, '.env.example'), 'APP_KEY=app-key\nNODE_ENV=test\n')
}

async function mergeEnvVariables(
  appRoot: string,
  variables: Record<string, string | number | boolean>,
  omitFromExample: string[] = []
) {
  const editor = await EnvEditor.create(pathToFileURL(`${appRoot}/`))

  for (const [key, value] of Object.entries(variables)) {
    editor.add(key, value, omitFromExample.includes(key))
  }

  await editor.save()
}

async function runConfigureFixture(): Promise<ConfigureFixtureOutput> {
  const appRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'better-auth-configure-'))
  const app = new AppFactory().create(pathToFileURL(`${appRoot}/`))
  await app.init()

  await seedEnvFiles(appRoot)

  const command = {
    createCodemods: async () => ({
      makeUsingStub: async (root: string, stubPath: string, stubState: Record<string, unknown>) => {
        const stubs = await app.stubs.create()
        const stub = await stubs.build(stubPath, { source: root })
        return stub.generate({ force: true, ...stubState })
      },
      defineEnvVariables: async (
        variables: Record<string, string | number | boolean>,
        options?: { omitFromExample?: string[] }
      ) => {
        await mergeEnvVariables(appRoot, variables, options?.omitFromExample)
      },
    }),
  }

  await configure(command as never)

  return {
    envContents: await fs.readFile(path.join(appRoot, '.env'), 'utf8'),
    envExampleContents: await fs.readFile(path.join(appRoot, '.env.example'), 'utf8'),
    hasFile(relativePath: string) {
      return pathExists(path.join(appRoot, relativePath))
    },
    read(relativePath: string) {
      return fs.readFile(path.join(appRoot, relativePath), 'utf8')
    },
  }
}

test.group('configure hook', () => {
  test('publishes config and auth stubs', async ({ assert }) => {
    const output = await runConfigureFixture()

    assert.isTrue(await output.hasFile('config/better_auth.ts'))
    assert.isTrue(await output.hasFile('auth.ts'))
  })

  test('defines Better Auth env variables', async ({ assert }) => {
    const output = await runConfigureFixture()

    assert.include(output.envContents, 'APP_KEY=app-key')
    assert.include(output.envContents, 'NODE_ENV=test')
    assert.include(output.envContents, 'BETTER_AUTH_SECRET=Please generate a secure secret')
    assert.include(output.envContents, 'BETTER_AUTH_URL=http://localhost:3333')
    assert.include(output.envExampleContents, 'APP_KEY=app-key')
    assert.include(output.envExampleContents, 'NODE_ENV=test')
    assert.include(output.envExampleContents, 'BETTER_AUTH_SECRET=Please generate a secure secret')
    assert.include(output.envExampleContents, 'BETTER_AUTH_URL=http://localhost:3333')
  })

  test('writes the expected auth.ts and config/better_auth.ts contents', async ({ assert }) => {
    const output = await runConfigureFixture()
    const authContents = await output.read('auth.ts')
    const configContents = await output.read('config/better_auth.ts')

    assert.include(authContents, "import app from '@adonisjs/core/services/app'")
    assert.include(authContents, "import db from '@adonisjs/lucid/services/db'")
    assert.include(
      authContents,
      "import { betterAuth, type Auth, type BetterAuthOptions } from 'better-auth'"
    )
    assert.include(authContents, "import { lucidAdapter } from 'adonisjs-better-auth-adapter'")
    assert.include(authContents, "import betterAuthConfig from '#config/better_auth'")
    assert.include(authContents, 'const database = lucidAdapter({ client: db.connection() })')
    assert.include(authContents, 'type RuntimeBetterAuthOptions = BetterAuthOptions & {')
    assert.include(authContents, 'let auth: Auth<RuntimeBetterAuthOptions>')
    assert.include(authContents, 'await app.booted(async () =>')
    assert.include(authContents, 'database,')
    assert.include(authContents, 'export { auth }')

    assert.include(configContents, "import type { BetterAuthOptions } from 'better-auth'")
    assert.include(configContents, 'const betterAuthConfig: BetterAuthOptions = {')
    assert.include(configContents, 'secret: process.env.BETTER_AUTH_SECRET')
    assert.include(configContents, 'baseURL: process.env.BETTER_AUTH_URL')
    assert.include(configContents, 'emailAndPassword: {')
    assert.include(configContents, 'enabled: true')
    assert.include(configContents, 'export default betterAuthConfig')
  })
})
