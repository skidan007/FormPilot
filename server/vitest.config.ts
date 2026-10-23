import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [
    {
      name: 'resolve-src-js-specifiers-to-typescript',
      enforce: 'pre',
      resolveId(source, importer) {
        const normalizedImporter = importer?.replaceAll('\\', '/')

        if (
          !normalizedImporter?.includes('/src/') ||
          !source.startsWith('.') ||
          !source.endsWith('.js')
        ) {
          return null
        }

        return this.resolve(`${source.slice(0, -3)}.ts`, importer, {
          skipSelf: true,
        })
      },
    },
  ],
})
