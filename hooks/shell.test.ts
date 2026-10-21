import { expect, test } from 'claude-code/testing'

import type { EngineInterface } from 'claude-code'

import { fill, quote, run } from './run'
import { TERMINALS } from './terminals'

test('quote wraps in single quotes and escapes embedded ones', () => {
  expect(quote('plain')).toBe("'plain'")
  expect(quote('')).toBe("''")
  expect(quote("it's")).toBe(`'it'\\''s'`)
  expect(quote('a $HOME `id`\nb')).toBe("'a $HOME `id`\nb'")
})

test('fill quotes each value once and leaves unknown placeholders alone', () => {
  expect(fill('open {url} {other}', { url: "a'b" })).toBe(`open 'a'\\''b' {other}`)
})

test('fill does not expand placeholders found inside a value', () => {
  expect(fill('echo {prompt}', { prompt: '{dir}', dir: 'x' })).toBe("echo '{dir}'")
})

test('fill treats inherited object keys as unknown placeholders', () => {
  expect(fill('echo {constructor} {toString} {__proto__}', {})).toBe('echo {constructor} {toString} {__proto__}')
})

test('run turns a command that cannot finish into a failed result', async () => {
  const stuck = { process: { run: () => Promise.reject(new Error('timed out')) } } as unknown as EngineInterface
  const result = await run(stuck, 'sleep 99')
  expect(result.exitCode).toBe(1)
  expect(result.stderr).toBe('timed out')
})

test('Rio and Ghostty hand the prompt over in an environment variable, since fish has no $0 for -c', () => {
  for (const name of ['Rio', 'Ghostty']) {
    const command = fill(TERMINALS.find(t => t.name === name)?.command ?? '', { dir: '/d', prompt: "it's" })
    expect(command).toContain(`--env PR_DECK_PROMPT=${quote("it's")} `)
    expect(command).toContain('"$PR_DECK_PROMPT"')
    expect(command).not.toContain('$0')
  }
})

test('shellPrompt comes out quoted twice, so the pane shell sees the quoted prompt', () => {
  const herdr = TERMINALS.find(t => t.name === 'a herdr tab')
  const prompt = "it's"
  const command = fill(herdr?.command ?? '', { dir: '/d', label: 'l', shellPrompt: quote(prompt) })
  expect(command).toContain(quote(quote(prompt)))
})
