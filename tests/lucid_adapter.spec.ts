import { test } from '@japa/runner'
import type { Database } from '@adonisjs/lucid/database'
import type { QueryClientContract } from '@adonisjs/lucid/types/database'
import { lucidAdapter } from '../src/lucid_adapter.js'

import {
  createTestDatabase,
  createAuthTables,
  dropAuthTables,
  makeAdapter,
  makeAdapterWithDbIds,
  makeBetterAuthOptions,
  makeTransactionBoundAdapter,
  seedSessionsForUser,
  seedUsers,
} from './helpers/lucid_test_harness.js'

let db: Database
let client: QueryClientContract

test.group('Lucid adapter entrypoint', () => {
  test('lucidAdapter is exported as a function from the package root', async ({ assert }) => {
    const { lucidAdapter: packageLucidAdapter } = await import('../index.ts')
    assert.isFunction(packageLucidAdapter)
  })

  test('lucidAdapter accepts a config parameter', async ({ assert }) => {
    const { lucidAdapter: packageLucidAdapter } = await import('../index.ts')
    assert.isAbove(packageLucidAdapter.length, 0)
  })
})

test.group('Lucid adapter CRUD', (group) => {
  group.setup(async () => {
    db = createTestDatabase()
    client = db.connection('sqlite')
    await createAuthTables(client)
  })

  group.teardown(async () => {
    await dropAuthTables(client)
    await db.manager.closeAll()
  })

  group.each.setup(async () => {
    // Clean table contents between tests but keep schema
    await client.from('verification').del()
    await client.from('account').del()
    await client.from('session').del()
    await client.from('user').del()
  })

  test('creates and finds a user', async ({ assert }) => {
    const adapter = makeAdapter(client)

    const created = (await adapter.create({
      model: 'user',
      data: { email: 'virk@example.com', name: 'Virk' },
    })) as Record<string, unknown>

    const found = (await adapter.findOne({
      model: 'user',
      where: [{ field: 'id', value: created.id as string }],
    })) as Record<string, unknown> | null

    assert.equal(created.email, 'virk@example.com')
    assert.equal(found?.id, created.id)
  })

  test('updates a matching row and returns the full row', async ({ assert }) => {
    const adapter = makeAdapter(client)
    const created = (await adapter.create({
      model: 'user',
      data: { email: 'update@example.com', name: 'Before' },
    })) as Record<string, unknown>

    const updated = (await adapter.update({
      model: 'user',
      where: [{ field: 'id', value: created.id as string }],
      update: { name: 'After' },
    })) as Record<string, unknown> | null

    assert.equal(updated?.name, 'After')
  })

  test('returns null when updating a missing row', async ({ assert }) => {
    const adapter = makeAdapter(client)

    const result = await adapter.update({
      model: 'user',
      where: [{ field: 'id', value: 'missing' }],
      update: { name: 'Missing' },
    })

    assert.isNull(result)
  })

  test('updates many rows and returns the affected count', async ({ assert }) => {
    const adapter = makeAdapter(client)

    // Create the user first so foreign key constraint is satisfied
    const now = new Date().toISOString()
    await client.table('user').insert({
      id: 'user_batch',
      name: 'Batch',
      email: 'batch@example.com',
      email_verified: false,
      created_at: now,
      updated_at: now,
    })

    await seedSessionsForUser(client, 'user_batch')

    const count = await adapter.updateMany({
      model: 'session',
      where: [{ field: 'userId', value: 'user_batch' }],
      update: { ipAddress: '127.0.0.2' },
    })

    assert.equal(count, 2)
  })

  test('deletes many rows and returns the count', async ({ assert }) => {
    const adapter = makeAdapter(client)

    // Create the user first
    const now = new Date().toISOString()
    await client.table('user').insert({
      id: 'user_1',
      name: 'User1',
      email: 'user1@example.com',
      email_verified: false,
      created_at: now,
      updated_at: now,
    })

    await seedSessionsForUser(client, 'user_1')

    const count = await adapter.deleteMany({
      model: 'session',
      where: [{ field: 'userId', value: 'user_1' }],
    })

    assert.equal(count, 2)
  })

  test('delete is silent for missing rows', async ({ assert }) => {
    const adapter = makeAdapter(client)

    await adapter.delete({
      model: 'session',
      where: [{ field: 'id', value: 'missing' }],
    })

    // If we get here without throwing, the test passes
    assert.isTrue(true)
  })

  test('findMany and count return matching rows', async ({ assert }) => {
    const adapter = makeAdapter(client)
    await seedUsers(client, ['a@example.com', 'b@example.com', 'c@example.com'])

    const rows = (await adapter.findMany({
      model: 'user',
      where: [],
      limit: 2,
      offset: 0,
      sortBy: { field: 'email', direction: 'asc' },
    })) as Record<string, unknown>[]

    const total = await adapter.count({ model: 'user' })

    assert.equal(rows.length, 2, 'limit caps returned rows')
    assert.equal(total, 3, 'count ignores limit')
    assert.equal(rows[0].email, 'a@example.com', 'sorted ascending by email')
    assert.equal(rows[1].email, 'b@example.com')
  })

  test('update returns the row even when the matched field itself changes', async ({ assert }) => {
    const adapter = makeAdapter(client)
    const created = (await adapter.create({
      model: 'user',
      data: { email: 'old@example.com', name: 'Name' },
    })) as Record<string, unknown>

    const updated = (await adapter.update({
      model: 'user',
      where: [{ field: 'email', value: 'old@example.com' }],
      update: { email: 'new@example.com' },
    })) as Record<string, unknown> | null

    assert.isNotNull(updated, 'must return the updated row')
    assert.equal(updated!.email, 'new@example.com')
    assert.equal(updated!.id, created.id)
  })

  test('[A, B(OR), C(AND)] respects left-to-right: (A OR B) AND C', async ({ assert }) => {
    await seedUsers(client, ['alice@a.com', 'bob@b.com', 'carol@c.com'])

    // Left-to-right: (name=alice OR name=carol) AND email=carol@c.com
    // Correct: matches carol only.
    // Wrong (group-by-OR-runs): name=alice AND (name=carol OR email=carol@c.com) → matches alice AND carol.
    const adapter = makeAdapter(client)
    const rows = (await adapter.findMany({
      model: 'user',
      where: [
        { field: 'name', value: 'alice' },
        { field: 'name', value: 'carol', connector: 'OR' },
        { field: 'email', value: 'carol@c.com' },
      ],
    })) as Record<string, unknown>[]

    assert.equal(
      rows.length,
      1,
      'only carol matches (name=alice OR name=carol) AND email=carol@c.com'
    )
    assert.equal(rows[0].email, 'carol@c.com')
  })

  test('[A, B(AND), C(OR)] respects left-to-right: (A AND B) OR C', async ({ assert }) => {
    await seedUsers(client, ['alice@a.com', 'bob@b.com', 'carol@c.com'])

    // Left-to-right: (email=alice@a.com AND name=alice) OR name=carol
    // Correct: matches alice and carol.
    // Wrong (old group-by-OR-runs): email=alice@a.com AND (name=alice OR name=carol)
    //   → that also matches both, so use a non-matching AND pair:
    //
    // (email=alice@a.com AND name=WRONG) OR name=carol
    // Correct: AND pair matches nothing, OR picks up carol → 1 row.
    // Wrong grouping: email=alice@a.com AND (name=WRONG OR name=carol)
    //   → carol passes name check, but email=alice@a.com fails → 0 rows.
    const adapter = makeAdapter(client)
    const rows = (await adapter.findMany({
      model: 'user',
      where: [
        { field: 'email', value: 'alice@a.com' },
        { field: 'name', value: 'WRONG' },
        { field: 'name', value: 'carol', connector: 'OR' },
      ],
    })) as Record<string, unknown>[]

    assert.equal(rows.length, 1, 'carol matches via (email=alice AND name=WRONG) OR name=carol')
    assert.equal(rows[0].name, 'carol')
  })

  test('findMany maps camelCase sortBy field to snake_case DB column', async ({ assert }) => {
    await seedUsers(client, ['z@example.com', 'a@example.com'])

    // sortBy.field uses the Better Auth camelCase name 'createdAt'.
    // The adapter must map it to the DB column 'created_at'.
    const adapter = makeAdapter(client)
    const rows = (await adapter.findMany({
      model: 'user',
      where: [],
      sortBy: { field: 'createdAt', direction: 'asc' },
    })) as Record<string, unknown>[]

    assert.isAtLeast(rows.length, 2, 'should return seeded users sorted by created_at')
  })
})

test.group('Lucid adapter CRUD with DB-managed IDs', (group) => {
  let dbIdDb: Database
  let dbIdClient: QueryClientContract

  group.setup(async () => {
    dbIdDb = createTestDatabase()
    dbIdClient = dbIdDb.connection('sqlite')

    // Create user table with auto-increment integer ID
    await dbIdClient.schema.createTable('user', (table) => {
      table.increments('id').primary()
      table.string('name').notNullable()
      table.string('email').notNullable().unique()
      table.boolean('email_verified').defaultTo(false)
      table.string('image').nullable()
      table.timestamp('created_at').notNullable()
      table.timestamp('updated_at').notNullable()
    })
  })

  group.teardown(async () => {
    await dbIdClient.schema.dropTableIfExists('user')
    await dbIdDb.manager.closeAll()
  })

  test('create returns the row when the DB generates the id', async ({ assert }) => {
    const adapter = makeAdapterWithDbIds(dbIdClient)

    const created = (await adapter.create({
      model: 'user',
      data: { email: 'dbid@example.com', name: 'DB ID' },
    })) as Record<string, unknown>

    assert.exists(created.id, 'returned row must include a DB-generated id')
    assert.equal(created.email, 'dbid@example.com')
  })
})

test.group('Lucid adapter transactions', (group) => {
  group.setup(async () => {
    db = createTestDatabase()
    client = db.connection('sqlite')
    await createAuthTables(client)
  })

  group.teardown(async () => {
    await dropAuthTables(client)
    await db.manager.closeAll()
  })

  group.each.setup(async () => {
    await client.from('verification').del()
    await client.from('account').del()
    await client.from('session').del()
    await client.from('user').del()
  })

  test('commits writes inside adapter.transaction', async ({ assert }) => {
    const adapter = makeAdapter(client)

    const createdId = await adapter.transaction!(async (trx) => {
      const created = (await trx.create({
        model: 'user',
        data: { email: 'commit@example.com', name: 'Commit' },
      })) as Record<string, unknown>

      return created.id as string
    })

    const found = (await adapter.findOne({
      model: 'user',
      where: [{ field: 'id', value: createdId }],
    })) as Record<string, unknown> | null

    assert.exists(found, 'committed row must be visible outside the transaction')
    assert.equal(found!.email, 'commit@example.com')
  })

  test('rolls back writes when the transaction callback throws', async ({ assert }) => {
    const adapter = makeAdapter(client)

    await assert.rejects(async () => {
      await adapter.transaction!(async (trx) => {
        await trx.create({
          model: 'user',
          data: { email: 'rollback@example.com', name: 'Rollback' },
        })
        throw new Error('force rollback')
      })
    })

    const rows = (await adapter.findMany({ model: 'user', where: [] })) as Record<string, unknown>[]
    const emails = rows.map((r) => r.email)

    assert.notInclude(emails, 'rollback@example.com', 'rolled-back row must not be visible')
  })

  test('reuses an existing transaction client without nesting', async ({ assert }) => {
    const { adapter, nestedCalls, trx } = await makeTransactionBoundAdapter(client)

    try {
      await adapter.transaction!(async (innerAdapter) => {
        await innerAdapter.create({
          model: 'user',
          data: { email: 'nested@example.com', name: 'Nested' },
        })
      })

      assert.equal(nestedCalls.count, 0, 'must not open a nested transaction')
    } finally {
      await trx.rollback()
    }

    const found = (await makeAdapter(client).findOne({
      model: 'user',
      where: [{ field: 'email', value: 'nested@example.com' }],
    })) as Record<string, unknown> | null

    assert.isNull(found, 'rolled back parent transaction should remove inner writes')
  })
})

test.group('Lucid adapter transaction option isolation', (group) => {
  group.setup(async () => {
    db = createTestDatabase()
    client = db.connection('sqlite')

    await client.schema.createTable('user', (table) => {
      table.string('id').primary()
      table.string('name').notNullable()
      table.string('email').nullable()
      table.string('email_address').nullable()
      table.boolean('email_verified').defaultTo(false)
      table.timestamp('created_at').notNullable()
      table.timestamp('updated_at').notNullable()
    })
  })

  group.teardown(async () => {
    await client.schema.dropTableIfExists('user')
    await db.manager.closeAll()
  })

  group.each.setup(async () => {
    await client.from('user').del()
  })

  test('binds transactions to the adapter instance options, not the last factory call', async ({
    assert,
  }) => {
    const factory = lucidAdapter({ client })
    const defaultAdapter = factory(makeBetterAuthOptions())

    const remappedOptions = makeBetterAuthOptions()
    remappedOptions.user = {
      ...remappedOptions.user,
      fields: {
        ...remappedOptions.user?.fields,
        email: 'email_address',
      },
    }

    factory(remappedOptions)

    await defaultAdapter.transaction!(async (trx) => {
      await trx.create({
        model: 'user',
        data: { email: 'isolated@example.com', name: 'Isolated' },
      })
    })

    const stored = (await client.from('user').select(['email', 'email_address']).first()) as Record<
      string,
      string | null
    > | null

    assert.exists(stored)
    assert.equal(stored!.email, 'isolated@example.com')
    assert.isNull(stored!.email_address)
  })
})

test.group('Lucid adapter remapped field queries', (group) => {
  group.setup(async () => {
    db = createTestDatabase()
    client = db.connection('sqlite')
    await createAuthTables(client)
  })

  group.teardown(async () => {
    await dropAuthTables(client)
    await db.manager.closeAll()
  })

  group.each.setup(async () => {
    await client.from('verification').del()
    await client.from('account').del()
    await client.from('session').del()
    await client.from('user').del()
  })

  test('queries using Better Auth camelCase field names resolved to DB columns', async ({
    assert,
  }) => {
    const adapter = makeAdapter(client)

    // Create a user and a session
    const now = new Date().toISOString()
    await client.table('user').insert({
      id: 'remap_user',
      name: 'Remap',
      email: 'remap@example.com',
      email_verified: false,
      created_at: now,
      updated_at: now,
    })
    await seedSessionsForUser(client, 'remap_user')

    // Query session by camelCase 'userId' which maps to DB column 'user_id'
    const session = (await adapter.findOne({
      model: 'session',
      where: [{ field: 'userId', value: 'remap_user' }],
    })) as Record<string, unknown> | null

    assert.exists(session, 'must find session by remapped userId field')
  })

  test('maps camelCase select fields to remapped DB columns', async ({ assert }) => {
    const adapter = makeAdapter(client)

    const created = (await adapter.create({
      model: 'user',
      data: { email: 'select@example.com', name: 'Select' },
    })) as Record<string, unknown>

    const found = (await adapter.findOne({
      model: 'user',
      where: [{ field: 'id', value: created.id as string }],
      select: ['createdAt'],
    })) as Record<string, unknown> | null

    assert.exists(found, 'row should still be found when selecting remapped fields')
    assert.exists(found!.createdAt, 'createdAt should be loaded from created_at')
  })

  test('LIKE operators escape % and _ in user input', async ({ assert }) => {
    const adapter = makeAdapter(client)

    // Create users with literal % and _ in their names
    const now = new Date().toISOString()
    await client.table('user').insert({
      id: 'special_1',
      name: '100% done',
      email: 'special1@example.com',
      email_verified: false,
      created_at: now,
      updated_at: now,
    })
    await client.table('user').insert({
      id: 'special_2',
      name: 'under_score',
      email: 'special2@example.com',
      email_verified: false,
      created_at: now,
      updated_at: now,
    })
    await client.table('user').insert({
      id: 'normal_1',
      name: 'done',
      email: 'normal@example.com',
      email_verified: false,
      created_at: now,
      updated_at: now,
    })

    // 'contains' with '%' should only match the row with literal '%', not wildcard-match everything
    const containsPercent = (await adapter.findMany({
      model: 'user',
      where: [{ field: 'name', operator: 'contains', value: '%' }],
    })) as Record<string, unknown>[]
    assert.equal(containsPercent.length, 1, 'only the row with literal % matches')
    assert.equal(containsPercent[0].name, '100% done')

    // 'starts_with' with 'under_' should only match literal underscore, not single-char wildcard
    const startsWithUnderscore = (await adapter.findMany({
      model: 'user',
      where: [{ field: 'name', operator: 'starts_with', value: 'under_' }],
    })) as Record<string, unknown>[]
    assert.equal(startsWithUnderscore.length, 1, 'only the row with literal _ matches')
    assert.equal(startsWithUnderscore[0].name, 'under_score')

    // 'ends_with' with '%' should only match the row ending in a literal '%'
    await client.table('user').insert({
      id: 'special_3',
      name: 'progress%',
      email: 'special3@example.com',
      email_verified: false,
      created_at: now,
      updated_at: now,
    })
    await client.table('user').insert({
      id: 'normal_2',
      name: 'progress',
      email: 'normal2@example.com',
      email_verified: false,
      created_at: now,
      updated_at: now,
    })
    await client.table('user').insert({
      id: 'special_4',
      name: 'C\\temp',
      email: 'special4@example.com',
      email_verified: false,
      created_at: now,
      updated_at: now,
    })

    const endsWithPercent = (await adapter.findMany({
      model: 'user',
      where: [{ field: 'name', operator: 'ends_with', value: '%' }],
    })) as Record<string, unknown>[]
    assert.equal(endsWithPercent.length, 1, 'only the row ending with literal % matches')
    assert.equal(endsWithPercent[0].name, 'progress%')

    const containsBackslash = (await adapter.findMany({
      model: 'user',
      where: [{ field: 'name', operator: 'contains', value: '\\' }],
    })) as Record<string, unknown>[]
    assert.equal(containsBackslash.length, 1, 'only the row with literal backslash matches')
    assert.equal(containsBackslash[0].name, 'C\\temp')
  })
})
