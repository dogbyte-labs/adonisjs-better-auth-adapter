/*
|--------------------------------------------------------------------------
| Better Auth adapter contract tests
|--------------------------------------------------------------------------
|
| Uses the official Better Auth test-utils contract suites to verify
| the Lucid adapter conforms to the expected adapter behavior.
|
| This file runs under Vitest (not Japa), matching the test-utils
| requirement of a Vitest-compatible test runner.
|
*/

import {
  normalTestSuite,
  testAdapter,
  transactionsTestSuite,
} from '@better-auth/test-utils/adapter'

import {
  cleanupContractDatabase,
  makeContractAdapter,
  runContractMigrations,
} from '../helpers/lucid_test_harness.js'

const { execute } = await testAdapter({
  adapter: async () => makeContractAdapter(),
  runMigrations: async (betterAuthOptions) => runContractMigrations(betterAuthOptions),
  tests: [normalTestSuite(), transactionsTestSuite()],
  onFinish: async () => cleanupContractDatabase(),
})

execute()
