import type { ConfigRow, ConfigValue, Elements, EngineInterface, PluginOptions } from 'claude-code'

import { run } from './run'

type Deps = {
  options: PluginOptions
  // wraps a button label in the buttonStyle option
  label: (text: string) => string
  back: () => void
  openIgnored: () => void
}

const SECTIONS = ['Display', 'Hosts and trackers', 'Commands']
// fields not listed here are Display
const SECTION_OF: Record<string, string> = {
  providers: 'Hosts and trackers',
  tracker: 'Hosts and trackers',
  trackerUrl: 'Hosts and trackers',
  githubCommand: 'Hosts and trackers',
  gitlabCommand: 'Hosts and trackers',
  giteaCommand: 'Hosts and trackers',
  azdoCommand: 'Hosts and trackers',
  openCommand: 'Commands',
  editorCommand: 'Commands',
  remoteCommand: 'Commands',
  cloneDir: 'Commands',
  newSessionCommand: 'Commands',
}

// The /config rows of this plugin, drawn in the pane. A save reloads the module with the new options.
// a function declaration, so `claude plugin validate` can follow `$` through the import
export async function configScreen($: EngineInterface, { Box, Text, Button, Input }: Elements['terminal' | 'desktop' | 'vscode'], { options, label, back, openIgnored }: Deps) {
  const prefix = `${$.plugin.name}.`
  const rows = (await $.config.list()).filter(row => row.key.startsWith(prefix))

  const save = async (row: ConfigRow, value: ConfigValue) => {
    const { deny } = await $.config.set({ key: row.key, value })
    $.ui.toast(deny ?? `Saved ${row.label}`)
  }
  // ponytail: asks the engine to run the built-in /config; if it refuses, the toast says what to type
  const openInClaude = () => $.command.run({ command: 'config' }).catch(() => $.ui.toast('Type /config in the prompt'))
  // ponytail: the user-level settings file, where pluginConfigs[<plugin>].options is written unless the plugin is set up per project
  const openSettings = async () => {
    const dir = (await $.env.get('CLAUDE_CONFIG_DIR')) || `${(await $.env.get('HOME')) ?? ''}/.claude`
    const editor = options.editorCommand
    await run($, typeof editor === 'string' ? editor : '', { path: `${dir}/settings.json` })
  }

  const control = (row: ConfigRow) => {
    if (row.isLocked) return <Text dimColor>{String(row.value)} (locked)</Text>
    if (row.kind === 'boolean') {
      return <Button key={row.key} label={label(row.value ? '● on' : '○ off')} variant={row.value ? 'primary' : undefined} onPress={() => void save(row, !row.value)} />
    }
    if (row.kind === 'choice') {
      return (
        <Box flexWrap="wrap" columnGap={1}>
          {(row.options ?? []).map(option => (
            <Button key={`${row.key}:${option}`} label={option} variant={row.value === option ? 'primary' : undefined} onPress={() => void save(row, option)} />
          ))}
        </Box>
      )
    }
    return <Input key={row.key} value={String(row.value)} placeholder="empty" onSubmit={value => void save(row, row.kind === 'number' ? Number(value) : value)} />
  }

  return (
    <Box flexDirection="column">
      <Box flexDirection="column" backgroundColor="userMessageBackground" marginTop={1}>
        <Box justifyContent="center">
          <Text bold color="claude">PR DECK CONFIG</Text>
        </Box>
        <Box justifyContent="center" flexWrap="wrap" columnGap={1}>
          <Button key="back" label={label('← Back')} onPress={back} />
          <Button key="open-claude" label={label('⚙ Open in Claude /config')} onPress={() => void openInClaude()} />
          <Button key="open-file" label={label('✎ Open file')} onPress={() => void openSettings()} />
          <Button key="open-ignored" plain dimColor label={label('✎ open ignored list')} onPress={openIgnored} />
        </Box>
      </Box>
      {SECTIONS.map(section => {
        const mine = rows.filter(row => (SECTION_OF[row.key.slice(prefix.length)] ?? 'Display') === section)
        return (
          mine.length > 0 && (
            <Box key={section} flexDirection="column" marginTop={1}>
              <Text bold dimColor>{section}</Text>
              {mine.map(row => (
                <Box key={row.key} flexDirection="column" marginTop={1}>
                  <Text bold>{row.label}</Text>
                  {row.description && <Text dimColor wrap="truncate-end">{row.description}</Text>}
                  {control(row)}
                </Box>
              ))}
            </Box>
          )
        )
      })}
    </Box>
  )
}
