import {
  Completion,
  CompletionContext,
  CompletionResult,
  CompletionSource,
  startCompletion,
} from '@codemirror/autocomplete'
import { EditorSelection } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import type { WorkspaceMetadata } from '../shared/messages'
import { bibliographyStyles } from './overleaf-editor/languages/latex/completions/data/bibliography-styles'
import { classNames } from './overleaf-editor/languages/latex/completions/data/class-names'
import { environments } from './overleaf-editor/languages/latex/completions/data/environments'
import { packageNames } from './overleaf-editor/languages/latex/completions/data/package-names'
import extraSnippets from './overleaf-editor/languages/latex/completions/data/snippets'
import topHundredSnippets from './overleaf-editor/languages/latex/completions/data/top-hundred-snippets'
import { LaTeXLanguage } from './overleaf-editor/languages/latex/latex-language'

type MetadataProvider = () => WorkspaceMetadata

const staticCommands = buildStaticCommands()

export function latexAutocomplete(metadata: MetadataProvider) {
  const source = createLatexCompletionSource(metadata)
  return [
    LaTeXLanguage.data.of({ autocomplete: source }),
    EditorView.updateListener.of(update => {
      if (!update.docChanged && !update.selectionSet) return
      const before = update.state.sliceDoc(
        Math.max(0, update.state.selection.main.head - 120),
        update.state.selection.main.head
      )
      if (
        /\\(?:begin|end|cite|ref|usepackage|input|include|subfile|includegraphics)\{[^}]*$/.test(
          before
        )
      ) {
        startCompletion(update.view)
      }
    }),
  ]
}

export function createLatexCompletionSource(
  metadata: MetadataProvider
): CompletionSource {
  return context => {
    const currentMetadata = metadata()
    const environment = environmentCompletions(context, currentMetadata)
    if (environment) return environment

    const argument = argumentCompletions(context, currentMetadata)
    if (argument) return argument

    const command = context.matchBefore(/\\[A-Za-z@]*$/)
    if (!command && !context.explicit) return null

    return {
      from: command?.from ?? context.pos,
      options: deduplicate([
        ...staticCommands,
        ...currentMetadata.commands.map(name => ({
          label: `\\${name}`,
          type: 'cmd',
        })),
      ]),
    }
  }
}

function environmentCompletions(
  context: CompletionContext,
  metadata: WorkspaceMetadata
): CompletionResult | null {
  const before = context.state.sliceDoc(
    Math.max(0, context.pos - 300),
    context.pos
  )
  const match = before.match(/\\(?<command>begin|end)\{(?<name>[^}]*)$/)
  if (!match?.groups) return null

  const command = match.groups.command
  const name = match.groups.name
  const commandFrom = context.pos - match[0].length

  if (command === 'end') {
    return {
      from: context.pos - name.length,
      validFor: /[^}\s]*/,
      options: openEnvironmentNames(context)
        .reverse()
        .map((label, index) => ({
          label,
          type: 'env',
          boost: 10 + index,
        })),
    }
  }

  const environmentTemplates = new Map(environments)
  for (const customEnvironment of metadata.environments) {
    if (!environmentTemplates.has(customEnvironment)) {
      environmentTemplates.set(
        customEnvironment,
        `\\begin{${customEnvironment}}\n\t$1\n\\end{${customEnvironment}}`
      )
    }
  }

  return {
    from: commandFrom,
    validFor: /^\\begin\{[^}\s]*/,
    options: [...environmentTemplates].map(([environmentName, template]) => ({
      label: `\\begin{${environmentName}} ...`,
      type: 'env',
      apply: applyLatexSnippet(template, true),
    })),
  }
}

function argumentCompletions(
  context: CompletionContext,
  metadata: WorkspaceMetadata
): CompletionResult | null {
  const before = context.state.sliceDoc(
    Math.max(0, context.pos - 300),
    context.pos
  )
  const match = before.match(
    /\\(?<command>cite|ref|usepackage|input|include|subfile|includegraphics|includesvg|documentclass|bibliography|bibliographystyle)\{(?<value>[^}]*)$/
  )
  if (!match?.groups) return null

  const command = match.groups.command
  const value = match.groups.value
  const parts = value.split(',')
  const existing = parts.slice(0, -1).map(item => item.trim())
  const prefix = parts.at(-1) ?? ''
  const from = context.pos - prefix.length
  let values: string[] = []
  let type = 'text'

  switch (command) {
    case 'cite':
      values = metadata.citationKeys
      type = 'reference'
      break
    case 'ref':
      values = metadata.labels
      type = 'label'
      break
    case 'usepackage':
      values = [...new Set([...packageNames, ...metadata.packages])]
      type = 'pkg'
      break
    case 'input':
    case 'include':
    case 'subfile':
      values = metadata.includes
      type = 'file'
      break
    case 'includegraphics':
    case 'includesvg':
      values = metadata.graphics
      type = 'file'
      break
    case 'documentclass':
      values = classNames
      type = 'class'
      break
    case 'bibliographystyle':
      values = Object.values(bibliographyStyles).flat()
      type = 'bib'
      break
    case 'bibliography':
      values = metadata.includes.filter(value => value.endsWith('.bib'))
      type = 'bib'
      break
  }

  return {
    from,
    validFor: /[^},\s]*/,
    options: values
      .filter(value => !existing.includes(value))
      .map(label => ({ label, type })),
  }
}

function buildStaticCommands(): Completion[] {
  return deduplicate([
    ...topHundredSnippets.map(item => ({
      label: item.caption,
      type: item.meta,
      boost: item.score,
      apply:
        item.snippet === item.caption
          ? undefined
          : applyLatexSnippet(item.snippet),
    })),
    ...extraSnippets.map(item => ({
      label: item.label,
      type: item.type,
      apply: applyLatexSnippet(item.snippet),
    })),
    ...[...environments].map(([name, template]) => ({
      label: `\\begin{${name}} ...`,
      type: 'env',
      apply: applyLatexSnippet(template),
    })),
  ])
}

function deduplicate(options: Completion[]): Completion[] {
  const seen = new Set<string>()
  return options.filter(option => {
    if (seen.has(option.label)) return false
    seen.add(option.label)
    return true
  })
}

function applyLatexSnippet(
  template: string,
  consumeClosingBrace = false
): Completion['apply'] {
  return (view, _completion, from, to) => {
    if (consumeClosingBrace && view.state.sliceDoc(to, to + 1) === '}') {
      to += 1
    }
    let firstSelection: { from: number; to: number } | undefined
    let output = ''
    let cursor = 0
    const placeholder = /\$(\d+)|\$\{(\d+):([^}]*)\}|#\{([^}]*)\}/g

    for (const match of template.matchAll(placeholder)) {
      output += template.slice(cursor, match.index)
      const value = match[3] ?? match[4] ?? ''
      const start = output.length
      output += value
      if (!firstSelection) {
        firstSelection = { from: start, to: output.length }
      }
      cursor = match.index + match[0].length
    }
    output += template.slice(cursor)

    const anchor = from + (firstSelection?.from ?? output.length)
    const head = from + (firstSelection?.to ?? output.length)
    view.dispatch({
      changes: { from, to, insert: output },
      selection: EditorSelection.single(anchor, head),
    })
  }
}

function openEnvironmentNames(context: CompletionContext): string[] {
  const open: string[] = []
  const source = context.state.sliceDoc(0, context.pos)
  for (const match of source.matchAll(/\\(?<command>begin|end)\{(?<name>[^}]+)}/g)) {
    const { command, name } = match.groups as {
      command: 'begin' | 'end'
      name: string
    }
    if (command === 'begin') {
      open.push(name)
    } else {
      const index = open.lastIndexOf(name)
      if (index >= 0) open.splice(index, 1)
    }
  }
  return open
}
