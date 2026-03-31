import { AppFactory } from '@adonisjs/application/factories'
import { EnvEditor } from '@adonisjs/env/editor'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

import { configure } from '../build/configure.js'

async function pathExists(filePath) {
  try {
    await fs.access(filePath)
    return true
  } catch {
    return false
  }
}

async function seedEnvFiles(appRoot) {
  await fs.writeFile(path.join(appRoot, '.env'), 'APP_KEY=app-key\n')
  await fs.writeFile(path.join(appRoot, '.env.example'), 'APP_KEY=app-key\n')
}

async function mergeEnvVariables(appRoot, variables, omitFromExample = []) {
  const editor = await EnvEditor.create(pathToFileURL(`${appRoot}/`))

  for (const [key, value] of Object.entries(variables)) {
    editor.add(key, value, omitFromExample.includes(key))
  }

  await editor.save()
}

async function main() {
  const appRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'better-auth-build-configure-'))
  const app = new AppFactory().create(pathToFileURL(`${appRoot}/`))
  await app.init()
  await seedEnvFiles(appRoot)

  const command = {
    createCodemods: async () => ({
      makeUsingStub: async (root, stubPath, stubState) => {
        const stubs = await app.stubs.create()
        const stub = await stubs.build(stubPath, { source: root })
        return stub.generate({ force: true, ...stubState })
      },
      defineEnvVariables: async (variables, options) => {
        await mergeEnvVariables(appRoot, variables, options?.omitFromExample)
      },
    }),
  }

  await configure(command)

  const authPath = path.join(appRoot, 'auth.ts')
  const configPath = path.join(appRoot, 'config', 'better_auth.ts')
  const envContents = await fs.readFile(path.join(appRoot, '.env'), 'utf8')
  const configContents = await fs.readFile(configPath, 'utf8')

  if (!(await pathExists(authPath))) {
    throw new Error('Build smoke failed: auth.ts was not generated from the built configure hook')
  }

  if (!(await pathExists(configPath))) {
    throw new Error(
      'Build smoke failed: config/better_auth.ts was not generated from the built configure hook'
    )
  }

  if (!envContents.includes('BETTER_AUTH_SECRET=Please generate a secure secret')) {
    throw new Error(
      'Build smoke failed: BETTER_AUTH_SECRET was not written by the built configure hook'
    )
  }

  if (!envContents.includes('BETTER_AUTH_URL=http://localhost:3333')) {
    throw new Error(
      'Build smoke failed: BETTER_AUTH_URL was not written by the built configure hook'
    )
  }

  if (!configContents.includes("import type { BetterAuthOptions } from 'better-auth'")) {
    throw new Error(
      'Build smoke failed: config/better_auth.ts did not use the typed Better Auth config import'
    )
  }

  if (!configContents.includes('const betterAuthConfig: BetterAuthOptions = {')) {
    throw new Error(
      'Build smoke failed: config/better_auth.ts did not declare a typed Better Auth config object'
    )
  }

  if (!configContents.includes('export default betterAuthConfig')) {
    throw new Error(
      'Build smoke failed: config/better_auth.ts did not export the typed Better Auth config object'
    )
  }
}

await main()
