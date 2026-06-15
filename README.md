# LaTeX Visual Editor

A VS Code extension that provides a visual editor for LaTeX documents. It is inspired by Overleaf's visual editor and uses the same interface and parser.

## Usage

Open a `.tex` file in VS Code and click the eye icon (Toggle Visual Editor) in the top right corner of the editor to switch to the visual editor.

## Development

```powershell
npm install
npm run build
```

Rebuild, package, install, and verify the installed bundle:

```powershell
npm run package
code --install-extension .\latex-visual-editor-0.1.0.vsix --force
rg "expected-code-marker" "$env:USERPROFILE\.vscode\extensions\local.latex-visual-editor-0.1.0\dist"
```

Reload the VS Code window after installation.
