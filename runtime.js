import { createRequire } from 'node:module'
import { isAbsolute, join } from 'node:path'

// Linked bundles can live outside the Host's node_modules tree. Use the packages
// from the running DSH installation so schema and adapter identities match.
const anchors = [
  process.env.DSH_INSTALL_DIR && join(process.env.DSH_INSTALL_DIR, 'package.json'),
  process.argv[1] && isAbsolute(process.argv[1]) && process.argv[1],
  process.resourcesPath && join(process.resourcesPath, 'app.asar', 'dsh', 'package.json'),
  import.meta.url,
].filter(Boolean)

function installedModules() {
  for (const anchor of anchors) {
    const require = createRequire(anchor)
    try {
      const entry = require.resolve('@deepseek-ai/dsh-llm')
      return createRequire(entry)
    } catch (error) {
      if (error.code !== 'MODULE_NOT_FOUND') throw error
    }
  }
  throw new Error('The orchestration plugin needs the DSH Host installation and its dsh-llm package.')
}

const fromHost = installedModules()
export const { BlockAssembler, LlmAdapter, createUserMessage, LlmError } = fromHost('@deepseek-ai/dsh-llm')
export const { z } = fromHost('zod')
export const schema = fromHost('@deepseek-ai/schemastery')
