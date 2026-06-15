import type { WorkspaceMetadata } from './messages'

/**
 * Extracts visual-editor metadata from LaTeX and BibTeX source strings.
 */
export function extractWorkspaceMetadata(
  texContents: string[],
  bibContents: string[]
): WorkspaceMetadata {
  const labels = new Set<string>()
  const citationKeys = new Set<string>()
  const includes = new Set<string>()
  const graphics = new Set<string>()
  const packages = new Set<string>()
  const commands = new Set<string>()
  const environments = new Set<string>()

  for (const text of texContents) {
    collectMatches(text, /\\label\{([^}]+)\}/g, labels)
    collectMatches(text, /\\(?:input|include|subfile)\{([^}]+)\}/g, includes)
    collectMatches(
      text,
      /\\(?:includegraphics|includesvg)(?:\[[^\]]*\])?\{([^}]+)\}/g,
      graphics
    )
    collectMatches(
      text,
      /\\usepackage(?:\[[^\]]*\])?\{([^}]+)\}/g,
      packages,
      true
    )
    collectMatches(
      text,
      /\\(?:newcommand|renewcommand)\s*\{?\\([A-Za-z@]+)\}?/g,
      commands
    )
    collectMatches(
      text,
      /\\(?:newenvironment|renewenvironment)\s*\{([^}]+)\}/g,
      environments
    )
  }
  for (const text of bibContents) {
    collectMatches(text, /@\w+\s*\{\s*([^,\s]+)\s*,/g, citationKeys)
  }

  return {
    labels: sorted(labels),
    citationKeys: sorted(citationKeys),
    includes: sorted(includes),
    graphics: sorted(graphics),
    packages: sorted(packages),
    commands: sorted(commands),
    environments: sorted(environments),
  }
}

/**
 * Adds regex capture values to a set.
 */
function collectMatches(
  text: string,
  pattern: RegExp,
  output: Set<string>,
  splitCommaSeparated = false
): void {
  for (const match of text.matchAll(pattern)) {
    const values = splitCommaSeparated ? match[1].split(',') : [match[1]]
    values.map(value => value.trim()).filter(Boolean).forEach(value => output.add(value))
  }
}

/**
 * Returns deterministic set contents.
 */
function sorted(values: Set<string>): string[] {
  return [...values].sort((a, b) => a.localeCompare(b))
}
