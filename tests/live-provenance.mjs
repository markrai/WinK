/**
 * Live provenance checks. Each case reloads the script (unknown history),
 * asserts the starting rectangle, performs one history, then asserts geometry.
 *
 * A placed top-right quadrant must maximize. The same rectangle reached by
 * Right then Up must stay on a further Up.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { NORMAL, buildRegions } from "./permutations.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dbus = {
    ...process.env,
    DBUS_SESSION_BUS_ADDRESS: process.env.DBUS_SESSION_BUS_ADDRESS || "unix:path=/run/user/1000/bus",
};

function sh(cmd, args) {
    return execFileSync(cmd, args, { encoding: "utf8", env: dbus });
}
function qdbus(...args) {
    return sh("qdbus", args).trim();
}
function sleep(ms) {
    execFileSync("sleep", [String(ms / 1000)]);
}

function findDolphin() {
    const ids = sh("kdotool", ["search", "--class", "dolphin"]).trim().split(/\s+/).filter(Boolean);
    if (!ids.length) {
        throw new Error("no Dolphin window");
    }
    return ids[ids.length - 1];
}

function readGeo(id) {
    const info = qdbus("org.kde.KWin", "/KWin", "org.kde.KWin.getWindowInfo", id);
    const d = {};
    for (const line of info.split("\n")) {
        const i = line.indexOf(":");
        if (i > 0) d[line.slice(0, i).trim()] = line.slice(i + 1).trim();
    }
    return {
        x: Number(d.x),
        y: Number(d.y),
        width: Number(d.width),
        height: Number(d.height),
        minimized: d.minimized === "true",
    };
}

function close(actual, expected) {
    return ["x", "y", "width", "height"].every((k) => Math.abs(actual[k] - expected[k]) <= 32);
}
function fmt(g) {
    return `${g.x},${g.y} ${g.width}x${g.height}${g.minimized ? " minimized" : ""}`;
}

function reloadSnap() {
    const main = path.join(os.homedir(), ".local/share/kwin/scripts/wink/contents/code/main.js");
    fs.mkdirSync(path.dirname(main), { recursive: true });
    fs.copyFileSync(path.join(root, "wink/contents/code/main.js"), main);
    for (let i = 0; i < 10; i++) {
        try {
            qdbus("org.kde.KWin", `/Scripting/Script${i}`, "org.kde.kwin.Script.stop");
        } catch { /* empty */ }
    }
    try {
        qdbus("org.kde.KWin", "/Scripting", "org.kde.kwin.Scripting.unloadScript", "wink");
    } catch { /* not loaded */ }
    sleep(200);
    const id = qdbus("org.kde.KWin", "/Scripting", "org.kde.kwin.Scripting.loadScript", main, "wink");
    qdbus("org.kde.KWin", `/Scripting/Script${id}`, "org.kde.kwin.Script.run");
    sleep(200);
}

let placeSeq = 0;
function place(id, geo) {
    const file = `/tmp/wink-place-${placeSeq++}.js`;
    fs.writeFileSync(file, `
var want = ${JSON.stringify(id)};
var wins = workspace.windowList();
for (var i = 0; i < wins.length; i++) {
    var w = wins[i];
    var wid = "";
    try { wid = String(w.internalId); } catch (e) {}
    if (wid !== want) continue;
    w.minimized = false;
    try { w.setMaximize(false, false); } catch (e2) {}
    w.frameGeometry = { x: ${geo.x}, y: ${geo.y}, width: ${geo.width}, height: ${geo.height} };
    workspace.activeWindow = w;
}
`);
    const sid = qdbus("org.kde.KWin", "/Scripting", "org.kde.kwin.Scripting.loadScript", file, `wink-place-${placeSeq}`);
    qdbus("org.kde.KWin", `/Scripting/Script${sid}`, "org.kde.kwin.Script.run");
    sleep(250);
    try { qdbus("org.kde.KWin", `/Scripting/Script${sid}`, "org.kde.kwin.Script.stop"); } catch { /* gone */ }
    try { qdbus("org.kde.KWin", "/Scripting", "org.kde.kwin.Scripting.unloadScript", `wink-place-${placeSeq}`); } catch { /* name */ }
}

const SHORTCUT = { up: "WinK: Up", down: "WinK: Down", left: "WinK: Left", right: "WinK: Right" };
function press(id, direction) {
    sh("kdotool", ["windowactivate", id]);
    sleep(220);
    qdbus("org.kde.kglobalaccel", "/component/kwin", "org.kde.kglobalaccel.Component.invokeShortcut", SHORTCUT[direction]);
    sleep(300);
}

function main() {
    const id = findDolphin();
    const failures = [];
    function check(label, ok, detail) {
        console.log(`${ok ? "PASS" : "FAIL"} ${label}${detail ? " — " + detail : ""}`);
        if (!ok) failures.push(label);
    }

    // Calibrate from a script-owned Left, then reload so later cases start unknown.
    reloadSnap();
    place(id, NORMAL);
    let g = readGeo(id);
    check("setup normal", close(g, NORMAL), `wanted ${fmt(NORMAL)} got ${fmt(g)}`);
    if (!close(g, NORMAL)) process.exit(1);
    press(id, "left");
    g = readGeo(id);
    const area = { x: g.x, y: g.y, width: g.width * 2, height: g.height };
    const regions = buildRegions(area);
    check("script Left produces left column", close(g, regions.left), fmt(g));
    if (!close(g, regions.left)) process.exit(1);

    function requireStart(label, geo) {
        reloadSnap();
        place(id, geo);
        const got = readGeo(id);
        const ok = close(got, geo) && !got.minimized;
        check(label, ok, `wanted ${fmt(geo)} got ${fmt(got)}`);
        return ok;
    }

    // History A: placed in the top-right quadrant. No script snap. Up maximizes.
    if (requireStart("start placed top-right", regions.topRight)) {
        press(id, "up");
        check("placed top-right + Up maximizes", close(readGeo(id), regions.maximized), fmt(readGeo(id)));
    }

    // History B: script-owned top-right. Same-side Right expands; Up goes to the top row.
    if (requireStart("start floating for script path", NORMAL)) {
        press(id, "right");
        check("script Right", close(readGeo(id), regions.right), fmt(readGeo(id)));
        press(id, "up");
        check("script Right then Up is top-right", close(readGeo(id), regions.topRight), fmt(readGeo(id)));
        press(id, "right");
        check("script top-right + Right → right half", close(readGeo(id), regions.right), fmt(readGeo(id)));
    }

    if (requireStart("script Right Up then Up expands", NORMAL)) {
        press(id, "right");
        press(id, "up");
        check("reach top-right for Up", close(readGeo(id), regions.topRight), fmt(readGeo(id)));
        press(id, "up");
        check("script top-right + Up → top half", close(readGeo(id), regions.top), fmt(readGeo(id)));
        press(id, "up");
        check("script top-right + Up + Up maximizes", close(readGeo(id), regions.maximized), fmt(readGeo(id)));
    }

    // Reload forgets the snap above. The quadrant is unknown again.
    if (requireStart("reload leaves the corner unknown", regions.topRight)) {
        press(id, "up");
        check("after reload + Up maximizes", close(readGeo(id), regions.maximized), fmt(readGeo(id)));
    }

    // A full column we did not snap still folds into the top-right.
    if (requireStart("start placed right column", regions.right)) {
        press(id, "up");
        check("placed right column + Up → top-right", close(readGeo(id), regions.topRight), fmt(readGeo(id)));
    }

    if (requireStart("start placed top half", regions.top)) {
        press(id, "left");
        check("placed top half + Left → top-left", close(readGeo(id), regions.topLeft), fmt(readGeo(id)));
    }

    if (requireStart("start placed top half for Right", regions.top)) {
        press(id, "right");
        check("placed top half + Right → top-right", close(readGeo(id), regions.topRight), fmt(readGeo(id)));
    }

    if (requireStart("start placed bottom half", regions.bottom)) {
        press(id, "left");
        check("placed bottom half + Left → bottom-left", close(readGeo(id), regions.bottomLeft), fmt(readGeo(id)));
    }

    if (requireStart("start placed left column", regions.left)) {
        press(id, "up");
        check("placed left column + Up → top-left", close(readGeo(id), regions.topLeft), fmt(readGeo(id)));
    }

    if (requireStart("script top-left then Left expands", NORMAL)) {
        press(id, "left");
        press(id, "up");
        check("reach script top-left", close(readGeo(id), regions.topLeft), fmt(readGeo(id)));
        press(id, "left");
        check("script top-left + Left → left half", close(readGeo(id), regions.left), fmt(readGeo(id)));
    }

    if (requireStart("script Left Up then Up expands", NORMAL)) {
        press(id, "left");
        press(id, "up");
        check("reach top-left for Up", close(readGeo(id), regions.topLeft), fmt(readGeo(id)));
        press(id, "up");
        check("script top-left + Up → top half", close(readGeo(id), regions.top), fmt(readGeo(id)));
        press(id, "up");
        check("script top-left + Up + Up maximizes", close(readGeo(id), regions.maximized), fmt(readGeo(id)));
    }

    // Restore cycle still returns the original rectangle.
    if (requireStart("start normal for restore", NORMAL)) {
        press(id, "left");
        press(id, "left");
        press(id, "left");
        check("Left Left Left restores normal", close(readGeo(id), NORMAL), fmt(readGeo(id)));
    }

    place(id, { x: area.x + 80, y: area.y + 80, width: 900, height: 600 });
    console.log(`live provenance done, ${failures.length} failure(s)`);
    if (failures.length) process.exit(1);
}

main();
