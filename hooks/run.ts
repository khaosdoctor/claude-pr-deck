import type { EngineInterface } from 'claude-code'

// Every external command in the mod is a shell template with {name} placeholders,
// so users can swap any of them from /config. Values are single-quoted before they go in.
export const quote = (value: string) => `'${value.replaceAll("'", `'\\''`)}'`

export const fill = (template: string, vars: Record<string, string>) =>
  template.replace(/\{(\w+)\}/g, (match, name: string) => (name in vars ? quote(vars[name] ?? '') : match))

// a function declaration, so `claude plugin validate` can follow `$` through the import
export function run($: EngineInterface, template: string, vars: Record<string, string> = {}) {
  return $.process.run(['sh', '-c', fill(template, vars)])
}
