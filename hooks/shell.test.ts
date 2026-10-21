import { expect, test } from 'claude-code/testing'

import { fill, quote } from './run'
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

test('shellPrompt comes out quoted twice, so the pane shell sees the quoted prompt', () => {
  const herdr = TERMINALS.find(t => t.name === 'a herdr tab')
  const prompt = "it's"
  const command = fill(herdr?.command ?? '', { dir: '/d', label: 'l', shellPrompt: quote(prompt) })
  expect(command).toContain(quote(quote(prompt)))
})
