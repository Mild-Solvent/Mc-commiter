# Commit Bubble

Commit Bubble is a Windows 10/11 desktop app that turns repository changes into a reviewed Conventional Commit using an AI provider you choose. It stays as a small always-on-top button, supports multiple saved repositories, and never gives a model permission to run Git commands.

## Safety model

- Git, filesystem, provider requests, credentials, and process launches live in Electron's isolated main process.
- The renderer is sandboxed, context-isolated, and limited to a validated preload API.
- A model receives a bounded text diff and returns only a validated commit draft.
- The user reviews the message and file list before deterministic app code stages and commits.
- Existing staged changes are locked as included. A repository fingerprint blocks stale previews.
- Provider switching is manual. Remote providers never receive potential secret files without per-request approval.
- Commit Bubble does not push, amend, reset, create branches, configure Git, or download models.

## Development

Requirements: Windows 10/11 x64, Git, Node.js 20 or newer, and npm.

```powershell
npm.cmd install
npm.cmd run dev
```

Validation commands:

```powershell
npm.cmd run typecheck
npm.cmd test
npm.cmd run build
npm.cmd run test:e2e
```

## Providers

The app ships with editable profiles for:

- LM Studio (`http://127.0.0.1:1234`) with one-click `lms server start`.
- Ollama (`http://127.0.0.1:11434`) with one-click `ollama serve`.
- Any OpenAI-compatible server, including LocalAI, llama.cpp, vLLM, and Jan.
- OpenAI, Anthropic, and Google Gemini.

Open Provider settings, test the connection, load or enter a model ID, save the profile, and make it active. API keys are encrypted with Electron `safeStorage` (Windows DPAPI) and are never returned to the renderer.

## Windows packaging and signing

Generate the icon and build both the NSIS installer and portable executable:

```powershell
npm.cmd run dist:win
```

For a local DAV Studios development certificate, run the following and explicitly confirm the Current User trust-store change:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts\create-dev-certificate.ps1
```

Set `CSC_LINK` to the generated PFX and `CSC_KEY_PASSWORD` to its password in the same shell before running `dist:win`. The certificate and password are deliberately excluded from source control. Verify packaged signatures with:

```powershell
npm.cmd run verify:signature
```

A self-signed certificate is only trusted on machines where its public certificate is installed and does not establish SmartScreen reputation. A future CA-issued certificate or trusted-signing service can use the same `CSC_LINK`/`CSC_KEY_PASSWORD` build seam without application changes.

For a one-command local signed build, the following script creates or reuses the Current User DAV Studios certificate, trusts it only for the current user, exports a password-protected temporary PFX, builds, and removes that temporary PFX:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts\build-signed-dev.ps1
```
