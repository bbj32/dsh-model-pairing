import { mkdtemp, rm } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'

// A real DSH storage-domain and JSON backend, confined to one fresh temporary directory.
export async function mountStorage(root) {
  const installed = createRequire(join(process.env.DSH_INSTALL_DIR, 'package.json'))
  const folder = await mkdtemp(join(tmpdir(), 'dsh-pairing-storage-'))
  for (const [name, config] of [['dsh-storage', {}], ['dsh-storage-json', { root: folder }], ['dsh-storage-domain', { backend: 'json' }]]) {
    const plugin = installed('@deepseek-ai/' + name)
    const fiber = await root.plugin(plugin.default ?? plugin, config)
    if (fiber.error) throw fiber.error
  }
  return async () => {
    if (dirname(resolve(folder)) !== resolve(tmpdir()) || !basename(folder).startsWith('dsh-pairing-storage-')) throw Error('Unexpected temporary storage path ' + folder)
    await rm(folder, { recursive: true, force: true })
  }
}
