#!/usr/bin/env node
// Publish isolated snapshots; never run Git against this checkout or its linked notes.
import { spawnSync } from "node:child_process"
import { promises as fs } from "node:fs"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const remote = "https://github.com/inayoun/inayoun.github.io.git"
const sourceBranch = "quartz-portfolio"
const deployBranch = "gh-pages"
const siteOrigin = "https://inayoun.github.io"
const publishFolder = "/Users/inayoun/Documents/Obsidian/ina/Publish"
const ignoredDirectories = new Set([
  ".git", ".github", "node_modules", ".quartz", ".quartz-cache", ".cache",
  ".turbo", ".next", ".parcel-cache", ".obsidian", "coverage", "prof",
])
const gitEnvironment = { ...process.env }
// A caller's Git overrides must not redirect these operations into another repo.
for (const key of [
  "GIT_DIR", "GIT_WORK_TREE", "GIT_COMMON_DIR", "GIT_INDEX_FILE",
  "GIT_OBJECT_DIRECTORY", "GIT_ALTERNATE_OBJECT_DIRECTORIES",
]) delete gitEnvironment[key]

function git(cwd, args, accepted = [0]) {
  const result = spawnSync("git", args, {
    cwd, env: gitEnvironment, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
  })
  if (result.error) throw new Error(`Could not start Git: ${result.error.message}`)
  if (!accepted.includes(result.status)) {
    // Git uses the configured credential helper. Do not inspect or print credentials.
    throw new Error(`Git ${args[0]} failed (exit ${result.status ?? result.signal}). ` +
      "No force push or automatic retry was attempted. Check authentication and concurrent remote changes.")
  }
  return { status: result.status, stdout: result.stdout.trim() }
}

function excluded(name, relative, isDirectory) {
  if (name === ".DS_Store" || name.endsWith(".tsbuildinfo")) return true
  // Avoid copying local credential/config files into the source repository.
  if ([".env", ".env.local", ".npmrc", ".netrc", ".git-credentials"].includes(name) ||
      /^\.env\..*\.local$/.test(name)) return true
  if (!relative && ["public", ".openai"].includes(name)) return true
  return ignoredDirectories.has(name) || (isDirectory &&
    /(?:^|[._-])(?:backup\d*|backups|bak)(?:[._-]|$)/i.test(name))
}

async function copySource(from, to, relative = "") {
  await fs.mkdir(to, { recursive: true })
  for (const entry of await fs.readdir(from, { withFileTypes: true })) {
    const source = path.join(from, entry.name)
    const destination = path.join(to, entry.name)
    const childRelative = path.join(relative, entry.name)
    if (excluded(entry.name, relative, entry.isDirectory())) continue
    if (entry.isSymbolicLink()) {
      if (childRelative !== "content") throw new Error(`Unexpected source symlink: ${childRelative}`)
      const target = await fs.realpath(source)
      if (target !== await fs.realpath(publishFolder)) {
        throw new Error("The content symlink must point to the selected Obsidian Publish folder.")
      }
      await copySource(target, destination, childRelative)
    } else if (entry.isDirectory()) {
      await copySource(source, destination, childRelative)
    } else if (entry.isFile()) {
      await fs.copyFile(source, destination)
      await fs.chmod(destination, (await fs.stat(source)).mode & 0o777)
    } else {
      throw new Error(`Unsupported source entry: ${childRelative}`)
    }
  }
}

async function filesIn(directory, relative = "") {
  const files = []
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    const name = path.join(relative, entry.name)
    if (entry.isSymbolicLink()) throw new Error(`Build contains a symlink: ${name}`)
    if (entry.isDirectory()) files.push(...await filesIn(path.join(directory, entry.name), name))
    else if (entry.isFile()) files.push(name)
    else throw new Error(`Unsupported build entry: ${name}`)
  }
  return files
}

async function validateBuild(directory) {
  const files = new Set(await filesIn(directory))
  if (!files.has("index.html")) throw new Error("Build public/index.html before publishing.")
  const home = await fs.readFile(path.join(directory, "index.html"), "utf8")
  if (!/<html(?:\s|>)/i.test(home)) throw new Error("public/index.html is not an HTML document.")
  function checkReference(reference, containingFile) {
    const raw = reference.trim().replace(/&amp;/g, "&")
    if (!raw || raw.startsWith("#")) return
    const url = new URL(raw, `${siteOrigin}/${containingFile.split(path.sep).join("/")}`)
    if (url.protocol === "file:") throw new Error(`Local filesystem URL in ${containingFile}`)
    if (url.origin !== siteOrigin) return // External links and existing CDN resources remain external.
    const relative = decodeURIComponent(url.pathname).replace(/^\/+/, "")
    if (relative.includes("\0") || relative.includes("\\")) throw new Error("Invalid build URL")
    const candidates = [relative, `${relative}.html`, path.posix.join(relative, "index.html")]
    if (!candidates.some((candidate) => files.has(candidate))) {
      throw new Error(`Missing local asset or page in ${containingFile}: ${raw}`)
    }
  }
  for (const file of files) {
    if (!/\.(?:html|css)$/i.test(file)) continue
    const text = await fs.readFile(path.join(directory, file), "utf8")
    if (file.endsWith(".html")) {
      for (const match of text.matchAll(/\b(?:href|src|poster)\s*=\s*(?:"([^"]*)"|'([^']*)')/gi)) {
        checkReference(match[1] ?? match[2], file)
      }
    } else {
      for (const match of text.matchAll(/url\(\s*(?:"([^"]*)"|'([^']*)'|([^)'"\s]*))\s*\)/gi)) {
        checkReference(match[1] ?? match[2] ?? match[3], file)
      }
    }
  }
  return files
}

async function clearWorkingFiles(directory) {
  for (const entry of await fs.readdir(directory)) {
    if (entry !== ".git") await fs.rm(path.join(directory, entry), { recursive: true, force: true })
  }
}

function commitIfChanged(directory, message) {
  // The snapshot's explicit exclusions are authoritative, even for self-ignored .gitignore.
  git(directory, ["add", "--all", "--force", "--", "."])
  if (git(directory, ["diff", "--cached", "--quiet"], [0, 1]).status === 1) {
    git(directory, ["commit", "-m", message])
  }
  return git(directory, ["rev-parse", "HEAD"]).stdout
}

let temporaryRoot
let sourcePushed = false
let deploymentPushed = false
try {
  const configuration = await fs.readFile(path.join(project, "quartz.config.yaml"), "utf8")
  const baseUrls = [...configuration.matchAll(/^  baseUrl:\s*(.*?)\s*$/gm)]
  const baseUrl = baseUrls[0]?.[1].replace(/\s+#.*$/, "").replace(/^(?:"([^"]*)"|'([^']*)')$/, "$1$2")
  if (baseUrls.length !== 1 || baseUrl !== "inayoun.github.io") {
    throw new Error("quartz.config.yaml must set configuration.baseUrl to inayoun.github.io.")
  }
  const publicDirectory = path.join(project, "public")
  await validateBuild(publicDirectory)

  temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), "ina-portfolio-publish-"))
  const snapshotDirectory = path.join(temporaryRoot, "build")
  await fs.cp(publicDirectory, snapshotDirectory, {
    recursive: true,
    filter: (entry) => !["CNAME", ".DS_Store", ".git", ".github"].includes(path.basename(entry)),
  })
  await fs.writeFile(path.join(snapshotDirectory, ".nojekyll"), "")
  await validateBuild(snapshotDirectory)

  const sourceDirectory = path.join(temporaryRoot, "source")
  const deploymentDirectory = path.join(temporaryRoot, "deployment")
  const exists = git(temporaryRoot, ["ls-remote", "--exit-code", "--heads", remote,
    `refs/heads/${sourceBranch}`], [0, 2]).status === 0
  if (exists) {
    git(temporaryRoot, ["clone", "--depth", "1", "--single-branch", "--branch", sourceBranch,
      remote, sourceDirectory])
  } else {
    await fs.mkdir(sourceDirectory)
    git(sourceDirectory, ["init", "-b", sourceBranch])
    git(sourceDirectory, ["remote", "add", "origin", remote])
  }
  git(temporaryRoot, ["clone", "--depth", "1", "--single-branch", "--branch", deployBranch,
    remote, deploymentDirectory])

  await clearWorkingFiles(sourceDirectory)
  await copySource(project, sourceDirectory)
  // Retain the package-manager settings required by this lockfile without
  // copying any checkout-specific npm credentials.
  await fs.writeFile(path.join(sourceDirectory, ".npmrc"),
    "engine-strict=true\nlegacy-peer-deps=true\n")
  await clearWorkingFiles(deploymentDirectory)
  await fs.cp(snapshotDirectory, deploymentDirectory, { recursive: true })
  await validateBuild(deploymentDirectory)

  const sourceSha = commitIfChanged(sourceDirectory, "Update Quartz portfolio source")
  const deploymentSha = commitIfChanged(deploymentDirectory, "Publish Ina Youn portfolio")
  console.log(`Source SHA: ${sourceSha}`)
  console.log(`Deployment SHA: ${deploymentSha}`)
  console.log(`Pushing ${sourceBranch}...`)
  git(sourceDirectory, ["push", "origin", `HEAD:refs/heads/${sourceBranch}`])
  sourcePushed = true
  console.log(`Pushing ${deployBranch}...`)
  git(deploymentDirectory, ["push", "origin", `HEAD:refs/heads/${deployBranch}`])
  deploymentPushed = true
  console.log(`Published Git contents for ${siteOrigin}/`)
  await fs.rm(temporaryRoot, { recursive: true, force: true })
} catch (error) {
  console.error(`Publication stopped: ${error.message}`)
  if (deploymentPushed) console.error("Both branches were pushed; temporary-directory cleanup did not complete.")
  else if (sourcePushed) console.error("The source branch was pushed; deployment did not complete.")
  if (temporaryRoot) console.error(`Recovery working directories retained at: ${temporaryRoot}`)
  process.exitCode = 1
}
