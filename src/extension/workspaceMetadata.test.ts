import { describe, expect, it } from 'vitest'
import { extractWorkspaceMetadata } from '../shared/workspaceMetadataParser'

describe('extractWorkspaceMetadata', () => {
  it('collects workspace symbols deterministically', () => {
    const metadata = extractWorkspaceMetadata(
      [
        String.raw`\usepackage{graphicx,amsmath}
\newcommand{\projectName}{Editor}
\newenvironment{warning}{}{}
\input{chapters/intro}
\includegraphics[width=.5\linewidth]{images/hero.png}
\section{Intro}\label{sec:intro}`,
      ],
      ['@article{smith2026,\n title={Example}\n}']
    )

    expect(metadata).toMatchObject({
      labels: ['sec:intro'],
      citationKeys: ['smith2026'],
      includes: ['chapters/intro'],
      graphics: ['images/hero.png'],
      packages: ['amsmath', 'graphicx'],
      commands: ['projectName'],
      environments: ['warning'],
    })
  })
})
