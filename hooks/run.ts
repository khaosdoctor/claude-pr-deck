import type { EngineInterface, ProcessRunInit, ProcessRunResult } from 'claude-code'

// Every external command in the mod is a shell template with {name} placeholders,
// so users can swap any of them from /config. Values are single-quoted before they go in.
export const quote = (value: string) => `'${value.replaceAll("'", `'\\''`)}'`

// own keys only: `in` also matches inherited names, so {constructor} would crash quote() on a function
export const fill = (template: string, vars: Record<string, string>) =>
  template.replace(/\{(\w+)\}/g, (match, name: string) => (Object.hasOwn(vars, name) ? quote(vars[name] ?? '') : match))

// $.process.run rejects when the command outlives its 30 s budget; that comes back as a failed result, so callers that toast stderr show it
// a function declaration, so `claude plugin validate` can follow `$` through the import
export async function run($: EngineInterface, template: string, vars: Record<string, string> = {}, init?: ProcessRunInit): Promise<ProcessRunResult> {
  try {
    return await $.process.run(['sh', '-c', fill(template, vars)], init)
  } catch (error) {
    return { exitCode: 1, stdout: '', stderr: error instanceof Error ? error.message : String(error), isStdoutTruncated: false, isStderrTruncated: false }
  }
}

// the system's own opener: xdg-open on Linux, the default text editor on macOS
const SYSTEM_OPEN = 'if command -v xdg-open >/dev/null; then xdg-open {path}; else open -t {path}; fi'

// A terminal editor (vim, nano) has no terminal here and hangs until killed, so a command still running after a few seconds counts as failed, like one that errors; both fall back to the system opener.
export async function openInEditor($: EngineInterface, template: string, path: string): Promise<ProcessRunResult> {
  const result = await run($, template, { path }, { stdin: '', timeoutMs: 5000 })
  if (result.exitCode === 0) return result
  return run($, SYSTEM_OPEN, { path })
}
