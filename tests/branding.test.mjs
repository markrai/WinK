/**
 * Product identity: plugin Id wink, display name WinK, installer matches source.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let failures = 0;

function fail(label, detail) {
    failures += 1;
    console.error(`FAIL ${label}`);
    console.error(`  ${detail}`);
}

function ok(label) {
    console.log(`ok ${label}`);
}

function read(rel) {
    return fs.readFileSync(path.join(root, rel), "utf8");
}

const metadata = JSON.parse(read("wink/metadata.json"));
if (metadata.KPlugin?.Id !== "wink") {
    fail("metadata Id", `expected wink, got ${metadata.KPlugin?.Id}`);
} else {
    ok("metadata Id = wink");
}
if (metadata.KPlugin?.Name !== "WinK") {
    fail("metadata Name", `expected WinK, got ${metadata.KPlugin?.Name}`);
} else {
    ok("metadata Name = WinK");
}
if (metadata.KPlugin?.Description !== "Windows-style snapping for KDE Plasma") {
    fail("metadata Description", `got ${metadata.KPlugin?.Description}`);
} else {
    ok("metadata Description");
}

const mainJs = read("wink/contents/code/main.js");
if (!mainJs.includes('var SHORTCUT_PREFIX = "WinK: ";')) {
    fail("SHORTCUT_PREFIX", "missing WinK: shortcut prefix");
} else {
    ok("SHORTCUT_PREFIX = WinK: ");
}
if (!mainJs.includes('var LOG_PREFIX = "[WinK] ";')) {
    fail("LOG_PREFIX", "missing [WinK] log prefix");
} else {
    ok('LOG_PREFIX = [WinK] ');
}
if (mainJs.includes("Win11 Snap:")) {
    fail("main.js leftover shortcut name", "Win11 Snap: still present");
} else {
    ok("main.js has no Win11 Snap: shortcut names");
}

const install = read("scripts/install.sh");
if (!install.includes('SCRIPT_ID="wink"') || !install.includes("${ROOT}/wink")) {
    fail("install.sh", "expected SCRIPT_ID wink and package dir wink/");
} else {
    ok("install.sh targets wink");
}

const apply = read("scripts/apply-plasma-config.sh");
if (!apply.includes('SCRIPT_ID="wink"') || !apply.includes('PREFIX="WinK"')) {
    fail("apply-plasma-config.sh", "expected SCRIPT_ID wink and PREFIX WinK");
} else {
    ok("apply-plasma-config.sh identity");
}
if (!apply.includes("wink/backups")) {
    fail("backup dir", "expected ~/.local/state/wink/backups");
} else {
    ok("backup dir wink/backups");
}

const uninstall = read("scripts/uninstall.sh");
if (!uninstall.includes('SCRIPT_ID="wink"')) {
    fail("uninstall.sh", "expected SCRIPT_ID wink");
} else {
    ok("uninstall.sh targets wink");
}

const makefile = read("Makefile");
if (!makefile.includes("cd wink && zip -r ../wink.kwinscript")) {
    fail("Makefile package", "expected wink.kwinscript from wink/");
} else {
    ok("Makefile packages wink.kwinscript");
}

const standalonePath = path.join(root, "install-wink.sh");
if (!fs.existsSync(standalonePath)) {
    fail("install-wink.sh", "missing; run make standalone");
} else {
    const standalone = fs.readFileSync(standalonePath, "utf8");
    const delim = "EOF_contents_code_main.js_WINK";
    const start = standalone.indexOf(`cat > "\${PKG}/contents/code/main.js" << '${delim}'\n`);
    const end = standalone.indexOf(`\n${delim}\n`, start);
    if (start < 0 || end < 0) {
        fail("standalone main.js", "could not find embedded main.js heredoc");
    } else {
        const marker = `cat > "\${PKG}/contents/code/main.js" << '${delim}'\n`;
        const embedded = standalone.slice(start + marker.length, end + 1);
        const canonical = mainJs.endsWith("\n") ? mainJs : `${mainJs}\n`;
        if (embedded !== canonical) {
            fail("standalone main.js", "install-wink.sh embedded main.js differs from wink/contents/code/main.js");
        } else {
            ok("install-wink.sh main.js matches canonical source");
        }
    }
    if (!standalone.includes('SCRIPT_ID="wink"')) {
        fail("standalone SCRIPT_ID", "expected wink");
    } else {
        ok("install-wink.sh SCRIPT_ID = wink");
    }
}

if (fs.existsSync(path.join(root, "win11-snap"))) {
    fail("package dir", "legacy win11-snap/ directory still present");
} else {
    ok("package directory is wink/");
}

if (fs.existsSync(path.join(root, "install-win11-snap.sh"))) {
    fail("legacy installer", "install-win11-snap.sh still present");
} else {
    ok("no install-win11-snap.sh wrapper");
}

if (failures) {
    console.error(`\n${failures} branding check(s) failed`);
    process.exit(1);
}
console.log("\nbranding ok");
