// Capture — Quick Capture notes into the hub-owned inbox
// Writes only <inboxRoot>/<project>/<YYYY-MM-DD-HHMMSS>.md (local time; -2, -3 … when the second is taken).
// Each project's own nightly imports its folder and removes what it added; the hub never writes into a project.
// Returns: { capturePath, noteText, save, inboxCount }

const nodePath = ctx.nodePath || (ctx.require || require)("path");

const pad = (n) => String(n).padStart(2, "0");

function stamp(now) {
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}-`
    + `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
}

function checkProject(project) {
  if (!project || /[\\/]|^\.\.?$/.test(project)) throw new Error(`bad project name: ${project}`);
}

function capturePath(inboxRoot, project, now, exists) {
  const base = stamp(now);
  let p = nodePath.join(inboxRoot, project, `${base}.md`);
  for (let n = 2; exists(p); n++) p = nodePath.join(inboxRoot, project, `${base}-${n}.md`);
  return p;
}

function yamlString(s) {
  return /^[\w][\w .,'()/?!-]*$/.test(s) && !/:\s|\s#/.test(s) ? s : JSON.stringify(s);
}

function noteText(text, project, now) {
  const firstLine = String(text).trim().split(/\r?\n/)[0].trim().slice(0, 80);
  return [
    "---",
    `title: ${yamlString(firstLine)}`,
    `project: ${project}`,
    `captured: ${now.toISOString()}`,
    "---",
    "",
    String(text).trim(),
    "",
  ].join("\n");
}

function save(fs, inboxRoot, project, text, now) {
  checkProject(project);
  if (!String(text || "").trim()) throw new Error("nothing to capture");
  fs.mkdirSync(nodePath.join(inboxRoot, project), { recursive: true });
  const body = noteText(text, project, now);
  const taken = new Set();
  for (let attempt = 0; attempt < 100; attempt++) {
    const p = capturePath(inboxRoot, project, now, (q) => taken.has(q) || fs.existsSync(q));
    try {
      fs.writeFileSync(p, body, { encoding: "utf8", flag: "wx" }); // never overwrite
      return p;
    } catch (e) {
      if (e.code !== "EEXIST") throw e;
      taken.add(p);
    }
  }
  throw new Error("could not find a free file name");
}

function inboxCount(fs, inboxRoot, project) {
  try {
    return fs.readdirSync(nodePath.join(inboxRoot, project)).filter(f => f.endsWith(".md")).length;
  } catch {
    return 0;
  }
}

return { capturePath, noteText, save, inboxCount };
