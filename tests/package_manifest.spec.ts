import { test } from '@japa/runner'
import fs from 'node:fs/promises'

test.group('Package manifest runtime dependencies', () => {
  test('@opentelemetry/api is a runtime dependency', async ({ assert }) => {
    const raw = await fs.readFile(new URL('../package.json', import.meta.url), 'utf8')
    const pkg = JSON.parse(raw)

    assert.property(
      pkg.dependencies ?? {},
      '@opentelemetry/api',
      'Expected @opentelemetry/api in "dependencies" so consumers get it automatically. ' +
        'better-auth imports @better-auth/core/dist/instrumentation/tracer.mjs at runtime ' +
        'which requires @opentelemetry/api.'
    )

    assert.property(
      pkg.peerDependencies ?? {},
      '@opentelemetry/api',
      'Expected @opentelemetry/api in "peerDependencies" so stricter package managers ' +
        'surface the requirement at the app boundary instead of only through hoisting.'
    )
  })
})
