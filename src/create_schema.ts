/*
|--------------------------------------------------------------------------
| Create schema
|--------------------------------------------------------------------------
|
| Better Auth `createSchema` entrypoint. Renders a Lucid migration and
| writes it to disk. Returns the output file path.
|
*/

import fs from 'node:fs/promises'
import path from 'node:path'
import { renderLucidMigration, type SchemaInput } from './schema_renderer.js'

/**
 * Options for `createSchema`.
 */
export interface CreateSchemaOptions {
  /**
   * Explicit output file path. When omitted, a timestamped default
   * path under `database/migrations/` is used.
   */
  file?: string

  /**
   * The normalized table schema to render.
   */
  tables: SchemaInput

  /**
   * Base directory for the default migration path. Defaults to `process.cwd()`.
   * Exposed for testing so tests can use a temp directory.
   */
  basePath?: string
}

/**
 * Generates a timestamped default migration file path.
 */
function makeDefaultMigrationPath(basePath: string): string {
  const timestamp = Date.now()
  const filename = `${timestamp}_create_better_auth_tables.ts`
  return path.join(basePath, 'database', 'migrations', filename)
}

/**
 * Renders a Lucid migration from a Better Auth table schema, writes it
 * to disk, and returns the output file path.
 */
export async function createSchema(options: CreateSchemaOptions): Promise<string> {
  const basePath = options.basePath ?? process.cwd()
  const outputPath = options.file ?? makeDefaultMigrationPath(basePath)

  const code = renderLucidMigration(options.tables)

  // Ensure parent directory exists
  await fs.mkdir(path.dirname(outputPath), { recursive: true })

  // Write the migration file
  await fs.writeFile(outputPath, code, 'utf-8')

  return outputPath
}
