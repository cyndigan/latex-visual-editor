const withCaseVariants = (stems, prefixes = ['gls', 'Gls', 'GLS']) =>
  stems.flatMap(stem => prefixes.map(prefix => `\\${prefix}${stem}`))

const withAcronymCaseVariants = stems =>
  stems.flatMap(stem =>
    ['acr', 'Acr', 'ACR'].map(prefix => `\\${prefix}${stem}`)
  )

// Commands that typeset a glossary entry from a single label argument.
// State-changing commands such as \glsreset and entry-definition commands are
// deliberately excluded because they do not represent an inline reference.
export const glossaryReferenceCommands = new Set([
  ...withCaseVariants(['', 'pl']),
  ...withCaseVariants([
    'text',
    'first',
    'plural',
    'firstplural',
    'name',
    'desc',
    'descplural',
    'symbol',
    'symbolplural',
    'useri',
    'userii',
    'useriii',
    'useriv',
    'userv',
    'uservi',
  ]),
  ...withAcronymCaseVariants([
    'short',
    'shortpl',
    'long',
    'longpl',
    'full',
    'fullpl',
  ]),
])

// Commands whose second mandatory argument supplies alternate display text.
export const glossaryDisplayCommands = new Set([
  '\\glslink',
  '\\Glslink',
  '\\glsdisp',
  '\\Glsdisp',
])
