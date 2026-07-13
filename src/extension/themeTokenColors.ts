import * as fs from 'node:fs'
import * as path from 'node:path'
import * as vscode from 'vscode'
import { parse } from 'jsonc-parser/lib/esm/main.js'

type ThemeFile = {
  include?: string
  tokenColors?: string | TokenColorRule[]
}

type TokenColorRule = {
  scope?: string | string[]
  settings?: { foreground?: string }
}

const tokenScopes: Record<string, string[]> = {
  comment: ['comment.line.percentage.latex'],
  keyword: ['keyword.control.latex'],
  tagName: ['support.function.general.latex'],
  labelName: ['support.function.general.latex'],
  literal: ['constant.language.latex'],
  string: ['string.quoted.latex'],
  string2: ['constant.character.escape.latex'],
  number: ['constant.numeric.latex'],
  typeName: ['entity.name.type.latex'],
  attributeValue: ['variable.parameter.function.latex'],
  attributeName: ['entity.other.attribute-name.latex'],
  function: ['entity.name.function.latex', 'support.function.general.latex'],
  macroName: ['entity.name.macro.latex'],
  variableName: ['support.function.general.latex', 'variable.other.latex'],
  className: ['entity.name.class.latex'],
  propertyName: ['variable.other.property.latex'],
  operator: ['keyword.operator.latex'],
  meta: ['meta.preprocessor.latex'],
  invalid: ['invalid.illegal.latex'],
  punctuation: ['punctuation.latex'],
}

/** Returns the selected theme's TextMate colors mapped to CodeMirror tokens. */
export function getThemeTokenColors(): Record<string, string> {
  try {
    const selected = vscode.workspace
      .getConfiguration('workbench')
      .get<string>('colorTheme')
    const contribution = vscode.extensions.all
      .flatMap(extension =>
        ((extension.packageJSON.contributes?.themes ?? []) as Array<{
          id?: string
          label?: string
          path?: string
        }>).map(theme => ({ extension, theme }))
      )
      .find(({ theme }) => theme.id === selected || theme.label === selected)

    if (!contribution?.theme.path) return {}
    const rules = readThemeRules(
      path.join(contribution.extension.extensionPath, contribution.theme.path)
    )
    const colors: Record<string, string> = {}
    for (const [token, scopes] of Object.entries(tokenScopes)) {
      const color = colorForScopes(rules, scopes)
      if (color) colors[token] = color
    }
    return colors
  } catch (error) {
    console.warn('Unable to resolve VS Code theme token colors', error)
    return {}
  }
}

function readThemeRules(file: string, visited = new Set<string>()): TokenColorRule[] {
  if (visited.has(file) || !fs.existsSync(file)) return []
  visited.add(file)
  const theme = (parse(fs.readFileSync(file, 'utf8')) as ThemeFile | undefined) ?? {}
  const inherited = theme.include
    ? readThemeRules(path.resolve(path.dirname(file), theme.include), visited)
    : []
  const local = Array.isArray(theme.tokenColors)
    ? theme.tokenColors
    : typeof theme.tokenColors === 'string'
      ? readTokenRules(path.resolve(path.dirname(file), theme.tokenColors))
      : []
  return [...inherited, ...local]
}

function readTokenRules(file: string): TokenColorRule[] {
  if (!fs.existsSync(file)) return []
  const value = (parse(fs.readFileSync(file, 'utf8')) as
    | TokenColorRule[]
    | { tokenColors?: TokenColorRule[] }
    | undefined) ?? []
  return Array.isArray(value) ? value : value.tokenColors ?? []
}

function colorForScopes(rules: TokenColorRule[], scopes: string[]): string | undefined {
  let color: string | undefined
  let specificity = -1
  for (const rule of rules) {
    const ruleScopes = (Array.isArray(rule.scope) ? rule.scope : [rule.scope ?? ''])
      .flatMap(scope => scope.split(','))
      .map(scope => scope.trim())
    if (!rule.settings?.foreground) continue
    for (const ruleScope of ruleScopes) {
      for (const scope of scopes) {
        if (scope !== ruleScope && !scope.startsWith(`${ruleScope}.`)) continue
        const score = ruleScope.split('.').length
        if (score >= specificity) {
          specificity = score
          color = rule.settings.foreground
        }
      }
    }
  }
  return color
}
