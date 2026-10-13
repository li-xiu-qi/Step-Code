import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { build } from "esbuild"

const outputPath = join(tmpdir(), "pi-browser-smoke.js")
const errorLogPath = join(tmpdir(), "pi-browser-smoke-errors.log")
const generatedCatalogDataDir = join(
  process.cwd(),
  "packages/providers/src/providers/data",
)

function checkWebPublicSurface() {
  const webPublic = join(process.cwd(), "apps/web/public")
  const index = readFileSync(join(webPublic, "index.html"), "utf8")
  const app = readFileSync(join(webPublic, "app.js"), "utf8")
  const styles = readFileSync(join(webPublic, "styles.css"), "utf8")
  if (
    !index.includes('src="/app.js"') ||
    !index.includes('href="/styles.css"')
  ) {
    throw new Error(
      "apps/web/public/index.html does not reference the Web assets",
    )
  }
  if (!app.includes("EventSource") || !app.includes("/api/v1/sessions")) {
    throw new Error(
      "apps/web/public/app.js does not contain the session stream client",
    )
  }
  if (
    !app.includes("/policy") ||
    !app.includes("/model") ||
    !app.includes("/files") ||
    !app.includes("/auth/logout") ||
    !app.includes("renderMarkdown") ||
    !app.includes("workspaceBrowserModal") ||
    !app.includes("stepcode.theme") ||
    !app.includes("stepcode.locale")
  ) {
    throw new Error(
      "apps/web/public/app.js is missing a first-release interaction",
    )
  }
  if (
    !index.includes('class="sidebar"') ||
    !index.includes('class="main"') ||
    !index.includes('class="composer-card"') ||
    !index.includes('id="workspaceButton"') ||
    !index.includes('id="workspaceBrowserModal"') ||
    !index.includes('id="userPopover"') ||
    !index.includes('class="view-tabs"') ||
    !index.includes('id="themeMenuItem"') ||
    !index.includes('id="languageMenuItem"') ||
    !index.includes('id="logoutMenuItem"') ||
    !index.includes('href="https://platform.stepfun.com/step-plan"')
  ) {
    throw new Error(
      "apps/web/public/index.html is missing the Kimi-style first-release structure",
    )
  }
  if (
    !styles.includes("--sidebar: #f7f7f8") ||
    !styles.includes("--ink: #171718") ||
    !styles.includes("--composer-width: 760px")
  ) {
    throw new Error(
      "apps/web/public/styles.css is missing the Kimi-style first-release tokens",
    )
  }
  // A single stray brace silently drops every rule after it, which is how the
  // search dialog once lost `position: fixed` and flowed into the page layout.
  // Nothing above would notice: the strings are all still present. Balance is
  // cheap to assert and catches the whole class of failure.
  let braceDepth = 0
  for (const character of styles.replace(/\/\*[\s\S]*?\*\//g, "")) {
    if (character === "{") braceDepth += 1
    else if (character === "}") braceDepth -= 1
    if (braceDepth < 0) {
      throw new Error(
        "apps/web/public/styles.css has a closing brace with no matching opening brace",
      )
    }
  }
  if (braceDepth !== 0) {
    throw new Error(
      `apps/web/public/styles.css has ${braceDepth} unclosed brace(s)`,
    )
  }
  if (
    !styles.includes(
      "grid-template-columns: var(--sidebar-width) minmax(0, 1fr)",
    ) ||
    styles.includes("changes-panel")
  ) {
    throw new Error(
      "apps/web/public/styles.css does not preserve the two-column no-right-rail layout",
    )
  }
  if (index.includes('class="topbar"') || styles.includes(".topbar {")) {
    throw new Error(
      "apps/web/public still contains the removed main-area header",
    )
  }
  // Attachments shipped, so the guard that kept them out of the first release
  // no longer applies. The rest are still unbuilt.
  for (const forbidden of [
    "hudToggle",
    'class="hud"',
    "voiceButton",
    "cronPlaceholder",
  ]) {
    if (index.includes(forbidden) || app.includes(forbidden)) {
      throw new Error(`apps/web/public contains post-release UI: ${forbidden}`)
    }
  }
}

// Fresh checkouts do not materialize provider JSON until model data is hydrated.
const generatedCatalogDataPlugin = {
  name: "generated-model-catalog",
  setup(build) {
    build.onResolve({ filter: /^\.\/data\/[^/]+\.json$/ }, (args) => {
      const path = resolve(dirname(args.importer), args.path)
      if (dirname(path) !== generatedCatalogDataDir || existsSync(path)) return
      return { path, namespace: "empty-generated-model-catalog" }
    })
    build.onLoad(
      { filter: /.*/, namespace: "empty-generated-model-catalog" },
      () => ({
        contents: "{}",
        loader: "json",
      }),
    )
  },
}

try {
  checkWebPublicSurface()
  // Browser-safety smoke: bundle the browser-facing package exports and fail on
  // any Node-only runtime import leaking into them. The Step-only build has no
  // built-in providers, so the former selective-provider tree-shake assertions
  // (which required the deleted anthropic catalog) no longer apply.
  await build({
    entryPoints: ["scripts/browser-smoke-entry.ts"],
    bundle: true,
    platform: "browser",
    format: "esm",
    logLevel: "silent",
    outfile: outputPath,
    plugins: [generatedCatalogDataPlugin],
  })

  process.exit(0)
} catch (error) {
  let detailedErrors = ""
  if (
    error &&
    typeof error === "object" &&
    "errors" in error &&
    Array.isArray(error.errors)
  ) {
    detailedErrors = error.errors
      .map((entry) => {
        const location = entry.location
          ? `${entry.location.file}:${entry.location.line}:${entry.location.column}`
          : ""
        return [location, entry.text].filter(Boolean).join(" ")
      })
      .join("\n")
  }

  const baseError =
    error instanceof Error ? (error.stack ?? error.message) : String(error)
  writeFileSync(
    errorLogPath,
    [detailedErrors, baseError].filter(Boolean).join("\n\n"),
    "utf-8",
  )
  console.error(`Browser smoke check failed. See ${errorLogPath}`)
  process.exit(1)
}
