/**
 * Browser end-to-end tests for the workspace, file-tree and file-preview UI.
 *
 * Drives a real headless Chrome over the DevTools protocol against a real
 * server process, so it covers what the unit tests cannot: the launch-link
 * sign-in, lazy tree loading, the preview panel, and the workspace dialog.
 *
 * No model credentials are needed: nothing here sends a message. Chrome is
 * located through CHROME_PATH or the usual install locations; without one the
 * suite is skipped rather than failed.
 */

import assert from "node:assert/strict"
import { spawn } from "node:child_process"
import { existsSync } from "node:fs"
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises"
import { createServer as createHttpServer } from "node:http"
import { createServer } from "node:net"
import { tmpdir } from "node:os"
import { delimiter, dirname, join } from "node:path"
import { after, before, test } from "node:test"
import { fileURLToPath } from "node:url"

const webRoot = fileURLToPath(new URL("../..", import.meta.url))

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/usr/bin/google-chrome",
  "/usr/bin/google-chrome-stable",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
]
const chromePath = CHROME_CANDIDATES.find(
  (candidate) => candidate && existsSync(candidate),
)
const skip = chromePath
  ? false
  : "no Chrome found; set CHROME_PATH to run the browser e2e suite"

/**
 * The system folder chooser cannot be clicked by a test, so a stand-in with
 * the real helper's name goes first on the server's PATH. It answers from
 * PICKER_RESULT_FILE ("cancel", "fail", or a path) and records its argv, so
 * the real spawn, argument passing and output parsing are still exercised.
 * Windows would need a fake powershell.exe; the native case is skipped there.
 */
const nativePickerSkip =
  skip ||
  (process.platform === "win32"
    ? "native picker stand-in needs a POSIX shell"
    : false)
const PICKER_HELPER = process.platform === "darwin" ? "osascript" : "zenity"
const PICKER_STANDIN = `#!/bin/sh
printf '%s\n' "$@" > "$PICKER_ARGS_FILE"
answer=$(cat "$PICKER_RESULT_FILE")
case "$answer" in
	cancel) echo "execution error: User canceled. (-128)" >&2; exit 1 ;;
	fail) echo "picker exploded" >&2; exit 2 ;;
	*) printf '%s\n' "$answer" ;;
esac
`

/** 1x1 transparent PNG. */
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
)

async function freePort() {
  const server = createServer()
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve))
  const { port } = server.address()
  await new Promise((resolve) => server.close(resolve))
  return port
}

/** Collect a child's output and resolve once `pattern` appears in it. */
function waitForOutput(child, pattern, label) {
  let output = ""
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`${label} did not become ready:\n${output}`)),
      30_000,
    )
    const onData = (chunk) => {
      output += chunk
      const match = pattern.exec(output)
      if (!match) return
      clearTimeout(timer)
      resolve(match)
    }
    child.stdout.on("data", onData)
    child.stderr.on("data", onData)
    child.once("exit", (code) => {
      clearTimeout(timer)
      reject(new Error(`${label} exited early (${code}):\n${output}`))
    })
  })
}

/** Minimal DevTools-protocol client: one browser socket, one attached page. */
class Browser {
  constructor(socket) {
    this.socket = socket
    this.nextId = 1
    this.pending = new Map()
    this.sessionId = undefined
    this.listeners = new Map()
    socket.addEventListener("message", (event) => {
      const message = JSON.parse(event.data)
      if (message.method) {
        for (const listener of this.listeners.get(message.method) ?? [])
          listener(message.params)
        this.listeners.delete(message.method)
        return
      }
      const waiter = this.pending.get(message.id)
      if (!waiter) return
      this.pending.delete(message.id)
      if (message.error) waiter.reject(new Error(message.error.message))
      else waiter.resolve(message.result)
    })
  }

  static async connect(url) {
    const socket = new WebSocket(url)
    await new Promise((resolve, reject) => {
      socket.addEventListener("open", resolve, { once: true })
      socket.addEventListener(
        "error",
        () => reject(new Error("could not connect to Chrome")),
        { once: true },
      )
    })
    const browser = new Browser(socket)
    const { targetId } = await browser.send(
      "Target.createTarget",
      { url: "about:blank" },
      false,
    )
    const attached = await browser.send(
      "Target.attachToTarget",
      { targetId, flatten: true },
      false,
    )
    browser.sessionId = attached.sessionId
    await browser.send("Page.enable")
    await browser.send("Runtime.enable")
    await browser.send("Emulation.setDeviceMetricsOverride", {
      width: 1440,
      height: 900,
      deviceScaleFactor: 1,
      mobile: false,
    })
    return browser
  }

  send(method, params = {}, inPage = true) {
    const id = this.nextId++
    const message = {
      id,
      method,
      params,
      ...(inPage ? { sessionId: this.sessionId } : {}),
    }
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      this.socket.send(JSON.stringify(message))
    })
  }

  /** Run an async function body in the page and return its JSON result. */
  async run(body) {
    const result = await this.send("Runtime.evaluate", {
      expression: `(async () => { ${PAGE_HELPERS}\n${body} })()`,
      awaitPromise: true,
      returnByValue: true,
    })
    if (result.exceptionDetails) {
      throw new Error(
        result.exceptionDetails.exception?.description ??
          result.exceptionDetails.text,
      )
    }
    return result.result.value
  }

  /** Resolve on the next protocol event with this name. */
  once(method) {
    return new Promise((resolve) => {
      this.listeners.set(method, [
        ...(this.listeners.get(method) ?? []),
        resolve,
      ])
    })
  }

  /** Navigate and wait for the new document, not the one being replaced. */
  async goto(url) {
    const loaded = this.once("Page.loadEventFired")
    await this.send("Page.navigate", { url })
    await loaded
  }

  /** A real key chord, so the page's keydown handler sees genuine modifiers. */
  async chord(code, key, modifiers) {
    const event = {
      code,
      key,
      modifiers,
      windowsVirtualKeyCode: key.toUpperCase().charCodeAt(0),
    }
    await this.send("Input.dispatchKeyEvent", { type: "rawKeyDown", ...event })
    await this.send("Input.dispatchKeyEvent", { type: "keyUp", ...event })
  }
}

/** Helpers evaluated in the page before every snippet. */
const PAGE_HELPERS = `
const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const until = async (probe, label, timeout = 8000) => {
	const deadline = Date.now() + timeout;
	for (;;) {
		const value = await probe();
		if (value) return value;
		if (Date.now() > deadline) throw new Error("timed out waiting for " + label);
		await new Promise((resolve) => setTimeout(resolve, 25));
	}
};
const treeRows = () => $$("#fileTreeBody .file-row").map((row) => row.dataset.path);
const treeRow = (path) => $$("#fileTreeBody .file-row").find((row) => row.dataset.path === path);
const projects = () => $$("#projectGroups .project-group").map((group) => group.dataset.cwd);
const codeText = () => $$("#previewBody .code-line").map((line) => line.textContent).join("\\n");
const tabs = () => $$("#previewTabs .preview-tab").map((tab) => tab.textContent.trim());
`

const ALT_META = 1 | 4
const SHIFT_META = 8 | 4

let base
let workspace
let extra
let server
let chrome
let browser
let origin
let pickerResult
let authPath
let provider
let pickerArgs

before(async () => {
  if (skip) return
  base = await realpath(await mkdtemp(join(tmpdir(), "stepcode-web-e2e-")))
  workspace = join(base, "project")
  extra = join(base, "second-project")
  await mkdir(join(workspace, "src", "deep"), { recursive: true })
  await mkdir(join(workspace, "docs"), { recursive: true })
  await mkdir(join(extra, "lib"), { recursive: true })
  await writeFile(
    join(workspace, "README.md"),
    "# Title\n\nSome **bold** text.\n",
  )
  await writeFile(
    join(workspace, "package.json"),
    '{\n  "name": "fixture",\n  "private": true\n}\n',
  )
  await writeFile(
    join(workspace, "src", "main.ts"),
    '// entry\nexport const answer = 42;\nconst name = "step";\n',
  )
  await writeFile(
    join(workspace, "src", "deep", "needle-file.ts"),
    "export {};\n",
  )
  await writeFile(join(workspace, "docs", "guide.md"), "guide\n")
  await writeFile(join(workspace, "logo.png"), PNG)
  await writeFile(join(workspace, "blob.bin"), Buffer.from([1, 0, 2, 0]))
  await writeFile(
    join(extra, "lib", "util.py"),
    "# util\ndef f():\n    return 1\n",
  )
  await writeFile(join(base, "outside.txt"), "outside\n")

  // A stored plan credential, so the login report and the settings section can
  // be asserted without touching the real credential file. The token is not
  // valid and is never used: nothing in this suite sends a message.
  const agentDir = join(base, "agent")
  authPath = join(base, "stepcode", "auth.json")
  await mkdir(agentDir, { recursive: true })
  await mkdir(dirname(authPath), { recursive: true })
  await writeFile(
    authPath,
    JSON.stringify({
      step: {
        type: "oauth",
        access: "e2e-not-a-real-token",
        refresh: "static",
        expires: Number.MAX_SAFE_INTEGER,
        profile: "step_plan",
        obtainedAt: "2026-01-01T00:00:00.000Z",
      },
    }),
  )

  const bin = join(base, "bin")
  await mkdir(bin)
  await writeFile(join(bin, PICKER_HELPER), PICKER_STANDIN)
  await chmod(join(bin, PICKER_HELPER), 0o755)
  // A stand-in for the provider, so the suite never reaches the real one: the
  // credential check and the model catalog are requests the host makes on its
  // own, and a test that let them out would depend on the network and on a real
  // token.
  const providerPort = await freePort()
  provider = createHttpServer((request, response) => {
    if (request.headers.authorization !== "Bearer e2e-not-a-real-token") {
      response.writeHead(401, { "content-type": "application/json" })
      response.end(JSON.stringify({ error: "bad token" }))
      return
    }
    const payload = request.url?.endsWith("/models")
      ? {
          data: [
            {
              id: "e2e-model-large",
              model_type: "large_language_model",
              max_input_tokens: 128000,
              enable_reason: true,
            },
            {
              id: "e2e-model-small",
              model_type: "large_language_model",
              max_input_tokens: 32000,
              enable_reason: false,
            },
          ],
        }
      : {}
    response.writeHead(200, { "content-type": "application/json" })
    response.end(JSON.stringify(payload))
  })
  await new Promise((resolve) =>
    provider.listen(providerPort, "127.0.0.1", resolve),
  )
  const providerUrl = `http://127.0.0.1:${providerPort}/v1`

  pickerResult = join(base, "picker-result")
  pickerArgs = join(base, "picker-args")
  await writeFile(pickerResult, "cancel")

  const port = await freePort()
  origin = `http://127.0.0.1:${port}`
  server = spawn(process.execPath, ["--import", "tsx", "src/server.ts"], {
    cwd: webRoot,
    env: {
      ...process.env,
      TSX_TSCONFIG_PATH: join(webRoot, "..", "..", "tsconfig.json"),
      STEPCODE_WEB_PORT: String(port),
      STEPCODE_WEB_CWD: workspace,
      STEP_CODING_AGENT_DIR: agentDir,
      // The credential path is its own setting, not derived from the agent
      // directory, so a fixture credential has to point the host at it.
      STEPCODE_AUTH_PATH: authPath,
      // Both the credential check and model discovery read these, and the
      // stored profile would otherwise override them with the real region.
      STEP_PROVIDER_API_URL: providerUrl,
      STEP_PROVIDER_AUTH_URL: providerUrl,
      STEP_LOGIN_PROFILE_API_URL: providerUrl,
      STEP_LOGIN_PROFILE_AUTH_URL: providerUrl,
      STEPCODE_WEB_AUTH_SECRET: join(base, "web-auth-secret"),
      STEPCODE_WEB_DIRECTORY_PICKER: nativePickerSkip ? "browse" : "native",
      PATH: `${bin}${delimiter}${process.env.PATH ?? ""}`,
      PICKER_RESULT_FILE: pickerResult,
      PICKER_ARGS_FILE: pickerArgs,
    },
    stdio: ["ignore", "pipe", "pipe"],
  })
  server.stdout.setEncoding("utf8")
  server.stderr.setEncoding("utf8")
  const [, token] = await waitForOutput(
    server,
    /#token=([A-Za-z0-9_-]+)/u,
    "web server",
  )

  chrome = spawn(
    chromePath,
    [
      "--headless=new",
      "--remote-debugging-port=0",
      `--user-data-dir=${join(base, "chrome-profile")}`,
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-gpu",
      ...(process.env.CI ? ["--no-sandbox"] : []),
      "about:blank",
    ],
    { stdio: ["ignore", "pipe", "pipe"] },
  )
  chrome.stdout.setEncoding("utf8")
  chrome.stderr.setEncoding("utf8")
  const [, endpoint] = await waitForOutput(
    chrome,
    /DevTools listening on (ws:\/\/\S+)/u,
    "Chrome",
  )
  browser = await Browser.connect(endpoint)

  // Before signing in, the API must refuse the page.
  // A different path, so the launch link below is a real navigation rather
  // than a same-document hash change.
  await browser.goto(`${origin}/healthz`)
  assert.equal(
    await browser.run(`return (await fetch("/api/v1/workspaces")).status;`),
    401,
  )
  await browser.goto(`${origin}/#token=${token}`)
  await browser.run(
    `await until(() => !location.hash, "launch token exchange");`,
  )
})

after(async () => {
  if (skip) return
  browser?.socket.close()
  await new Promise((resolve) => provider?.close(resolve))
  for (const child of [chrome, server]) {
    if (!child || child.exitCode !== null) continue
    child.kill("SIGTERM")
    await new Promise((resolve) => child.once("exit", resolve))
  }
  if (base) await rm(base, { recursive: true, force: true, maxRetries: 3 })
})

test(
  "the launch link signs the browser in and is removed from the address bar",
  { skip },
  async () => {
    const state = await browser.run(`
		return {
			href: location.href,
			status: (await fetch("/api/v1/workspaces")).status,
			banner: $("#authBanner").hidden,
			// Wait for the real name: before bootstrap the control carries a
			// neutral placeholder, and reading it early would assert on that.
			workspace: await until(
				() => (($("#workspaceButtonName").textContent === "project") ? "project" : ""),
				"workspace name",
			),
		};
	`)
    assert.equal(state.href, `${origin}/`)
    assert.equal(state.status, 200)
    assert.equal(state.banner, true)
    assert.equal(state.workspace, "project")
  },
)

test(
  "the settings popover reports the borrowed credential and applies appearance and language",
  { skip },
  async () => {
    const report = await browser.run(`
		const boot = await (await fetch("/api/v1/bootstrap")).json();
		const direct = await (await fetch("/api/v1/login")).json();
		return { boot, direct };
	`)
    // The stored profile is named, and the credential itself is nowhere in it.
    assert.equal(report.boot.login.source, "auth.json")
    assert.equal(report.boot.login.provider, "step")
    assert.equal(report.boot.login.profile, "step_plan")
    assert.equal(report.boot.login.configured, true)
    assert.equal(report.boot.login.loginCommand, "step login")
    assert.equal(report.boot.login.path, authPath)
    assert.deepEqual(report.direct, report.boot.login)
    assert.equal(
      JSON.stringify(report).includes("e2e-not-a-real-token"),
      false,
      "no secret in the report",
    )

    const shown = await browser.run(`
		$("#userMenuButton").click();
		await until(() => !$("#userPopover").hidden, "settings popover");
		return {
			label: $("#userMenuButton").textContent.trim(),
			// The account block, the redundant settings row and the login note
			// (removed in cdf3bb3) are gone; the credential report is API-only.
			login: !!$("#loginNote") || !!$("#loginCommand"),
			account: !!$(".user-popover-account"),
			gear: !!$("#userMenuButton use[href='#i-settings']"),
		};
	`)
    assert.equal(shown.label, "设置")
    assert.equal(shown.gear, true)
    assert.equal(shown.account, false)
    assert.equal(shown.login, false)

    // The rows open their submenu on the first click: they must not bubble into
    // the document handler that closes the popover on an outside click.
    const appearance = await browser.run(`
		$("#themeMenuItem").click();
		await until(() => !$("#themeSubmenu").hidden, "appearance submenu");
		$("[data-theme-choice='dark']").click();
		await until(() => document.documentElement.dataset.theme === "dark", "dark theme");
		return { stored: localStorage.getItem("stepcode.theme"), value: $("#themeValue").textContent };
	`)
    assert.equal(appearance.stored, "dark")
    assert.equal(appearance.value, "深色")

    const language = await browser.run(`
		$("#languageMenuItem").click();
		await until(() => !$("#languageSubmenu").hidden, "language submenu");
		const openedOnFirstClick = $("#userPopover").hidden === false;
		$("[data-language-choice='en-US']").click();
		await until(() => document.documentElement.lang === "en-US", "English");
		return {
			openedOnFirstClick,
			stored: localStorage.getItem("stepcode.locale"),
			label: $("#userMenuButton").textContent.trim(),
			appearance: $("#themeMenuItem span").textContent,
		};
	`)
    assert.equal(language.openedOnFirstClick, true)
    assert.equal(language.stored, "en-US")
    assert.equal(language.label, "Settings")
    assert.equal(language.appearance, "Appearance")

    // Leave the suite in the state it found, since the browser is shared.
    const restored = await browser.run(`
		$("[data-language-choice='zh-CN']").click();
		$("#themeMenuItem").click();
		$("[data-theme-choice='system']").click();
		$("#userMenuButton").click();
		await until(() => $("#userPopover").hidden, "settings popover to close");
		return localStorage.getItem("stepcode.theme");
	`)
    assert.equal(restored, "system")
  },
)

test(
  "the file tree loads one level at a time and folders expand and collapse",
  { skip },
  async () => {
    await browser.chord("KeyP", "p", ALT_META)
    const top = await browser.run(`
		await until(() => $("#fileTree").classList.contains("open") && treeRows().length, "tree to open");
		return { name: $("#fileTreeName").textContent, rows: treeRows(), expanded: treeRow("src").getAttribute("aria-expanded") };
	`)
    assert.equal(top.name, "project")
    // Directories first, then files; nothing below the first level yet.
    assert.deepEqual(top.rows, [
      "docs",
      "src",
      "blob.bin",
      "logo.png",
      "package.json",
      "README.md",
    ])
    assert.equal(top.expanded, "false")

    const expanded = await browser.run(`
		treeRow("src").click();
		await until(() => treeRow("src/main.ts"), "src children");
		return { rows: treeRows(), expanded: treeRow("src").getAttribute("aria-expanded"), level: treeRow("src/main.ts").getAttribute("aria-level") };
	`)
    assert.deepEqual(expanded.rows, [
      "docs",
      "src",
      "src/deep",
      "src/main.ts",
      "blob.bin",
      "logo.png",
      "package.json",
      "README.md",
    ])
    assert.equal(expanded.expanded, "true")
    assert.equal(expanded.level, "2")

    const nested = await browser.run(`
		treeRow("src/deep").click();
		await until(() => treeRow("src/deep/needle-file.ts"), "nested children");
		treeRow("src").click();
		await until(() => !treeRow("src/main.ts"), "src to collapse");
		const collapsed = treeRows();
		// Re-opening restores the nested folder that was open inside it.
		treeRow("src").click();
		await until(() => treeRow("src/deep/needle-file.ts"), "nested state to return");
		return { collapsed, reopened: treeRows() };
	`)
    assert.deepEqual(nested.collapsed, [
      "docs",
      "src",
      "blob.bin",
      "logo.png",
      "package.json",
      "README.md",
    ])
    assert.ok(nested.reopened.includes("src/deep/needle-file.ts"))

    const keyboard = await browser.run(`
		treeRow("docs").focus();
		treeRow("docs").dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
		await until(() => treeRow("docs/guide.md"), "keyboard expand");
		const focusKept = document.activeElement.dataset.path;
		treeRow("docs").dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true }));
		await until(() => !treeRow("docs/guide.md"), "keyboard collapse");
		return { focusKept };
	`)
    assert.equal(keyboard.focusKept, "docs")
  },
)

test(
  "refresh picks up files created after the tree was loaded",
  { skip },
  async () => {
    await writeFile(
      join(workspace, "src", "added-later.ts"),
      "export const later = true;\n",
    )
    const rows = await browser.run(`
		$("#fileTreeRefresh").click();
		await until(() => treeRow("src/added-later.ts"), "new file after refresh");
		return treeRows();
	`)
    assert.ok(
      rows.includes("src/deep/needle-file.ts"),
      "expanded folders stay expanded across a refresh",
    )
  },
)

test(
  "clicking a file opens a highlighted, line-numbered source preview",
  { skip },
  async () => {
    const opened = await browser.run(`
		treeRow("src/main.ts").click();
		await until(() => $$("#previewBody .code-line").length, "code lines");
		const view = $("#previewBody .code-view");
		return {
			panel: !$("#previewPanel").hidden,
			shifted: $(".app").classList.contains("preview-open"),
			tabs: tabs(),
			path: $("#previewPath").textContent,
			code: codeText(),
			lineNumber: getComputedStyle($$(".code-line")[2], "::before").content,
			comment: $(".tok-comment")?.textContent,
			keywords: $$(".tok-keyword").map((node) => node.textContent),
			number: $(".tok-number")?.textContent,
			string: $(".tok-string")?.textContent,
			activeRow: $("#fileTreeBody .file-row.active")?.dataset.path,
			wrapped: view.classList.contains("wrap"),
		};
	`)
    assert.equal(opened.panel, true)
    assert.equal(opened.shifted, true)
    assert.deepEqual(opened.tabs, ["main.ts"])
    assert.ok(opened.path.startsWith(`${workspace}/src/main.ts`), opened.path)
    assert.equal(
      opened.code,
      '// entry\nexport const answer = 42;\nconst name = "step";',
    )
    assert.match(opened.lineNumber, /counter\(line\)/)
    assert.equal(opened.comment, "// entry")
    assert.deepEqual(opened.keywords, ["export", "const", "const"])
    assert.equal(opened.number, "42")
    assert.equal(opened.string, '"step"')
    assert.equal(opened.activeRow, "src/main.ts")
    assert.equal(opened.wrapped, true)

    const toggled = await browser.run(`
		$("#previewWrap").click();
		const off = $("#previewBody .code-view").classList.contains("wrap");
		$("#previewWrap").click();
		return { off, on: $("#previewBody .code-view").classList.contains("wrap"), pressed: $("#previewWrap").getAttribute("aria-pressed") };
	`)
    assert.deepEqual(toggled, { off: false, on: true, pressed: "true" })
  },
)

test(
  "files open in tabs, and reload re-reads the file from disk",
  { skip },
  async () => {
    const two = await browser.run(`
		treeRow("package.json").click();
		await until(() => tabs().length === 2 && codeText().includes("fixture"), "second tab");
		return { tabs: tabs(), active: $(".preview-tab.active").textContent.trim(), key: $(".tok-key")?.textContent };
	`)
    assert.deepEqual(two.tabs, ["main.ts", "package.json"])
    assert.equal(two.active, "package.json")
    assert.equal(two.key, '"name"')

    // Opening an already-open file focuses its tab instead of duplicating it.
    const refocused = await browser.run(`
		treeRow("src/main.ts").click();
		await until(() => $(".preview-tab.active").textContent.trim() === "main.ts", "first tab to refocus");
		return tabs();
	`)
    assert.deepEqual(refocused, ["main.ts", "package.json"])

    await writeFile(
      join(workspace, "src", "main.ts"),
      "export const answer = 43;\n",
    )
    const reloaded = await browser.run(`
		$("#previewReload").click();
		await until(() => codeText().includes("43"), "reloaded content");
		return codeText();
	`)
    assert.equal(reloaded, "export const answer = 43;")

    const closed = await browser.run(`
		$(".preview-tab.active .preview-tab-close").click();
		await until(() => tabs().length === 1, "tab to close");
		return { tabs: tabs(), code: codeText(), panel: !$("#previewPanel").hidden };
	`)
    assert.deepEqual(closed.tabs, ["package.json"])
    assert.ok(closed.code.includes("fixture"))
    assert.equal(closed.panel, true)
  },
)

test(
  "markdown can be rendered, images are shown, and binaries are not dumped",
  { skip },
  async () => {
    const markdown = await browser.run(`
		treeRow("README.md").click();
		await until(() => !$("#previewMode").hidden && codeText().includes("# Title"), "markdown source");
		$("#previewMode").click();
		await until(() => $("#previewBody .preview-markdown"), "rendered markdown");
		return {
			heading: $("#previewBody .preview-markdown h2")?.textContent,
			bold: $("#previewBody .preview-markdown strong")?.textContent,
			wrapHidden: $("#previewWrap").hidden,
		};
	`)
    assert.deepEqual(markdown, {
      heading: "Title",
      bold: "bold",
      wrapHidden: true,
    })

    const image = await browser.run(`
		treeRow("logo.png").click();
		const img = await until(() => $("#previewBody img.preview-image"), "image element");
		await until(() => img.complete && img.naturalWidth > 0, "image to decode");
		return { width: img.naturalWidth, copyHidden: $("#previewCopy").hidden, modeHidden: $("#previewMode").hidden };
	`)
    assert.deepEqual(image, { width: 1, copyHidden: true, modeHidden: true })

    const binary = await browser.run(`
		treeRow("blob.bin").click();
		await until(() => $(".preview-tab.active").textContent.trim() === "blob.bin" && $("#previewBody .preview-message"), "binary placeholder");
		return { lines: $$("#previewBody .code-line").length, message: $("#previewBody .preview-message").textContent };
	`)
    assert.equal(binary.lines, 0)
    assert.ok(binary.message.length > 0)
  },
)

test(
  "the preview panel hides and returns without losing its tabs",
  { skip },
  async () => {
    await browser.chord("KeyB", "b", SHIFT_META)
    const hidden = await browser.run(`
		await until(() => $("#previewPanel").hidden, "panel to hide");
		return { shifted: $(".app").classList.contains("preview-open"), reopen: !$("#previewShow").hidden };
	`)
    assert.deepEqual(hidden, { shifted: false, reopen: true })
    const shown = await browser.run(`
		$("#previewShow").click();
		await until(() => !$("#previewPanel").hidden, "panel to return");
		return tabs().length;
	`)
    assert.equal(shown, 4)
  },
)

test(
  "search finds files in folders that were never expanded",
  { skip },
  async () => {
    const found = await browser.run(`
		// Start from a tree where the match's folder is collapsed.
		treeRow("src").click();
		await until(() => !treeRow("src/main.ts"), "src to collapse");
		const input = $("#fileTreeSearch");
		input.value = "NEEDLE";
		input.dispatchEvent(new Event("input"));
		await until(() => treeRow("src/deep/needle-file.ts"), "search result");
		const results = treeRows();
		const detail = treeRow("src/deep/needle-file.ts").querySelector(".file-detail").textContent;
		treeRow("src/deep/needle-file.ts").click();
		await until(() => $(".preview-tab.active").textContent.trim() === "needle-file.ts", "result to open");
		input.value = "zzz-no-such-file";
		input.dispatchEvent(new Event("input"));
		await until(() => !treeRows().length && $("#fileTreeBody .empty-list"), "empty result");
		// A folder result leaves search and reveals the folder in the tree.
		input.value = "deep";
		input.dispatchEvent(new Event("input"));
		await until(() => treeRow("src/deep"), "folder result");
		treeRow("src/deep").click();
		await until(() => !input.value && treeRow("src/deep/needle-file.ts") && treeRow("docs"), "folder to be revealed");
		return { results, detail, revealed: treeRow("src/deep").getAttribute("aria-expanded") };
	`)
    assert.deepEqual(found.results, ["src/deep/needle-file.ts"])
    assert.equal(found.detail, "src/deep")
    assert.equal(found.revealed, "true")
  },
)

test(
  "add workspace opens the system folder picker and registers the chosen folder",
  { skip: nativePickerSkip },
  async () => {
    const before = await browser.run(`
		$("#fileTreeBack").click();
		return { projects: projects(), tooltip: $("#addWorkspace").dataset.tooltip };
	`)
    assert.deepEqual(before.projects, [])
    assert.match(before.tooltip, /O$/)

    // Cancelling the dialog changes nothing and opens no in-page dialog.
    await writeFile(pickerResult, "cancel")
    await rm(pickerArgs, { force: true })
    await browser.chord("KeyO", "o", ALT_META)
    const cancelled = await browser.run(`
		await until(() => $("#addWorkspace").getAttribute("aria-busy") === "true", "picker request to start");
		await until(() => !$("#addWorkspace").hasAttribute("aria-busy"), "picker request to finish");
		return { projects: projects(), browser: !$("#workspaceBrowserModal").hidden };
	`)
    assert.deepEqual(cancelled, { projects: [], browser: false })
    const args = await readFile(pickerArgs, "utf8")
    // The dialog is titled in the page's language and starts in the current workspace.
    assert.ok(args.includes("选择工作区文件夹"), args)
    assert.ok(args.includes(workspace), args)

    await writeFile(pickerResult, `${extra}/`)
    const picked = await browser.run(`
		$("#addWorkspace").click();
		await until(() => projects().length === 1, "picked workspace in the sidebar");
		return {
			projects: projects(),
			name: $("#projectGroups .project-name").textContent,
			draft: $("#workspaceButtonName").textContent,
			browser: !$("#workspaceBrowserModal").hidden,
		};
	`)
    assert.deepEqual(picked, {
      projects: [extra],
      name: "second-project",
      draft: "second-project",
      browser: false,
    })
    assert.deepEqual(
      JSON.parse(
        await readFile(join(base, "agent", "web-workspaces.json"), "utf8"),
      ),
      {
        workspaces: [extra],
      },
    )

    const removed = await browser.run(`
		window.confirm = () => true;
		$("#projectGroups .remove-workspace").click();
		await until(() => !projects().length, "workspace to be removed");
		return projects();
	`)
    assert.deepEqual(removed, [])
  },
)

test(
  "a workspace can be added from the sidebar, survives a reload, and can be removed",
  { skip },
  async () => {
    await browser.run(
      `if ($("#fileTree").classList.contains("open")) $("#fileTreeBack").click();`,
    )
    // A broken system picker must not leave the button dead: it falls back to
    // the in-page browser. With the native picker disabled the button opens the
    // browser directly.
    await writeFile(pickerResult, "fail")
    const fallback = await browser.run(`
		$("#addWorkspace").click();
		await until(() => !$("#workspaceBrowserModal").hidden && $("#workspacePathInput").value, "in-page browser");
		return { toast: $("#errorToast").hidden ? "" : $("#errorToast").textContent };
	`)
    if (!nativePickerSkip) assert.match(fallback.toast, /picker exploded/)

    const added = await browser.run(`
		$("#workspaceParentButton").click();
		const row = await until(
			() => $$(".workspace-directory-item").find((item) => item.textContent.trim() === "second-project"),
			"sibling folder in the browser",
		);
		row.click();
		await until(() => $("#workspacePathInput").value.endsWith("second-project"), "folder to open");
		$("#workspaceBrowserConfirm").click();
		await until(() => projects().length === 1, "workspace in the sidebar");
		return {
			projects: projects(),
			name: $("#projectGroups .project-name").textContent,
			draft: $("#workspaceButtonName").textContent,
			empty: $("#projectGroups .project-sessions .empty-list")?.textContent.length > 0,
		};
	`)
    assert.deepEqual(added.projects, [extra])
    assert.equal(added.name, "second-project")
    assert.equal(added.draft, "second-project")
    assert.equal(added.empty, true)
    assert.deepEqual(
      JSON.parse(
        await readFile(join(base, "agent", "web-workspaces.json"), "utf8"),
      ),
      {
        workspaces: [extra],
      },
    )

    await browser.goto(`${origin}/`)
    const reloaded = await browser.run(`
		await until(() => projects().length === 1, "workspace after reload");
		// Its tree is browsable even though it has no conversation yet.
		$("#projectGroups .tree-button").click();
		await until(() => treeRow("lib"), "second workspace tree");
		treeRow("lib").click();
		await until(() => treeRow("lib/util.py"), "second workspace children");
		treeRow("lib/util.py").click();
		await until(() => codeText().includes("def f"), "python preview");
		return { projects: projects(), comment: $(".tok-comment")?.textContent, keyword: $(".tok-keyword")?.textContent };
	`)
    assert.deepEqual(reloaded, {
      projects: [extra],
      comment: "# util",
      keyword: "def",
    })

    const removed = await browser.run(`
		$("#fileTreeBack").click();
		window.confirm = () => true;
		$("#projectGroups .remove-workspace").click();
		await until(() => !projects().length, "workspace to be removed");
		return (await (await fetch("/api/v1/workspaces")).json()).workspaces;
	`)
    assert.deepEqual(removed, [])
    assert.ok(
      existsSync(join(extra, "lib", "util.py")),
      "removing a workspace must not delete files",
    )
  },
)

test(
  "file endpoints refuse unknown folders and paths outside the workspace",
  { skip },
  async () => {
    const statuses = await browser.run(`
		const status = async (endpoint, params) =>
			(await fetch("/api/v1/workspace/" + endpoint + "?" + new URLSearchParams(params))).status;
		const cwd = ${JSON.stringify(workspace)};
		return {
			known: await status("files", { cwd, path: "" }),
			// No longer registered, and no session ever ran there.
			unregistered: await status("files", { cwd: ${JSON.stringify(extra)}, path: "" }),
			parent: await status("files", { cwd: ${JSON.stringify(base)}, path: "" }),
			traversal: await status("file", { cwd, path: "../outside.txt" }),
			absolute: await status("file", { cwd, path: ${JSON.stringify(join(base, "outside.txt"))} }),
			rawText: await status("raw", { cwd, path: "README.md" }),
			rawImage: await status("raw", { cwd, path: "logo.png" }),
		};
	`)
    assert.deepEqual(statuses, {
      known: 200,
      unregistered: 403,
      parent: 403,
      traversal: 400,
      absolute: 400,
      rawText: 415,
      rawImage: 200,
    })
  },
)
