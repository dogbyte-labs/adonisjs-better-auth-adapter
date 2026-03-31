import { test } from '@japa/runner'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { getSchema } from 'better-auth/db'

import { renderLucidMigration } from '../src/schema_renderer.js'
import { createSchema } from '../src/create_schema.js'
import { lucidAdapter } from '../src/lucid_adapter.js'
import { createTestDatabase, makeBetterAuthOptions } from './helpers/lucid_test_harness.js'

let tmpDir: string

test.group('Schema renderer', () => {
  test('renders a lucid migration for Better Auth tables', ({ assert }) => {
    const output = renderLucidMigration({
      user: {
        modelName: 'app_user',
        fields: {
          id: { type: 'string', primaryKey: true },
          email: { type: 'string', unique: true },
          loginCount: { type: 'number', required: true, defaultValue: 0 },
          emailVerified: { type: 'boolean', required: true, defaultValue: false },
          profile: { type: 'json', required: false },
          lastSeenAt: { type: 'date', required: false },
          organizationId: {
            type: 'string',
            required: false,
            references: { model: 'organization', field: 'id' },
          },
        },
      },
    })

    assert.include(output, "this.schema.createTable('app_user'")
    assert.include(output, "table.string('id').notNullable().primary()")
    assert.include(output, "table.string('email').notNullable().unique()")
    assert.include(output, "table.integer('login_count').notNullable().defaultTo(0)")
    assert.include(output, "table.boolean('email_verified').notNullable().defaultTo(false)")
    assert.include(output, "table.json('profile').nullable()")
    assert.include(output, "table.timestamp('last_seen_at').nullable()")
    assert.include(output, "table.string('organization_id').nullable()")
    assert.include(output, "table.foreign('organization_id')")
  })

  test('skips tables marked with disableMigrations', ({ assert }) => {
    const output = renderLucidMigration({
      session: {
        modelName: 'session',
        disableMigrations: true,
        fields: {},
      },
    })

    assert.notInclude(output, 'session')
  })

  test('skips tables marked with disableMigration (legacy form)', ({ assert }) => {
    const output = renderLucidMigration({
      session: {
        modelName: 'session',
        disableMigration: true,
        fields: {},
      },
    } as any)

    assert.notInclude(output, 'session')
  })

  test('throws on unsupported field type', ({ assert }) => {
    assert.throws(() => {
      renderLucidMigration({
        user: {
          modelName: 'user',
          fields: {
            role: { type: 'custom-enum' as any, required: true },
          },
        },
      })
    }, /unsupported.*type/i)
  })

  test('throws when field type is missing', ({ assert }) => {
    assert.throws(() => {
      renderLucidMigration({
        user: {
          modelName: 'user',
          fields: {
            broken: {} as any,
          },
        },
      })
    }, /missing.*type|unsupported.*type/i)
  })

  test('throws when field type is not a string', ({ assert }) => {
    assert.throws(() => {
      renderLucidMigration({
        user: {
          modelName: 'user',
          fields: {
            broken: { type: 123 as any },
          },
        },
      })
    }, /missing.*type|unsupported.*type/i)
  })

  test('throws when references is missing model', ({ assert }) => {
    assert.throws(() => {
      renderLucidMigration({
        user: {
          modelName: 'user',
          fields: {
            orgId: { type: 'string', references: { field: 'id' } as any },
          },
        },
      })
    }, /references.*model/i)
  })

  test('throws when references is missing field', ({ assert }) => {
    assert.throws(() => {
      renderLucidMigration({
        user: {
          modelName: 'user',
          fields: {
            orgId: { type: 'string', references: { model: 'org' } as any },
          },
        },
      })
    }, /references.*field/i)
  })

  test('throws when references is not an object', ({ assert }) => {
    assert.throws(() => {
      renderLucidMigration({
        user: {
          modelName: 'user',
          fields: {
            orgId: { type: 'string', references: 'bad' as any },
          },
        },
      })
    }, /references.*object/i)
  })

  test('uses fieldName when present instead of converting the key', ({ assert }) => {
    const output = renderLucidMigration({
      user: {
        modelName: 'user',
        fields: {
          myField: { type: 'string', fieldName: 'custom_col' },
        },
      },
    })

    assert.include(output, "table.string('custom_col')")
    assert.notInclude(output, 'my_field')
  })

  test('renders bigint columns when bigint flag is set', ({ assert }) => {
    const output = renderLucidMigration({
      user: {
        modelName: 'user',
        fields: {
          bigNumber: { type: 'number', bigint: true },
        },
      },
    })

    assert.include(output, "table.bigInteger('big_number')")
  })

  test('includes down() method with dropTable calls', ({ assert }) => {
    const output = renderLucidMigration({
      user: {
        modelName: 'app_user',
        fields: {
          id: { type: 'string' },
        },
      },
      session: {
        modelName: 'session',
        fields: {
          id: { type: 'string' },
        },
      },
    })

    assert.include(output, 'async down()')
    assert.include(output, "this.schema.dropTableIfExists('session')")
    assert.include(output, "this.schema.dropTableIfExists('app_user')")
  })
})

test.group('Schema renderer — getSchema() compatibility', () => {
  test('renders tables from real getSchema() output (no modelName property)', ({ assert }) => {
    const schema = getSchema(makeBetterAuthOptions())

    // Real getSchema() entries have { fields, order } but NO modelName.
    // Verify the test assumption: first entry should NOT have modelName
    const firstEntry = Object.values(schema)[0] as any
    assert.notProperty(firstEntry, 'modelName')

    const output = renderLucidMigration(schema as any)

    // Core Better Auth tables should appear
    assert.include(output, "this.schema.createTable('user'")
    assert.include(output, "this.schema.createTable('session'")
    assert.include(output, "this.schema.createTable('account'")
    assert.include(output, "this.schema.createTable('verification'")

    // Should be valid migration structure
    assert.include(output, "import { BaseSchema } from '@adonisjs/lucid/schema'")
    assert.include(output, 'async up()')
    assert.include(output, 'async down()')
  })

  test('auto-synthesizes id primary key column when not in fields', ({ assert }) => {
    const schema = getSchema(makeBetterAuthOptions())

    // Verify the test assumption: fields should NOT contain 'id'
    const userEntry = (schema as any).user
    assert.notProperty(userEntry.fields, 'id')

    const output = renderLucidMigration(schema as any)

    // Each table should get an auto-synthesized id column
    assert.include(output, "table.string('id').notNullable().primary()")
  })

  test('uses object key as table name when modelName is missing', ({ assert }) => {
    const output = renderLucidMigration({
      my_custom_table: {
        fields: {
          name: { type: 'string' },
        },
        order: 1,
      },
    } as any)

    assert.include(output, "this.schema.createTable('my_custom_table'")
  })

  test('renders Better Auth database rate-limit schema without throwing', ({ assert }) => {
    const options = makeBetterAuthOptions()
    options.rateLimit = { enabled: true, storage: 'database' }

    const output = renderLucidMigration(getSchema(options) as any)

    assert.include(output, "this.schema.createTable('rateLimit'")
    assert.include(output, "table.bigInteger('lastRequest').notNullable()")
    assert.notInclude(output, "table.bigInteger('lastRequest').notNullable().defaultTo(")
  })
})

test.group('Schema renderer — field features', () => {
  test('renders index() on columns with index: true', ({ assert }) => {
    const output = renderLucidMigration({
      user: {
        modelName: 'user',
        fields: {
          email: { type: 'string', index: true },
        },
      },
    })

    assert.include(output, "table.string('email').notNullable().index()")
  })

  test('renders string default values with proper escaping', ({ assert }) => {
    const output = renderLucidMigration({
      user: {
        modelName: 'user',
        fields: {
          role: { type: 'string', defaultValue: "manager's" },
        },
      },
    })

    assert.include(output, '.defaultTo("manager\'s")')
  })

  test('renders date function defaults with this.now()', ({ assert }) => {
    const output = renderLucidMigration({
      user: {
        modelName: 'user',
        fields: {
          createdAt: { type: 'date', defaultValue: (() => new Date()) as any },
        },
      },
    })

    assert.include(output, "table.timestamp('created_at').notNullable().defaultTo(this.now())")
  })

  test('throws on unsupported non-date function defaults', ({ assert }) => {
    assert.throws(() => {
      renderLucidMigration({
        user: {
          modelName: 'user',
          fields: {
            token: { type: 'string', defaultValue: (() => 'abc') as any },
          },
        },
      })
    }, /unsupported function default/i)
  })

  test('throws on unsupported bigint function defaults outside Better Auth rate limit', ({
    assert,
  }) => {
    assert.throws(() => {
      renderLucidMigration({
        user: {
          modelName: 'user',
          fields: {
            sequence: { type: 'number', bigint: true, defaultValue: (() => 123) as any },
          },
        },
      })
    }, /unsupported function default/i)
  })

  test('throws on unsupported object defaults', ({ assert }) => {
    assert.throws(() => {
      renderLucidMigration({
        user: {
          modelName: 'user',
          fields: {
            profile: { type: 'json', defaultValue: { role: 'admin' } as any },
          },
        },
      })
    }, /unsupported defaultValue/i)
  })
})

test.group('Schema renderer — table ordering', () => {
  test('orders tables by order field, with Infinity-default tables last', ({ assert }) => {
    const output = renderLucidMigration({
      zeta: {
        modelName: 'zeta',
        fields: { id: { type: 'string', primaryKey: true } },
        // no order — should default to Infinity and come last
      },
      alpha: {
        modelName: 'alpha',
        fields: { id: { type: 'string', primaryKey: true } },
        order: 1,
      },
      beta: {
        modelName: 'beta',
        fields: { id: { type: 'string', primaryKey: true } },
        order: 2,
      },
    })

    const alphaPos = output.indexOf("createTable('alpha'")
    const betaPos = output.indexOf("createTable('beta'")
    const zetaPos = output.indexOf("createTable('zeta'")

    assert.isBelow(alphaPos, betaPos, 'alpha (order=1) should come before beta (order=2)')
    assert.isBelow(betaPos, zetaPos, 'beta (order=2) should come before zeta (no order)')
  })

  test('preserves insertion order among tables with equal order', ({ assert }) => {
    const output = renderLucidMigration({
      first: {
        modelName: 'first',
        fields: { id: { type: 'string', primaryKey: true } },
        order: 1,
      },
      second: {
        modelName: 'second',
        fields: { id: { type: 'string', primaryKey: true } },
        order: 1,
      },
    })

    const firstPos = output.indexOf("createTable('first'")
    const secondPos = output.indexOf("createTable('second'")

    assert.isBelow(firstPos, secondPos, 'insertion order should be preserved for equal order')
  })
})

test.group('createSchema', (group) => {
  group.setup(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'create-schema-test-'))
  })

  group.teardown(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true })
  })

  test('writes a migration to an explicit file path', async ({ assert }) => {
    const outputFile = path.join(tmpDir, 'explicit_migration.ts')

    const outputPath = await createSchema({
      file: outputFile,
      tables: {
        user: {
          modelName: 'user',
          fields: {
            id: { type: 'string' },
          },
        },
      },
    })

    assert.isString(outputPath)
    assert.equal(outputPath, outputFile)
    const exists = await fs
      .access(outputFile)
      .then(() => true)
      .catch(() => false)
    assert.isTrue(exists, 'migration file should exist on disk')

    const content = await fs.readFile(outputFile, 'utf-8')
    assert.include(content, "this.schema.createTable('user'")
  })

  test('uses the default timestamped migration path when file is omitted', async ({ assert }) => {
    const outputPath = await createSchema({
      tables: {
        user: {
          modelName: 'user',
          fields: {
            id: { type: 'string' },
          },
        },
      },
      basePath: tmpDir,
    })

    assert.isString(outputPath)
    assert.match(
      outputPath.split(path.sep).join('/'),
      /database\/migrations\/\d+_create_better_auth_tables\.ts$/
    )

    const exists = await fs
      .access(outputPath)
      .then(() => true)
      .catch(() => false)
    assert.isTrue(exists, 'default migration file should exist on disk')
  })

  test('returns the output path as a string, not an object', async ({ assert }) => {
    const outputFile = path.join(tmpDir, 'string_check.ts')

    const result = await createSchema({
      file: outputFile,
      tables: {
        user: {
          modelName: 'user',
          fields: {
            id: { type: 'string' },
          },
        },
      },
    })

    assert.isString(result)
    assert.notProperty(result, 'code')
    assert.notProperty(result, 'path')
  })
})

test.group('Adapter integration — createSchema', (group) => {
  let adapterTmpDir: string

  group.setup(async () => {
    adapterTmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'adapter-schema-test-'))
  })

  group.teardown(async () => {
    await fs.rm(adapterTmpDir, { recursive: true, force: true })
  })

  test('adapter.createSchema writes a migration file through the public entrypoint', async ({
    assert,
  }) => {
    const db = createTestDatabase()
    const client = db.connection('sqlite')

    const factory = lucidAdapter({ client })
    const options = makeBetterAuthOptions()
    const adapter = factory(options)

    const outputFile = path.join(adapterTmpDir, 'create_better_auth_tables.ts')

    // The outer adapter.createSchema signature is (options, file?) from the factory wrapper
    const result = await adapter.createSchema?.(options, outputFile)

    assert.isDefined(result, 'createSchema should be defined on the adapter')
    assert.isObject(result)
    assert.properties(result!, ['code', 'path'])
    assert.equal(result!.path, outputFile)

    const exists = await fs
      .access(outputFile)
      .then(() => true)
      .catch(() => false)
    assert.isTrue(exists, 'migration file should exist on disk')

    const content = await fs.readFile(outputFile, 'utf-8')
    assert.equal(result!.code, content)
    assert.include(content, "this.schema.createTable('user'")
    assert.include(content, "table.boolean('email_verified').notNullable().defaultTo(false)")
    assert.include(content, "import { BaseSchema } from '@adonisjs/lucid/schema'")

    await db.manager.closeAll()
  })

  test('adapter.createSchema renders serial ids for numeric-id mode', async ({ assert }) => {
    const db = createTestDatabase()
    const client = db.connection('sqlite')

    const factory = lucidAdapter({ client })
    const options = makeBetterAuthOptions()
    options.advanced = { database: { generateId: 'serial' } }
    const adapter = factory(options)

    const outputFile = path.join(adapterTmpDir, 'serial_better_auth_tables.ts')
    const result = await adapter.createSchema?.(options, outputFile)

    assert.isDefined(result)

    const content = await fs.readFile(outputFile, 'utf-8')
    assert.equal(result!.code, content)
    assert.include(content, "table.increments('id')")
    assert.include(content, "table.integer('user_id').notNullable().index()")

    await db.manager.closeAll()
  })
})
