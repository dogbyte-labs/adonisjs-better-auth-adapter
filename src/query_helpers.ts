/*
|--------------------------------------------------------------------------
| Query helpers
|--------------------------------------------------------------------------
|
| Translates Better Auth where clauses and query options to Lucid
| query builder calls. Keeps the adapter focused on CRUD orchestration.
|
*/

import type { DatabaseQueryBuilderContract } from '@adonisjs/lucid/types/querybuilder'

/**
 * A single where clause as provided by Better Auth's `transformWhereClause`.
 * All fields are required after transformation (CleanedWhere).
 */
export interface WhereClause {
  field: string
  value: unknown
  operator: string
  connector: 'AND' | 'OR'
}

/**
 * Escapes LIKE wildcard characters in user-supplied values so they are
 * treated as literals. Uses backslash as the escape character, paired
 * with an explicit `ESCAPE '\'` clause in the generated SQL.
 */
export function escapeLikeValue(input: string): string {
  return input.replace(/[%_\\]/g, '\\$&')
}

/**
 * Applies a LIKE clause with proper escaping via whereRaw.
 * The `ESCAPE '\'` clause ensures backslash-escaped wildcards
 * are treated as literals across SQLite, PostgreSQL, and MySQL.
 *
 * Uses Knex `??` identifier binding for the column name to stay
 * dialect-agnostic (backticks on MySQL, double-quotes on PG/SQLite).
 */
function applyLike(builder: DatabaseQueryBuilderContract, field: string, pattern: string): void {
  builder.whereRaw(`?? LIKE ? ESCAPE '\\'`, [field, pattern])
}

/**
 * Applies a single operator-based where clause to the builder.
 */
function applySingleWhere(builder: DatabaseQueryBuilderContract, clause: WhereClause): void {
  const { field, value, operator } = clause

  switch (operator) {
    case 'eq':
      builder.where(field, value as string | number)
      break
    case 'ne':
      builder.whereNot(field, value as string | number)
      break
    case 'lt':
      builder.where(field, '<', value as string | number)
      break
    case 'lte':
      builder.where(field, '<=', value as string | number)
      break
    case 'gt':
      builder.where(field, '>', value as string | number)
      break
    case 'gte':
      builder.where(field, '>=', value as string | number)
      break
    case 'in':
      builder.whereIn(field, value as (string | number)[])
      break
    case 'not_in':
      builder.whereNotIn(field, value as (string | number)[])
      break
    case 'starts_with':
      applyLike(builder, field, `${escapeLikeValue(String(value))}%`)
      break
    case 'ends_with':
      applyLike(builder, field, `%${escapeLikeValue(String(value))}`)
      break
    case 'contains':
      applyLike(builder, field, `%${escapeLikeValue(String(value))}%`)
      break
    default:
      builder.where(field, value as string | number)
  }
}

/**
 * Applies an array of where clauses to a Lucid query builder.
 *
 * Preserves Better Auth's left-to-right connector semantics: the
 * connector on clause[i] (i > 0) describes how clause[i] joins to
 * the accumulated result of all preceding clauses.
 *
 * Because SQL gives AND higher precedence than OR, we must parenthesise
 * the accumulated left-hand side whenever the connector *changes* from
 * the previous effective connector.
 *
 * Examples (first clause's connector is ignored):
 *   `[A, B(OR), C(AND)]`  → `(A OR B) AND C`
 *   `[A, B(AND), C(OR)]`  → `(A AND B) OR C`
 *   `[A, B(OR), C(OR)]`   → `A OR B OR C`
 */
export function applyWhere(
  builder: DatabaseQueryBuilderContract,
  where: WhereClause[]
): DatabaseQueryBuilderContract {
  if (where.length === 0) return builder

  if (where.length === 1) {
    applySingleWhere(builder, where[0])
    return builder
  }

  // Split the flat clause list into segments of the same connector.
  // Each segment holds consecutive clauses whose connector value is
  // the same (treating the first clause's connector as equal to clause[1]'s).
  //
  // The connector on the *first clause of a segment* (except segment 0)
  // tells us how that whole segment joins to everything before it.

  type Segment = { connector: 'AND' | 'OR'; clauses: WhereClause[] }
  const segments: Segment[] = []

  // The first clause adopts clause[1]'s connector for grouping purposes.
  let prevConnector: 'AND' | 'OR' = where[1].connector
  let current: Segment = { connector: prevConnector, clauses: [where[0]] }

  for (let i = 1; i < where.length; i++) {
    const conn = where[i].connector
    if (conn === prevConnector) {
      current.clauses.push(where[i])
    } else {
      segments.push(current)
      current = { connector: conn, clauses: [where[i]] }
      prevConnector = conn
    }
  }
  segments.push(current)

  // If every clause shares the same connector we can avoid nesting.
  if (segments.length === 1) {
    const seg = segments[0]
    if (seg.connector === 'OR') {
      // All OR — wrap in a single parenthesised group
      builder.where((sub) => {
        const s = sub as unknown as DatabaseQueryBuilderContract
        applySingleWhere(s, seg.clauses[0])
        for (let i = 1; i < seg.clauses.length; i++) {
          s.orWhere((inner) => {
            applySingleWhere(inner as unknown as DatabaseQueryBuilderContract, seg.clauses[i])
          })
        }
      })
    } else {
      // All AND — apply each directly
      for (const clause of seg.clauses) {
        applySingleWhere(builder, clause)
      }
    }
    return builder
  }

  // Multiple segments: fold left.  Each segment's connector tells us
  // whether to AND or OR it onto the accumulated SQL expression.  We
  // wrap the entire accumulation so far in a sub-expression whenever we
  // attach a new segment, keeping left-to-right associativity.
  //
  // Build a function that applies the accumulated clauses to a builder,
  // then fold each successive segment on top of it.

  type ApplyFn = (b: DatabaseQueryBuilderContract) => void

  let accFn: ApplyFn = (b) => {
    applySegmentClauses(b, segments[0])
  }

  for (let i = 1; i < segments.length; i++) {
    const seg = segments[i]
    const prevFn = accFn

    if (seg.connector === 'OR') {
      accFn = (b) => {
        // (accumulated) OR (segment)
        b.where((sub) => {
          prevFn(sub as unknown as DatabaseQueryBuilderContract)
        })
        b.orWhere((sub) => {
          applySegmentClauses(sub as unknown as DatabaseQueryBuilderContract, seg)
        })
      }
    } else {
      accFn = (b) => {
        // (accumulated) AND (segment)
        b.where((sub) => {
          prevFn(sub as unknown as DatabaseQueryBuilderContract)
        })
        b.where((sub) => {
          applySegmentClauses(sub as unknown as DatabaseQueryBuilderContract, seg)
        })
      }
    }
  }

  accFn(builder)
  return builder
}

/**
 * Applies all clauses within a single same-connector segment.
 */
function applySegmentClauses(
  builder: DatabaseQueryBuilderContract,
  segment: { connector: 'AND' | 'OR'; clauses: WhereClause[] }
): void {
  applySingleWhere(builder, segment.clauses[0])
  for (let i = 1; i < segment.clauses.length; i++) {
    if (segment.connector === 'OR') {
      builder.orWhere((sub) => {
        applySingleWhere(sub as unknown as DatabaseQueryBuilderContract, segment.clauses[i])
      })
    } else {
      applySingleWhere(builder, segment.clauses[i])
    }
  }
}

/**
 * Applies optional sorting, limit, and offset to a Lucid query builder.
 */
export function applyPagination(
  builder: DatabaseQueryBuilderContract,
  options: {
    sortBy?: { field: string; direction: 'asc' | 'desc' }
    limit?: number
    offset?: number
  }
): DatabaseQueryBuilderContract {
  if (options.sortBy) {
    builder.orderBy(options.sortBy.field, options.sortBy.direction)
  }

  if (options.limit !== undefined) {
    builder.limit(options.limit)
  }

  if (options.offset !== undefined) {
    builder.offset(options.offset)
  }

  return builder
}
