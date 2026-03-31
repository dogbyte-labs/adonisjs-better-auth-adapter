/*
|--------------------------------------------------------------------------
| Package types
|--------------------------------------------------------------------------
|
| Export types used by the Lucid adapter for Better Auth.
|
*/

import type { QueryClientContract, TransactionClientContract } from '@adonisjs/lucid/types/database'

/**
 * Configuration options for the Lucid adapter.
 */
export interface LucidAdapterConfig {
  /**
   * The Lucid query client or transaction client used for all queries.
   */
  client: QueryClientContract | TransactionClientContract

  /**
   * When true, adapter operations are logged for debugging.
   */
  debugLogs?: boolean

  /**
   * When true, table names are pluralized (e.g. "users" instead of "user").
   */
  usePlural?: boolean

  /**
   * When true, the adapter will not generate IDs and expects
   * the database to handle ID generation.
   */
  disableIdGeneration?: boolean

  /**
   * Whether the underlying database natively stores JSON columns as
   * objects. When `false`, the factory serializes/deserializes JSON
   * values automatically.
   *
   * Defaults to `true` for PostgreSQL/MySQL and `false` for SQLite.
   */
  supportsJSON?: boolean

  /**
   * Whether the underlying database natively stores date columns as
   * Date objects. When `false`, the factory converts dates to/from
   * ISO strings automatically.
   *
   * Defaults to `true` for PostgreSQL/MySQL and `false` for SQLite.
   */
  supportsDates?: boolean

  /**
   * Whether the underlying database natively stores boolean columns.
   * When `false`, the factory converts booleans to/from `0`/`1`
   * automatically.
   *
   * Defaults to `true` for PostgreSQL/MySQL and `false` for SQLite.
   */
  supportsBooleans?: boolean
}
