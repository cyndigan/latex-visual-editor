import { NodeProp } from '@lezer/common'

/**
 * Marks parser nodes whose contents should not be spellchecked.
 */
export const noSpellCheckProp = new NodeProp<readonly string[][]>()
