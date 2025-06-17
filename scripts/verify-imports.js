import fs from "fs";
import path from "path";

const rootDir = path.resolve("./src");
const jsFiles = [];

// Recursively get all .js files in /src
function walk(dir) {
  for (const file of fs.readdirSync(dir)) {
    const fullPath = path.join(dir, file);
    if (fs.statSync(fullPath).isDirectory()) {
      walk(fullPath);
    } else if (file.endsWith(".js")) {
      jsFiles.push(fullPath);
    }
  }
}

// Resolve and verify imports
function verifyImports(filePath) {
  const content = fs.readFileSync(filePath, "utf-8");
  const importRegex = /import\s.*?from\s+["'](.*?)["']/g;
  let match;
  while ((match = importRegex.exec(content))) {
    const importPath = match[1];
    if (importPath.startsWith(".") || importPath.startsWith("/")) {
      const resolvedPath = path.resolve(path.dirname(filePath), importPath);
      const exists =
        fs.existsSync(resolvedPath) ||
        fs.existsSync(resolvedPath + ".js") ||
        fs.existsSync(resolvedPath + ".mjs") ||
        fs.existsSync(resolvedPath + ".ts") ||
        fs.existsSync(path.join(resolvedPath, "index.js"));

      if (!exists) {
        console.warn(`❌ Broken import in ${filePath} → ${importPath}`);
      }
    }
  }
}

// Run the check
walk(rootDir);
for (const file of jsFiles) {
  verifyImports(file);
}
