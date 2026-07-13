import fs from "fs";
import path from "path";

const PROJECTS = [
  { path: "C:/myapps/buddy-agent", name: "Buddy Agent" },
  { path: "C:/myapps/pizza-voice-agent", name: "Pizza Voice Agent" },
  { path: "C:/myapps/loopforge", name: "LoopForge" },
  { path: "C:/myapps/dataset-factory", name: "Dataset Factory" },
  { path: "C:/myapps/tinyllama-qlora-colab", name: "TinyLlama QLoRA Colab" },
  { path: "C:/myapps/TinyLlama-Training", name: "TinyLlama Local Training" },
  { path: "C:/myapps/ai-consultant-pipeline", name: "AI Consultant Pipeline" },
  { path: "C:/myapps/cargo-tracking-agent", name: "Cargo Tracking Agent" },
  { path: "C:/myapps/agentpulse", name: "AgentPulse" },
  { path: "C:/myapps/gitmint", name: "GitMint" },
  { path: "C:/myapps/clawnch-agent", name: "Clawnch Agent" },
  { path: "C:/myapps/HoReCa-agent", name: "HoReCa Outreach Agent" },
  { path: "C:/myapps/doshka-backend", name: "Doshka Kanban Backend" },
  { path: "C:/myapps/ai-frontier-landing", name: "AI Frontier Landing" },
  { path: "C:/myapps/doit-agent-landing", name: "Do It Agent Landing" },
  { path: "C:/myapps/elva-landing", name: "Elva Landing" },
  { path: "C:/myapps/azamaza", name: "Azamaza" },
  { path: "C:/myapps/blockchain-portfolio", name: "Portfolio Website volodeveth" },
];

const EXCLUDED_DIRS = new Set([
  "node_modules", ".next", "dist", "build", "out", ".vercel",
  ".git", ".claude", ".github", "__pycache__", ".turbo",
  "coverage", ".nyc_output", ".cache", "vendor",
  "public", "static", "assets", "bundles",
  "migrations", "test", "tests", "__tests__",
  "artifacts", "cache", "typechain-types", "deployments",
  "notes", "note", "memory", "logs", "traces", "audits",
  "data", "datasets", "output", "outputs", "tmp", "temp", "scratch",
  "transcripts", "sessions", "backups",
  "ZoriumFunNew",
]);

const EXCLUDED_EXTENSIONS = new Set([
  ".env", ".pem", ".key", ".p12", ".pfx",
  ".png", ".jpg", ".jpeg", ".gif", ".svg", ".mp4", ".mp3",
  ".webp", ".ico", ".woff", ".woff2", ".ttf", ".eot",
  ".map", ".min.js", ".min.css", ".d.ts",
  ".lock", ".jsonl", ".log",
]);

const EXCLUDED_FILES = new Set([
  "package-lock.json", "yarn.lock", "pnpm-lock.yaml",
  "CLAUDE.md", ".gitignore", ".npmrc", ".eslintcache",
  "next-env.d.ts", "postcss.config.js", "postcss.config.mjs",
  "tailwind.config.js", "tailwind.config.ts",
  "tsconfig.json", "eslint.config.mjs", ".eslintrc.js", ".eslintrc.json",
  "jest.config.js", "jest.config.ts", "vitest.config.ts",
  "globals.css", "preload.php", "bundles.php",
]);

const SECRET_PATTERNS = [
  /\.env/i, /secret/i, /credential/i, /\.pem$/i, /\.key$/i,
];

const SOURCE_EXTENSIONS = new Set([
  ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs",
  ".py", ".php", ".sol", ".rs", ".go",
  ".css", ".scss", ".html",
]);

const MAX_FILE_SIZE = 50000; // skip files larger than 50KB (likely generated)
const OUTPUT_DIR = path.resolve("scripts/project-docs-2026");

function isSafe(filePath) {
  const base = path.basename(filePath);
  const ext = path.extname(filePath).toLowerCase();

  if (EXCLUDED_FILES.has(base)) return false;
  if (EXCLUDED_EXTENSIONS.has(ext)) return false;
  if (SECRET_PATTERNS.some((p) => p.test(base))) return false;

  return true;
}

function readFileSafe(filePath, maxLines = Infinity) {
  try {
    const content = fs.readFileSync(filePath, "utf-8");
    if (maxLines === Infinity) return content;
    return content.split("\n").slice(0, maxLines).join("\n");
  } catch {
    return null;
  }
}

function findSourceFiles(projectPath) {
  const results = [];

  function walk(dir, relative = "") {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (EXCLUDED_DIRS.has(entry.name)) continue;

      const fullPath = path.join(dir, entry.name);
      const relPath = path.join(relative, entry.name).replace(/\\/g, "/");

      if (entry.isDirectory()) {
        walk(fullPath, relPath);
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        if (!SOURCE_EXTENSIONS.has(ext)) continue;
        if (!isSafe(fullPath)) continue;

        try {
          const stat = fs.statSync(fullPath);
          if (stat.size > MAX_FILE_SIZE) continue;
          if (stat.size === 0) continue;
        } catch {
          continue;
        }

        results.push({ fullPath, relPath });
      }
    }
  }

  walk(projectPath);
  return results;
}

function extractPackageInfo(projectPath) {
  const pkgPath = path.join(projectPath, "package.json");
  const content = readFileSafe(pkgPath);
  if (!content) return null;

  try {
    const pkg = JSON.parse(content);
    const deps = [
      ...Object.keys(pkg.dependencies || {}),
      ...Object.keys(pkg.devDependencies || {}),
    ];
    return {
      name: pkg.name || "unknown",
      description: pkg.description || "",
      dependencies: deps.join(", "),
    };
  } catch {
    return null;
  }
}

function collectProject(project) {
  const { path: projectPath, name } = project;

  if (!fs.existsSync(projectPath)) {
    console.warn(`  SKIP: ${name} — path not found: ${projectPath}`);
    return null;
  }

  const sections = [`# Project: ${name}\n`];

  // Package info
  const pkg = extractPackageInfo(projectPath);
  if (pkg) {
    sections.push(`## Package Info`);
    sections.push(`Name: ${pkg.name}`);
    if (pkg.description) sections.push(`Description: ${pkg.description}`);
    sections.push(`Dependencies: ${pkg.dependencies}\n`);
  }

  // README (check multiple names and subdirs)
  const readmeNames = ["README.md", "readme.md", "README.MD", "README"];
  let foundReadme = false;
  for (const rn of readmeNames) {
    const content = readFileSafe(path.join(projectPath, rn));
    if (content) {
      sections.push(`## README\n${content}\n`);
      foundReadme = true;
      break;
    }
  }

  // Alternative doc files (for projects without README)
  const altDocs = [
    "CONTEXT_FOR_CLAUDE.md", "DOIT.md", "NEXT_STEPS.md",
    "docs/README.md", "SEO_PROGRESS.md",
  ];
  for (const doc of altDocs) {
    const content = readFileSafe(path.join(projectPath, doc));
    if (content) {
      sections.push(`## ${path.basename(doc)}\n${content}\n`);
    }
  }

  // requirements.txt for Python projects
  const reqContent = readFileSafe(path.join(projectPath, "requirements.txt"));
  if (reqContent && !pkg) {
    sections.push(`## Python Dependencies (requirements.txt)\n\`\`\`\n${reqContent}\n\`\`\`\n`);
  }

  // Check for README in first-level subdirs (e.g., php/doshka-backend)
  if (!foundReadme && !pkg) {
    try {
      const entries = fs.readdirSync(projectPath, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory() && !EXCLUDED_DIRS.has(entry.name)) {
          const subReadme = readFileSafe(path.join(projectPath, entry.name, "README.md"));
          if (subReadme) {
            sections.push(`## README (${entry.name}/)\n${subReadme}\n`);
            // Also check for package.json in subdir
            const subPkg = extractPackageInfo(path.join(projectPath, entry.name));
            if (subPkg) {
              sections.push(`## Package Info (${entry.name}/)`);
              sections.push(`Name: ${subPkg.name}`);
              if (subPkg.description) sections.push(`Description: ${subPkg.description}`);
              sections.push(`Dependencies: ${subPkg.dependencies}\n`);
            }
            break;
          }
        }
      }
    } catch {}
  }

  // All source files (full content)
  const sourceFiles = findSourceFiles(projectPath);
  if (sourceFiles.length > 0) {
    sections.push(`## Source Files`);
    for (const sf of sourceFiles) {
      const content = readFileSafe(sf.fullPath);
      if (content && content.trim()) {
        sections.push(`### ${sf.relPath}\n\`\`\`\n${content}\n\`\`\`\n`);
      }
    }
  }

  return sections.join("\n");
}

function main() {
  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  console.log(`Collecting projects into ${OUTPUT_DIR}\n`);

  let collected = 0;
  let skipped = 0;

  for (const project of PROJECTS) {
    console.log(`Processing: ${project.name} (${project.path})`);
    const doc = collectProject(project);

    if (!doc) {
      skipped++;
      continue;
    }

    const safeName = project.name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
    const outputPath = path.join(OUTPUT_DIR, `${safeName}.txt`);
    fs.writeFileSync(outputPath, doc, "utf-8");
    console.log(`  -> ${outputPath} (${doc.length} chars)`);
    collected++;
  }

  console.log(`\nDone: ${collected} collected, ${skipped} skipped`);
  console.log(`Review files in ${OUTPUT_DIR} before ingesting!`);
}

main();
