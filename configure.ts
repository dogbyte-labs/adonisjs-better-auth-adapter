/*
|--------------------------------------------------------------------------
| Configure hook
|--------------------------------------------------------------------------
|
| The configure hook is called when someone runs "node ace configure <package>"
| command. You are free to perform any operations inside this function to
| configure the package.
|
| To make things easier, you have access to the underlying "Configure"
| instance and you can use codemods to modify the source files.
|
*/

import type Configure from '@adonisjs/core/commands/configure'
import { stubsRoot } from './stubs/main.js'

export async function configure(command: Configure) {
  const codemods = await command.createCodemods()

  await codemods.makeUsingStub(stubsRoot, 'config/better_auth.stub', {})
  await codemods.makeUsingStub(stubsRoot, 'auth.stub', {})
  await codemods.defineEnvVariables({
    BETTER_AUTH_SECRET: 'Please generate a secure secret',
    BETTER_AUTH_URL: 'http://localhost:3333',
  })
}
