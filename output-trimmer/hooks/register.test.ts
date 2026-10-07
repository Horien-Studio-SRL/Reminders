import { test, expect } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'
import { trim } from './register'

type On = Parameters<TestBody>[1]

const log = (n: number, errorAt = -1) => Array.from({ length: n }, (_, i) => (i === errorAt ? `ERROR: boom at ${i}` : `line ${i}`)).join('\n')

// the engine beneath the plugin: Bash answers with `bash`, files land in `files`
const engine = (on: On, bash: object) => {
  const files: Record<string, string> = {}
  on('tool.call', { tool: 'Bash' }, () => bash as never)
  on('env.get', (_$, e) => ({ value: (e as { name: string }).name === 'TEMP' ? 'C:\\Temp' : undefined }) as never)
  on('fs.write', (_$, e) => {
    const { path, text } = e as unknown as { path: string; text: string }
    files[path.replace(/\\/g, '/')] = text
    return { value: undefined } as never
  })
  return files
}

const ok = (stdout: string) => ({ result: { stdout, stderr: '', interrupted: false }, text: stdout })

test('short output is left alone', () => {
  expect(trim(log(150))).toBeUndefined()
})

test('long output keeps its start, end and error lines', () => {
  const out = trim(log(1000, 500))!
  const lines = out.split('\n')
  expect(lines.slice(0, 30)).toEqual(log(30).split('\n'))
  expect(lines).toContain('ERROR: boom at 500')
  expect(lines.at(-1)).toBe('line 999')
  expect(lines).toContain('... 470 lines trimmed ...')
  expect(lines.slice(30, 33)).toEqual(['... 470 lines trimmed ...', 'ERROR: boom at 500', '... 439 lines trimmed ...'])
  expect(lines.length).toBe(93)
})

test('a long Bash result is trimmed and saved whole', async ($, on) => {
  const files = engine(on, ok(log(1000, 500)))
  const r = await $.tool.call({ tool: 'Bash', command: 'npm test', tool_use_id: 'toolu_1' } as never)
  const stdout = (r.result as { stdout: string }).stdout
  expect(stdout.split('\n')[0]).toBe('[output-trimmer kept the start, the end and the error lines. Full output: C:/Temp/claude-trimmed/toolu_1.txt]')
  expect(stdout).toContain('ERROR: boom at 500')
  expect(files['C:/Temp/claude-trimmed/toolu_1.txt']).toBe(`${log(1000, 500)}\n`)
})

test('reads, diffs and the saved file pass through whole', async ($, on) => {
  engine(on, ok(log(1000)))
  for (const command of ['cat big.log', 'git diff', 'cat C:/Temp/claude-trimmed/toolu_1.txt']) {
    const r = await $.tool.call({ tool: 'Bash', command } as never)
    expect((r.result as { stdout: string }).stdout).toBe(log(1000))
  }
})

test('a failed command comes back trimmed as error text', async ($, on) => {
  const files = engine(on, { isError: true, result: undefined, text: `Exit code 1\n${log(1000, 700)}` })
  const r = await $.tool.call({ tool: 'Bash', command: 'npm run build', tool_use_id: 'toolu_2' } as never)
  expect(r.deny).toContain('ERROR: boom at 700')
  expect(r.deny?.split('\n')[1]).toBe('Exit code 1')
  expect(Object.keys(files)).toEqual(['C:/Temp/claude-trimmed/toolu_2.txt'])
})
