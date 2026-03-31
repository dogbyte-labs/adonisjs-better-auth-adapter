/*
|--------------------------------------------------------------------------
| Lucid test harness
|--------------------------------------------------------------------------
|
| Shared SQLite/Lucid test setup for both Japa and Vitest suites.
| Provides database bootstrap, schema creation, seed helpers, and cleanup.
|
*/

import { Emitter } from '@adonisjs/core/events'
import { AppFactory } from '@adonisjs/core/factories/app'
import { LoggerFactory } from '@adonisjs/core/factories/logger'
import { Database } from '@adonisjs/lucid/database'
import type { QueryClientContract, TransactionClientContract } from '@adonisjs/lucid/types/database'
import SqliteDatabase from 'better-sqlite3'
import type { BetterAuthOptions, DBAdapter } from 'better-auth'
import type { AdapterFactory } from 'better-auth/adapters'
import { getMigrations } from 'better-auth/db/migration'
import fs from 'node:fs/promises'
import path from 'node:path'

import { lucidAdapter } from '../../src/lucid_adapter.js'

const CONTRACT_DB_PATH = path.join(import.meta.dirname, '../contracts/test.db')

let contractSqliteDb: ReturnType<typeof createContractSqliteDb> | null = null
let contractLucidDb: Database | null = null

/**
 * Creates an in-memory SQLite database via Lucid.
 */
export function createTestDatabase() {
  const logger = new LoggerFactory().create()
  const app = new AppFactory().create(new URL('file:///tmp/test/'), () => {})
  const emitter = new Emitter(app)

  const db = new Database(
    {
      connection: 'sqlite',
      connections: {
        sqlite: {
          client: 'better-sqlite3',
          connection: { filename: ':memory:' },
          useNullAsDefault: true,
        },
      },
    },
    logger,
    emitter
  )

  return db
}

/**
 * Creates the Better Auth core tables in the test database.
 */
export async function createAuthTables(client: QueryClientContract) {
  await client.schema.createTable('user', (table) => {
    table.string('id').primary()
    table.string('name').notNullable()
    table.string('email').notNullable().unique()
    table.boolean('email_verified').defaultTo(false)
    table.string('image').nullable()
    table.timestamp('created_at').notNullable()
    table.timestamp('updated_at').notNullable()
  })

  await client.schema.createTable('session', (table) => {
    table.string('id').primary()
    table.string('user_id').notNullable().references('id').inTable('user')
    table.string('token').notNullable().unique()
    table.string('ip_address').nullable()
    table.string('user_agent').nullable()
    table.timestamp('expires_at').notNullable()
    table.timestamp('created_at').notNullable()
    table.timestamp('updated_at').notNullable()
  })

  await client.schema.createTable('account', (table) => {
    table.string('id').primary()
    table.string('user_id').notNullable().references('id').inTable('user')
    table.string('account_id').notNullable()
    table.string('provider_id').notNullable()
    table.string('access_token').nullable()
    table.string('refresh_token').nullable()
    table.string('access_token_expires_at').nullable()
    table.string('refresh_token_expires_at').nullable()
    table.string('scope').nullable()
    table.string('id_token').nullable()
    table.string('password').nullable()
    table.timestamp('created_at').notNullable()
    table.timestamp('updated_at').notNullable()
  })

  await client.schema.createTable('verification', (table) => {
    table.string('id').primary()
    table.string('identifier').notNullable()
    table.string('value').notNullable()
    table.timestamp('expires_at').notNullable()
    table.timestamp('created_at').nullable()
    table.timestamp('updated_at').nullable()
  })
}

/**
 * Drops all Better Auth tables from the test database.
 */
export async function dropAuthTables(client: QueryClientContract) {
  await client.schema.dropTableIfExists('verification')
  await client.schema.dropTableIfExists('account')
  await client.schema.dropTableIfExists('session')
  await client.schema.dropTableIfExists('user')
}

/**
 * Better Auth options used in tests.
 * Maps camelCase Better Auth field names to snake_case DB columns
 * (standard AdonisJS convention).
 */
export function makeBetterAuthOptions(): BetterAuthOptions {
  return {
    secret: 'test-secret-at-least-32-characters-long',
    baseURL: 'http://localhost:3333',
    emailAndPassword: { enabled: true },
    user: {
      fields: {
        emailVerified: 'email_verified',
        createdAt: 'created_at',
        updatedAt: 'updated_at',
      },
    },
    session: {
      fields: {
        userId: 'user_id',
        expiresAt: 'expires_at',
        createdAt: 'created_at',
        updatedAt: 'updated_at',
        ipAddress: 'ip_address',
        userAgent: 'user_agent',
      },
    },
    account: {
      fields: {
        userId: 'user_id',
        accountId: 'account_id',
        providerId: 'provider_id',
        accessToken: 'access_token',
        refreshToken: 'refresh_token',
        accessTokenExpiresAt: 'access_token_expires_at',
        refreshTokenExpiresAt: 'refresh_token_expires_at',
        idToken: 'id_token',
        createdAt: 'created_at',
        updatedAt: 'updated_at',
      },
    },
    verification: {
      fields: {
        expiresAt: 'expires_at',
        createdAt: 'created_at',
        updatedAt: 'updated_at',
      },
    },
  }
}

/**
 * Creates a fully wired adapter instance using the given Lucid client.
 */
export function makeAdapter(client: QueryClientContract) {
  const factory = lucidAdapter({ client })
  return factory(makeBetterAuthOptions())
}

/**
 * Creates an adapter with disableIdGeneration enabled.
 * The DB is expected to generate IDs (e.g. auto-increment).
 */
export function makeAdapterWithDbIds(client: QueryClientContract) {
  const factory = lucidAdapter({ client, disableIdGeneration: true })
  return factory(makeBetterAuthOptions())
}

/**
 * Returns a Lucid adapter config for the shared contract-test database.
 */
export function makeContractConfig() {
  if (!contractLucidDb) {
    contractLucidDb = createTestDatabaseForFile(CONTRACT_DB_PATH)
  }

  return { client: contractLucidDb.connection('sqlite') }
}

/**
 * Creates the adapter factory used by the Better Auth contract suite.
 * The wrapper preserves `transaction` because the official test-utils
 * wrapper overwrites that property after first reading `adapter.options`.
 */
export function makeContractAdapter(): AdapterFactory<BetterAuthOptions> {
  const factory = lucidAdapter(makeContractConfig())

  return (options) => preserveTransactionMethod(factory(options))
}

/**
 * Recreates the shared contract-test SQLite database and runs Better Auth migrations.
 */
export async function runContractMigrations(betterAuthOptions: BetterAuthOptions) {
  await closeContractDatabase()

  await removeFileIfExists(CONTRACT_DB_PATH)

  contractSqliteDb = createContractSqliteDb(CONTRACT_DB_PATH)
  contractLucidDb = createTestDatabaseForFile(CONTRACT_DB_PATH)

  const migrationOptions = Object.assign(betterAuthOptions, { database: contractSqliteDb })
  const { runMigrations } = await getMigrations(migrationOptions)
  await runMigrations()
}

/**
 * Closes and deletes the shared contract-test SQLite database.
 */
export async function cleanupContractDatabase() {
  await closeContractDatabase()

  await removeFileIfExists(CONTRACT_DB_PATH)
}

/**
 * Seeds session rows for a given user ID.
 * The user must already exist.
 */
export async function seedSessionsForUser(client: QueryClientContract, userId: string) {
  const now = new Date().toISOString()
  const expires = new Date(Date.now() + 86400000).toISOString()

  await client.table('session').multiInsert([
    {
      id: `${userId}_sess_1`,
      user_id: userId,
      token: `${userId}_token_1`,
      ip_address: '127.0.0.1',
      user_agent: 'test',
      expires_at: expires,
      created_at: now,
      updated_at: now,
    },
    {
      id: `${userId}_sess_2`,
      user_id: userId,
      token: `${userId}_token_2`,
      ip_address: '127.0.0.1',
      user_agent: 'test',
      expires_at: expires,
      created_at: now,
      updated_at: now,
    },
  ])
}

/**
 * Seeds user rows with the given emails.
 */
export async function seedUsers(client: QueryClientContract, emails: string[]) {
  const now = new Date().toISOString()

  for (const email of emails) {
    const id = email.replace(/[^a-z0-9]/gi, '_')
    await client.table('user').insert({
      id,
      name: email.split('@')[0],
      email,
      email_verified: false,
      created_at: now,
      updated_at: now,
    })
  }
}

/**
 * Creates an adapter already bound to a transaction client, with a
 * counter that tracks whether a nested `.transaction()` call was opened.
 *
 * Use this to prove the adapter reuses the existing transaction instead
 * of opening a new nested one.
 */
export async function makeTransactionBoundAdapter(baseClient: QueryClientContract) {
  const nestedCalls = { count: 0 }

  // Open a real Lucid transaction
  const trx: TransactionClientContract = await (
    baseClient as unknown as { transaction: () => Promise<TransactionClientContract> }
  ).transaction()

  // Wrap the transaction client with a Proxy that counts nested .transaction() calls
  const spyTrx = new Proxy(trx, {
    get(target, prop, receiver) {
      if (prop === 'transaction') {
        return async () => {
          nestedCalls.count++
          return Reflect.get(target, prop, receiver).call(target)
        }
      }
      return Reflect.get(target, prop, receiver)
    },
  })

  const factory = lucidAdapter({ client: spyTrx })
  const adapter = factory(makeBetterAuthOptions())

  return { adapter, nestedCalls, trx }
}

function createTestDatabaseForFile(filePath: string) {
  const logger = new LoggerFactory().create()
  const app = new AppFactory().create(new URL('file:///tmp/test/'), () => {})
  const emitter = new Emitter(app)

  return new Database(
    {
      connection: 'sqlite',
      connections: {
        sqlite: {
          client: 'better-sqlite3',
          connection: { filename: filePath },
          useNullAsDefault: true,
        },
      },
    },
    logger,
    emitter
  )
}

async function closeContractDatabase() {
  if (contractLucidDb) {
    await contractLucidDb.manager.closeAll()
    contractLucidDb = null
  }

  if (contractSqliteDb) {
    contractSqliteDb.close()
    contractSqliteDb = null
  }
}

function createContractSqliteDb(filePath: string) {
  return new SqliteDatabase(filePath)
}

async function removeFileIfExists(filePath: string) {
  try {
    await fs.unlink(filePath)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw error
    }
  }
}

function preserveTransactionMethod(adapter: DBAdapter<BetterAuthOptions>) {
  const transaction = adapter.transaction

  Object.defineProperty(adapter, 'transaction', {
    configurable: true,
    enumerable: true,
    get() {
      return transaction
    },
    set() {},
  })

  return adapter
}
