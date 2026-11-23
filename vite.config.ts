import { writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { defineConfig, type Plugin } from 'vitest/config'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const LESSON_PATH = fileURLToPath(new URL('./src/content/ch6.lesson.json', import.meta.url))
const MAX_BODY_BYTES = 1024 * 1024

function authorSave(): Plugin {
  return {
    name: 'author-save',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/__author/save', (req, res) => {
        const reply = (status: number, message: string) => {
          res.statusCode = status
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify({ message }))
        }
        if (req.method !== 'POST') return reply(405, 'Use POST.')
        if (!String(req.headers['content-type'] ?? '').toLowerCase().startsWith('application/json')) return reply(415, 'Send application/json.')
        const site = req.headers['sec-fetch-site']
        if (site !== undefined && site !== 'same-origin') return reply(403, 'Cross-site requests are not allowed.')
        const chunks: Buffer[] = []
        let size = 0
        req.on('error', () => reply(400, 'The request could not be read.'))
        req.on('data', (c: Buffer) => {
          size += c.length
          if (size <= MAX_BODY_BYTES) chunks.push(c)
        })
        req.on('end', async () => {
          if (size > MAX_BODY_BYTES) return reply(413, 'The lesson is too large.')
          try {
            let lesson: unknown
            try {
              lesson = JSON.parse(Buffer.concat(chunks).toString('utf8'))
            } catch {
              return reply(400, 'The request body is not valid JSON.')
            }
            if (typeof lesson !== 'object' || lesson === null || (lesson as { chapterId?: unknown }).chapterId !== 'ch6') {
              return reply(400, 'Only the ch6 lesson can be saved.')
            }
            await writeFile(LESSON_PATH, JSON.stringify(lesson, null, 2) + '\n')
            reply(200, 'Saved ch6.lesson.json')
          } catch (e) {
            reply(500, e instanceof Error ? e.message : String(e))
          }
        })
      })
    },
  }
}

export default defineConfig({
  plugins: [react(), tailwindcss(), authorSave()],
  test: { environment: 'node' },
})
