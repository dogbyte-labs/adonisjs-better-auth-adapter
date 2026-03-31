/*
|--------------------------------------------------------------------------
| Lucid adapter
|--------------------------------------------------------------------------
|
| Better Auth adapter backed by Lucid's query client. Uses
| `createAdapterFactory` and stays at the query-builder layer
| so that transaction rebinding and schema remapping work cleanly.
|
*/

import type { BetterAuthOptions } from 'better-auth'
import type { AdapterFactory } from 'better-auth/adapters'
import { createAdapterFactory } from 'better-auth/adapters'
import type { LucidAdapterConfig } from './types.js'
import type { DatabaseQueryBuilderContract } from '@adonisjs/lucid/types/querybuilder'
import type { DialectContract } from '@adonisjs/lucid/types/database'
import { applyPagination, applyWhere, type WhereClause } from './query_helpers.js'
import { createSchema } from './create_schema.js'
import {
  renderLucidMigration,
  type ExtendedFieldAttribute,
  type SchemaInput,
} from './schema_renderer.js'

const SQLITE_DIALECTS: ReadonlySet<DialectContract['name']> = new Set([
  'sqlite3',
  'better-sqlite3',
  'libsql',
])

/**
 * Returns `true` when the Lucid dialect is a SQLite variant.
 */
function isSqliteDialect(name: DialectContract['name']): boolean {
  return SQLITE_DIALECTS.has(name)
}

function usesSerialIds(options: BetterAuthOptions): boolean {
  return options.advanced?.database?.generateId === 'serial'
}

function normalizeSchemaForCreateSchema(
  tables: Record<string, { fields: Record<string, ExtendedFieldAttribute> }>,
  options: BetterAuthOptions
): SchemaInput {
  if (!usesSerialIds(options)) {
    return tables as SchemaInput
  }

  return Object.fromEntries(
    Object.entries(tables).map(([tableName, entry]) => {
      const normalizedFields: Record<string, ExtendedFieldAttribute> = {
        ...entry.fields,
        id: {
          type: 'number',
          fieldName: 'id',
          required: true,
          primaryKey: true,
          autoIncrement: true,
        },
      }

      for (const [fieldKey, field] of Object.entries(normalizedFields)) {
        if (field.references?.field === 'id') {
          normalizedFields[fieldKey] = {
            ...field,
            type: 'number',
          }
        }
      }

      return [tableName, { ...entry, fields: normalizedFields }]
    })
  )
}

export const lucidAdapter = (config: LucidAdapterConfig): AdapterFactory<BetterAuthOptions> => {
  const isSqlite = isSqliteDialect(config.client.dialect.name)

  return (options: BetterAuthOptions) => {
    const factory: ReturnType<typeof createAdapterFactory> = createAdapterFactory({
      config: {
        adapterId: 'lucid',
        adapterName: 'Lucid Adapter',
        usePlural: config.usePlural ?? false,
        debugLogs: config.debugLogs ?? false,
        disableIdGeneration: config.disableIdGeneration ?? false,
        supportsJSON: config.supportsJSON ?? !isSqlite,
        supportsDates: config.supportsDates ?? !isSqlite,
        supportsBooleans: config.supportsBooleans ?? !isSqlite,
        supportsNumericIds: true,
        transaction: async <R>(cb: (trx: any) => Promise<R>): Promise<R> => {
          if (config.client.isTransaction) {
            return cb(factory(options))
          }

          return (config.client as { transaction: Function }).transaction(async (trx: any) => {
            return cb(lucidAdapter({ ...config, client: trx })(options))
          })
        },
      },
      adapter: ({ getFieldName, options: currentOptions }) => ({
        create: async ({ model, data }) => {
          const idCol = getFieldName({ model, field: 'id' })
          const result = await config.client
            .insertQuery()
            .table(model)
            .returning(idCol)
            .insert(data as Record<string, unknown>)

          // Derive the created row's id portably across dialects:
          //  - data[idCol]: present when Better Auth (or the consumer) generates the id
          //  - result[0][idCol]: PostgreSQL returning() yields { idCol: value }
          //  - result[0]: SQLite returning() is a no-op; yields lastInsertRowid (number)
          const raw = result[0]
          const id = data[idCol] ?? (typeof raw === 'object' && raw !== null ? raw[idCol] : raw)

          const row = await config.client.from(model).where(idCol, id).first()
          return row
        },

        findOne: async ({ model, where, select }) => {
          const builder = config.client.from(model)

          if (select && select.length > 0) {
            builder.select(select.map((field) => getFieldName({ model, field })))
          }

          applyWhere(builder, where as WhereClause[])

          const row = await builder.first()
          return row ?? null
        },

        findMany: async ({ model, where, limit, sortBy, offset, select }) => {
          const builder = config.client.from(model)

          if (select && select.length > 0) {
            builder.select(select.map((field) => getFieldName({ model, field })))
          }

          if (where && where.length > 0) {
            applyWhere(builder, where as WhereClause[])
          }

          const mappedSortBy = sortBy
            ? { field: getFieldName({ model, field: sortBy.field }), direction: sortBy.direction }
            : undefined
          applyPagination(builder, { sortBy: mappedSortBy, limit, offset })

          const rows = await builder
          return rows ?? []
        },

        count: async ({ model, where }) => {
          const builder = config.client.from(model)

          if (where && where.length > 0) {
            applyWhere(builder, where as WhereClause[])
          }

          const result = await builder.count('* as total')
          return Number(result[0]?.total ?? 0)
        },

        update: async ({ model, where, update: updateData }) => {
          // Snapshot the id before updating so the refetch is stable
          // even when the update mutates a field used in the where clause.
          const idCol = getFieldName({ model, field: 'id' })
          const existing = await config.client
            .from(model)
            .select(idCol)
            .where((sub) => {
              applyWhere(sub as unknown as DatabaseQueryBuilderContract, where as WhereClause[])
            })
            .first()

          if (!existing) {
            return null
          }

          await config.client
            .from(model)
            .where(idCol, existing[idCol])
            .update(updateData as Record<string, unknown>)

          const row = await config.client.from(model).where(idCol, existing[idCol]).first()
          return row ?? null
        },

        updateMany: async ({ model, where, update: updateData }) => {
          const builder = config.client.from(model)
          applyWhere(builder, where as WhereClause[])

          const affected = (await builder.update(
            updateData as Record<string, unknown>
          )) as unknown as number
          return affected
        },

        delete: async ({ model, where }) => {
          const builder = config.client.from(model)
          applyWhere(builder, where as WhereClause[])
          await builder.del()
        },

        deleteMany: async ({ model, where }) => {
          const builder = config.client.from(model)
          applyWhere(builder, where as WhereClause[])

          const deleted = (await builder.del()) as unknown as number
          return deleted
        },

        createSchema: async ({ file, tables }) => {
          const normalizedTables = normalizeSchemaForCreateSchema(
            tables as Record<string, { fields: Record<string, ExtendedFieldAttribute> }>,
            currentOptions
          )
          const code = renderLucidMigration(normalizedTables)
          const outputPath = await createSchema({ file, tables: normalizedTables })

          return { code, path: outputPath }
        },
      }),
    })

    return factory(options)
  }
}
