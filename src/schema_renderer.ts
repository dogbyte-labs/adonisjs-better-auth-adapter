/*
|--------------------------------------------------------------------------
| Schema renderer
|--------------------------------------------------------------------------
|
| Pure migration string renderer for Lucid migrations. Converts a
| Better Auth table schema into a valid AdonisJS Lucid migration class.
|
*/

import type { DBFieldAttribute } from 'better-auth'

/**
 * Extended field attribute that also supports a `primaryKey` flag.
 * Better Auth's published type does not include `primaryKey`, but the
 * schema generation flow requires it for the `id` column pattern.
 */
export interface ExtendedFieldAttribute extends DBFieldAttribute {
  primaryKey?: boolean
  index?: boolean
  autoIncrement?: boolean
}

/**
 * A single table entry in the schema. Supports both shapes:
 * - Full type: `{ modelName, fields, disableMigrations?, order? }` (BetterAuthDBSchema)
 * - Runtime `getSchema()` output: `{ fields, order? }` (keyed by table name, no modelName)
 *
 * Also supports `disableMigration` as a legacy/alternative form.
 */
interface TableEntry {
  modelName?: string
  fields: Record<string, ExtendedFieldAttribute>
  disableMigrations?: boolean
  disableMigration?: boolean
  order?: number
}

export type SchemaInput = Record<string, TableEntry>

/**
 * Supported Better Auth field types and their Knex column method names.
 */
const COLUMN_TYPE_MAP: Record<string, string> = {
  string: 'string',
  number: 'integer',
  boolean: 'boolean',
  date: 'timestamp',
  json: 'json',
}

/**
 * Converts a camelCase string to snake_case.
 */
function toSnakeCase(str: string): string {
  return str.replace(/([A-Z])/g, '_$1').toLowerCase()
}

/**
 * Resolves the DB column name for a field entry.
 * Uses `fieldName` when explicitly set, otherwise converts the key to snake_case.
 */
function resolveColumnName(fieldKey: string, field: ExtendedFieldAttribute): string {
  return field.fieldName ?? toSnakeCase(fieldKey)
}

/**
 * Renders a field default into a safe Lucid migration expression.
 *
 * Supported defaults:
 * - string, number, boolean
 * - Date instances (serialized as ISO strings)
 * - date field function defaults, rendered as `this.now()`
 *
 * Unsupported shapes fail fast instead of silently drifting from the
 * declared schema.
 */
function renderDefaultValue(fieldKey: string, field: ExtendedFieldAttribute): string | null {
  if (field.defaultValue === undefined) {
    return null
  }

  if (typeof field.defaultValue === 'string') {
    return JSON.stringify(field.defaultValue)
  }

  if (typeof field.defaultValue === 'number' || typeof field.defaultValue === 'boolean') {
    return String(field.defaultValue)
  }

  if (field.defaultValue instanceof Date) {
    return JSON.stringify(field.defaultValue.toISOString())
  }

  if (typeof field.defaultValue === 'function') {
    if (field.type === 'date') {
      return 'this.now()'
    }

    // Better Auth's database-backed rate-limit schema uses a bigint field
    // with `defaultValue: () => Date.now()`. The official generator does not
    // encode that as a DB default, so we skip it instead of baking a static
    // timestamp into the migration or throwing on a supported core schema.
    if (
      field.type === 'number' &&
      field.bigint &&
      (fieldKey === 'lastRequest' || field.fieldName === 'lastRequest')
    ) {
      return null
    }

    throw new Error(
      `Unsupported function default for field "${fieldKey}". ` +
        'Only date fields may use function defaults in Lucid migrations.'
    )
  }

  throw new Error(
    `Unsupported defaultValue for field "${fieldKey}". ` +
      'Only string, number, boolean, Date, and date-field functions are supported.'
  )
}

/**
 * Validates that a field has a supported type, throwing on missing,
 * non-string, or unrecognised type values.
 */
function validateFieldType(fieldKey: string, field: ExtendedFieldAttribute): void {
  const fieldType = field.type

  // bigint with number type is always valid
  if (field.bigint && fieldType === 'number') return

  if (typeof fieldType !== 'string') {
    throw new Error(
      `Missing or unsupported field type for field "${fieldKey}". ` +
        `Expected a string, got ${typeof fieldType}. ` +
        `Supported types: ${Object.keys(COLUMN_TYPE_MAP).join(', ')}`
    )
  }

  if (!(fieldType in COLUMN_TYPE_MAP)) {
    throw new Error(
      `Unsupported field type "${fieldType}" for field "${fieldKey}". ` +
        `Supported types: ${Object.keys(COLUMN_TYPE_MAP).join(', ')}`
    )
  }
}

/**
 * Renders a single field as a Knex/Lucid column builder call.
 */
function renderField(fieldKey: string, field: ExtendedFieldAttribute): string {
  const columnName = resolveColumnName(fieldKey, field)
  const fieldType = field.type

  validateFieldType(fieldKey, field)

  if (field.autoIncrement) {
    if (fieldType !== 'number' || !field.primaryKey) {
      throw new Error(
        `Unsupported autoIncrement field "${fieldKey}". ` +
          'Lucid migrations only support autoIncrement on numeric primary keys.'
      )
    }

    return `      table.increments('${columnName}')`
  }

  // Determine the column method
  let columnMethod: string
  if (field.bigint && fieldType === 'number') {
    columnMethod = 'bigInteger'
  } else {
    columnMethod = COLUMN_TYPE_MAP[fieldType as string]
  }

  let line = `      table.${columnMethod}('${columnName}')`

  // Nullability: required defaults to true when omitted
  const isRequired = field.required !== false
  if (isRequired) {
    line += '.notNullable()'
  } else {
    line += '.nullable()'
  }

  // Primary key
  if (field.primaryKey) {
    line += '.primary()'
  }

  // Unique
  if (field.unique) {
    line += '.unique()'
  }

  // Index
  if (field.index) {
    line += '.index()'
  }

  const defaultValue = renderDefaultValue(fieldKey, field)
  if (defaultValue !== null) {
    line += `.defaultTo(${defaultValue})`
  }

  return line
}

/**
 * Validates that a `references` value is a well-formed object with
 * `model` and `field` string properties.
 */
function validateReferences(
  fieldKey: string,
  references: unknown
): asserts references is { model: string; field: string; onDelete?: string } {
  if (typeof references !== 'object' || references === null) {
    throw new Error(
      `Invalid references for field "${fieldKey}": references must be an object, ` +
        `got ${typeof references}`
    )
  }

  const ref = references as Record<string, unknown>

  if (!ref.model || typeof ref.model !== 'string') {
    throw new Error(
      `Invalid references for field "${fieldKey}": references.model must be a non-empty string`
    )
  }

  if (!ref.field || typeof ref.field !== 'string') {
    throw new Error(
      `Invalid references for field "${fieldKey}": references.field must be a non-empty string`
    )
  }
}

/**
 * Renders foreign key constraints for fields with `references`.
 */
function renderForeignKeys(fields: Record<string, ExtendedFieldAttribute>): string[] {
  const lines: string[] = []

  for (const [fieldKey, field] of Object.entries(fields)) {
    if (!field.references) continue

    validateReferences(fieldKey, field.references)

    const columnName = resolveColumnName(fieldKey, field)
    const refTable = field.references.model
    const refField = field.references.field
    const onDelete = field.references.onDelete ?? 'cascade'

    lines.push(
      `      table.foreign('${columnName}').references('${refField}').inTable('${refTable}').onDelete('${onDelete}')`
    )
  }

  return lines
}

/**
 * Returns true when a table entry is marked as migration-disabled.
 */
function isMigrationDisabled(entry: TableEntry): boolean {
  return entry.disableMigrations === true || entry.disableMigration === true
}

/**
 * Resolves the table name from an entry. Uses `modelName` when present
 * (BetterAuthDBSchema shape), otherwise falls back to the object key
 * (getSchema() runtime shape).
 */
function resolveTableName(key: string, entry: TableEntry): string {
  return entry.modelName ?? key
}

/**
 * Returns true when the fields map already contains an `id` column
 * (checking both the key and any explicit `fieldName` overrides).
 */
function hasIdColumn(fields: Record<string, ExtendedFieldAttribute>): boolean {
  for (const [fieldKey, field] of Object.entries(fields)) {
    const columnName = resolveColumnName(fieldKey, field)
    if (columnName === 'id') return true
  }
  return false
}

/**
 * Renders the auto-synthesized `id` primary key line.
 * Better Auth's migration generator adds `id` separately — it is not
 * included in the `fields` from `getSchema()`.
 */
function renderIdColumn(): string {
  return `      table.string('id').notNullable().primary()`
}

/**
 * Renders a complete AdonisJS Lucid migration class string from a
 * Better Auth table schema.
 *
 * Accepts both schema shapes:
 * - `BetterAuthDBSchema` (entries with `modelName`)
 * - `getSchema()` runtime output (entries keyed by table name, no `modelName`)
 *
 * This is a pure function — it does not touch the filesystem.
 */
export function renderLucidMigration(tables: SchemaInput): string {
  const entries = Object.entries(tables).filter(([, entry]) => !isMigrationDisabled(entry))

  // Sort by order, defaulting to Infinity so unordered tables come last.
  // Use a stable sort by tracking original insertion index for ties.
  const indexed = entries.map(([key, entry], i) => ({ key, entry, index: i }))
  indexed.sort((a, b) => {
    const orderDiff = (a.entry.order ?? Infinity) - (b.entry.order ?? Infinity)
    return orderDiff !== 0 ? orderDiff : a.index - b.index
  })

  const tableBlocks: string[] = []
  const tableNames: string[] = []

  for (const { key, entry } of indexed) {
    const tableName = resolveTableName(key, entry)
    tableNames.push(tableName)

    const fieldLines: string[] = []

    // Auto-synthesize id primary key when not present in fields
    if (!hasIdColumn(entry.fields)) {
      fieldLines.push(renderIdColumn())
    }

    for (const [fieldKey, field] of Object.entries(entry.fields)) {
      fieldLines.push(renderField(fieldKey, field))
    }

    const foreignKeyLines = renderForeignKeys(entry.fields)

    const allLines = [...fieldLines, ...foreignKeyLines]

    tableBlocks.push(
      [`    this.schema.createTable('${tableName}', (table) => {`, ...allLines, '    })'].join('\n')
    )
  }

  // down() drops tables in reverse order to respect foreign key constraints
  const dropLines = [...tableNames]
    .reverse()
    .map((name) => `    this.schema.dropTableIfExists('${name}')`)

  const lines = [
    "import { BaseSchema } from '@adonisjs/lucid/schema'",
    '',
    'export default class extends BaseSchema {',
    '  async up() {',
    tableBlocks.join('\n\n'),
    '  }',
    '',
    '  async down() {',
    ...dropLines,
    '  }',
    '}',
    '',
  ]

  return lines.join('\n')
}
