import type { ConfigRow, ConfigValue, Elements, EngineInterface, PluginOptions } from 'claude-code'

import { openInEditor } from './run'
import { guarded, textOption } from './snapshot'

type Deps = {
  options: PluginOptions
  // wraps a button label in the buttonStyle option
  label: (text: string) => string
  back: () => void
  openIgnored: () => void
  openPrompts: () => void
}

// fields not listed here are Display
const SECTIONS: Record<string, string[]> = {
  Display: [],
  'Hosts and trackers': ['providers', 'tracker', 'trackerUrl', 'githubCommand', 'gitlabCommand', 'giteaCommand', 'azdoCommand'],
  Commands: ['openCommand', 'editorCommand', 'remoteCommand', 'cloneDir', 'newSessionCommand', 'autoRename', 'stateFile'],
  Prompts: ['sessionName', 'fablePrompt', 'workPrompt', 'watchPrompt'],
}
const sectionOf = (field: string) => Object.keys(SECTIONS).find(section => SECTIONS[section]?.includes(field)) ?? 'Display'

// The /config rows of this plugin, drawn in the pane. A save reloads the module with the new options.
// a function declaration, so `claude plugin validate` can follow `$` through the import
export async function configScreen($: EngineInterface, { Box, Text, Button }: Elements['terminal' | 'desktop' | 'vscode'], { options, label, back, openIgnored, openPrompts }: Deps) {
  const prefix = `${$.plugin.name}.`
  const rows = (await $.config.list()).filter(row => row.key.startsWith(prefix))

  const save = async (row: ConfigRow, value: ConfigValue) => {
    const { deny } = await $.config.set({ key: row.key, value })
    $.ui.toast(deny ?? `Saved ${row.label}`)
  }
  // asks the engine to run the built-in /config; if it refuses, the toast says what to type
  const openInClaude = () => $.command.run({ command: 'config' }).catch(() => $.ui.toast('Type /config in the prompt'))
  // the user-level settings file, where pluginConfigs[<plugin>].options is written unless the plugin is set up per project
  const openSettings = async () => {
    const dir = (await $.env.get('CLAUDE_CONFIG_DIR')) || `${(await $.env.get('HOME')) ?? ''}/.claude`
    const result = await openInEditor($, textOption(options, 'editorCommand'), `${dir}/settings.json`)
    if (result.exitCode !== 0) $.ui.toast(result.stderr.trim().slice(0, 200) || `command exited ${result.exitCode}`)
  }
  // handlers run unawaited, so a rejection from the engine has to end in a toast
  const guard = (task: () => unknown) => void guarded($, task)

  const control = (row: ConfigRow) => {
    if (row.isLocked) return <Text dimColor>{String(row.value)} (locked)</Text>
    if (row.kind === 'boolean') {
      // keys matter here: without one a Button is addressed by its label, and every row shares these labels
      return <Button key={row.key} label={label(row.value ? '● on' : '○ off')} variant={row.value ? 'primary' : undefined} onPress={() => guard(() => save(row, !row.value))} />
    }
    if (row.kind === 'choice') {
      return (
        <Box flexWrap="wrap" columnGap={1}>
          {(row.options ?? []).map(option => (
            <Button key={`${row.key}:${option}`} label={option} variant={row.value === option ? 'primary' : undefined} onPress={() => guard(() => save(row, option))} />
          ))}
        </Box>
      )
    }
    // the pane's Input does not take typing, so text values are edited in /config or the settings file
    return (
      <Box flexWrap="wrap" columnGap={1}>
        <Text wrap="truncate-end">{String(row.value) || <Text dimColor>empty</Text>}</Text>
        <Button key={`${row.key}:claude`} plain label={label('⚙ edit in /config')} onPress={() => guard(openInClaude)} />
        <Button key={`${row.key}:file`} plain label={label('✎ edit in file')} onPress={() => guard(openSettings)} />
      </Box>
    )
  }

  return (
    <Box flexDirection="column">
      <Box flexDirection="column" backgroundColor="userMessageBackground" marginTop={1}>
        <Box justifyContent="center">
          <Text bold color="claude">PR DECK CONFIG</Text>
        </Box>
        <Box justifyContent="center" flexWrap="wrap" columnGap={1}>
          {/* keyed: with buttonStyle icons the three ✎ labels are the same, and a keyless Button is addressed by its label */}
          <Button key="back" label={label('← Back')} onPress={back} />
          <Button key="open-config" label={label('⚙ Open in Claude /config')} onPress={() => guard(openInClaude)} />
          <Button key="open-settings" label={label('✎ Open file')} onPress={() => guard(openSettings)} />
          <Button key="open-ignored" plain dimColor label={label('✎ open ignored list')} onPress={openIgnored} />
          <Button key="open-prompts" plain dimColor label={label('✎ open prompts file')} onPress={openPrompts} />
        </Box>
      </Box>
      {Object.keys(SECTIONS).map(section => {
        const mine = rows.filter(row => sectionOf(row.key.slice(prefix.length)) === section)
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
