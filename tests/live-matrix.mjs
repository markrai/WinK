/**
 * Drive every permutation against a real Dolphin window.
 *
 * Setup geometry is read back before the shortcut. A case that did not land
 * where it was placed is a failure, not a pass.
 *
 * Requires a Plasma session and a window whose caption contains "Dolphin".
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { NORMAL, buildRegions, cells, classificationFixtures, scenarios } from "./permutations.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dbus = { ...process.env, DBUS_SESSION_BUS_ADDRESS: process.env.DBUS_SESSION_BUS_ADDRESS || "unix:path=/run/user/1000/bus" };

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
        throw new Error("no Dolphin window — open one (caption like \"tmp — Dolphin\") and re-run");
    }
    return ids[ids.length - 1];
}

function readGeo(id) {
    const info = qdbus("org.kde.KWin", "/KWin", "org.kde.KWin.getWindowInfo", id);
    const d = {};
    for (const line of info.split("\n")) {
        const i = line.indexOf(":");
        if (i > 0) {
            d[line.slice(0, i).trim()] = line.slice(i + 1).trim();
        }
    }
    return {
        x: Number(d.x),
        y: Number(d.y),
        width: Number(d.width),
        height: Number(d.height),
        minimized: d.minimized === "true",
    };
}

function close(actual, expected, tol = 32) {
    if (!actual || !expected) {
        return false;
    }
    return ["x", "y", "width", "height"].every((k) => Math.abs(actual[k] - expected[k]) <= tol);
}

function fmt(g) {
    if (!g) {
        return "missing";
    }
    const min = g.minimized ? " minimized" : "";
    return `${g.x},${g.y} ${g.width}x${g.height}${min}`;
}

function reloadSnap() {
    const main = path.join(os.homedir(), ".local/share/kwin/scripts/wink/contents/code/main.js");
    fs.mkdirSync(path.dirname(main), { recursive: true });
    fs.copyFileSync(path.join(root, "wink/contents/code/main.js"), main);
    for (let i = 0; i < 10; i++) {
        try {
            qdbus("org.kde.KWin", `/Scripting/Script${i}`, "org.kde.kwin.Script.stop");
        } catch {
            /* slot empty */
        }
    }
    try {
        qdbus("org.kde.KWin", "/Scripting", "org.kde.kwin.Scripting.unloadScript", "wink");
    } catch {
        /* not loaded */
    }
    sleep(200);
    const id = qdbus(
        "org.kde.KWin",
        "/Scripting",
        "org.kde.kwin.Scripting.loadScript",
        main,
        "wink"
    );
    qdbus("org.kde.KWin", `/Scripting/Script${id}`, "org.kde.kwin.Script.run");
    sleep(200);
}

let placeSeq = 0;

function place(id, geo) {
    const file = `/tmp/wink-place-${placeSeq++}.js`;
    const body = `
var want = ${JSON.stringify(id)};
var wins = workspace.windowList();
var chosen = null;
for (var i = 0; i < wins.length; i++) {
    var w = wins[i];
    var wid = "";
    try { wid = String(w.internalId); } catch (e) {}
    if (wid === want) {
        chosen = w;
        break;
    }
}
if (!chosen) {
    for (var j = 0; j < wins.length; j++) {
        var w2 = wins[j];
        var cls = "";
        var cap = "";
        try { cls = String(w2.resourceClass); } catch (e3) {}
        try { cap = String(w2.caption); } catch (e4) {}
        if (cls.indexOf("dolphin") !== -1 && cap.indexOf("Dolphin") !== -1) {
            chosen = w2;
            break;
        }
    }
}
if (chosen) {
    chosen.minimized = false;
    try { chosen.setMaximize(false, false); } catch (e2) {}
    chosen.frameGeometry = { x: ${geo.x}, y: ${geo.y}, width: ${geo.width}, height: ${geo.height} };
    workspace.activeWindow = chosen;
}
`;
    fs.writeFileSync(file, body);
    const sid = qdbus(
        "org.kde.KWin",
        "/Scripting",
        "org.kde.kwin.Scripting.loadScript",
        file,
        `wink-place-${placeSeq}`
    );
    qdbus("org.kde.KWin", `/Scripting/Script${sid}`, "org.kde.kwin.Script.run");
    sleep(250);
    try {
        qdbus("org.kde.KWin", `/Scripting/Script${sid}`, "org.kde.kwin.Script.stop");
    } catch {
        /* already gone */
    }
    try {
        qdbus("org.kde.KWin", "/Scripting", "org.kde.kwin.Scripting.unloadScript", `wink-place-${placeSeq}`);
    } catch {
        /* name may not unload */
    }
}

const SHORTCUT = {
    up: "WinK: Up",
    down: "WinK: Down",
    left: "WinK: Left",
    right: "WinK: Right",
};

function press(id, direction) {
    sh("kdotool", ["windowactivate", id]);
    sleep(200);
    qdbus("org.kde.kglobalaccel", "/component/kwin", "org.kde.kglobalaccel.Component.invokeShortcut", SHORTCUT[direction]);
    // Past the script's same-key debounce, and long enough for geometry to commit.
    sleep(280);
}

function unminimize(id) {
    try {
        sh("kdotool", ["windowstate", "--remove", "MINIMIZED", id]);
    } catch {
        /* already visible */
    }
    sleep(150);
}

const REACH = {
    floating: [],
    maximized: ["up"],
    left: ["left"],
    right: ["right"],
    top: ["up", "up"],
    bottom: ["left", "down", "right"],
    topLeft: ["left", "up"],
    topRight: ["right", "up"],
    bottomLeft: ["left", "down"],
    bottomRight: ["right", "down"],
};

function main() {
    const id = findDolphin();
    console.log(`window ${id} ${readGeo(id).width}x${readGeo(id).height}`);
    reloadSnap();

    const failures = [];
    function check(label, ok, detail) {
        console.log(`${ok ? "PASS" : "FAIL"} ${label}${detail ? " — " + detail : ""}`);
        if (!ok) {
            failures.push(label);
        }
    }

    // Calibrate the work area from a real Left snap. Place must stick.
    place(id, NORMAL);
    let got = readGeo(id);
    check("place floating normal", close(got, NORMAL), `wanted ${fmt(NORMAL)} got ${fmt(got)}`);
    if (!close(got, NORMAL)) {
        console.error(`${failures.length} live failure(s); aborting because placement did not stick`);
        process.exit(1);
    }
    press(id, "left");
    got = readGeo(id);
    const area = { x: got.x, y: got.y, width: got.width * 2, height: got.height };
    const regions = buildRegions(area);
    check("calibrate left half", close(got, regions.left), `got ${fmt(got)} area ${area.width}x${area.height}`);
    if (!close(got, regions.left)) {
        console.error("aborting: Left did not produce a half, so the rest of the matrix would be noise");
        process.exit(1);
    }

    function expectOutcome(label, lands, expectGeo) {
        const g = readGeo(id);
        if (lands === "minimized" || lands === "minimize") {
            check(label, g.minimized, fmt(g));
            unminimize(id);
            return;
        }
        if (g.minimized) {
            check(label, false, `minimized, expected ${lands}`);
            unminimize(id);
            return;
        }
        if (lands === "floating" || lands === "restore") {
            const target = expectGeo || NORMAL;
            check(label, close(g, target), `wanted ${fmt(target)} got ${fmt(g)}`);
            return;
        }
        const target = lands === "maximized" ? regions.maximized : regions[lands];
        check(label, close(g, target), `wanted ${lands} ${fmt(target)} got ${fmt(g)}`);
    }

    function placeChecked(label, geo) {
        place(id, geo);
        const g = readGeo(id);
        const ok = close(g, geo);
        check(label, ok, `wanted ${fmt(geo)} got ${fmt(g)}`);
        return ok;
    }

    // Windowed-in-corner and exact-quadrant sequences. Each starts from a placed frame.
    for (const scenario of scenarios(area)) {
        // seedCache is script memory. If the starting rect is that region,
        // reach it with arrows. Stale-cache cases (small window + old region)
        // cannot be reproduced live and stay skipped.
        if (scenario.seedCache) {
            const seedRect = regions[scenario.seedCache];
            const geoIsThatRegion = seedRect && close(scenario.geo, seedRect);
            if (!geoIsThatRegion) {
                continue;
            }
            const reach = {
                topLeft: ["left", "up"],
                bottomLeft: ["left", "down"],
                topRight: ["right", "up"],
                bottomRight: ["right", "down"],
                left: ["left"],
                right: ["right"],
            }[scenario.seedCache];
            if (!reach || !placeChecked(`setup ${scenario.id}`, NORMAL)) {
                continue;
            }
            for (const direction of reach) {
                press(id, direction);
            }
            const g = readGeo(id);
            const target = regions[scenario.seedCache];
            if (!close(g, target)) {
                check(`reach ${scenario.id}`, false, `wanted ${scenario.seedCache} ${fmt(target)} got ${fmt(g)}`);
                continue;
            }
            check(`reach ${scenario.id}`, true, fmt(g));
            scenario.steps.forEach((step, index) => {
                press(id, step.direction);
                expectOutcome(`${scenario.id} [${index + 1} ${step.direction}]`, step.lands, step.geo || null);
            });
            continue;
        }
        if (!placeChecked(`setup ${scenario.id}`, scenario.geo)) {
            continue;
        }
        // Let a stale snap cache notice the new frame before the first key.
        sleep(120);
        scenario.steps.forEach((step, index) => {
            press(id, step.direction);
            const targetGeo = step.geo
                ? step.geo
                : step.lands === "floating"
                  ? scenario.geo
                  : null;
            expectOutcome(`${scenario.id} [${index + 1} ${step.direction}]`, step.lands, targetGeo);
        });
    }

    // Every region × arrow except minimized (a minimized window is not the active one).
    for (const cell of cells()) {
        if (cell.region === "minimized") {
            continue;
        }
        if (!placeChecked(`setup ${cell.id}`, NORMAL)) {
            continue;
        }
        let setupOk = true;
        for (const direction of REACH[cell.region]) {
            press(id, direction);
        }
        if (cell.region !== "floating") {
            const g = readGeo(id);
            const target = cell.region === "maximized" ? regions.maximized : regions[cell.region];
            setupOk = close(g, target);
            check(`reach ${cell.id}`, setupOk, `wanted ${cell.region} ${fmt(target)} got ${fmt(g)}`);
        }
        if (!setupOk) {
            continue;
        }
        press(id, cell.direction);
        const lands = cell.lands === "restore" ? "floating" : cell.lands === "minimize" ? "minimized" : cell.lands;
        const expectGeo = cell.lands === "restore" ? NORMAL : null;
        expectOutcome(cell.id, lands, expectGeo);
    }

    // One minimized check, then bring the window back.
    if (placeChecked("setup floating+down", NORMAL)) {
        press(id, "down");
        expectOutcome("floating+down", "minimized", null);
    }

    place(id, { x: area.x + 80, y: area.y + 80, width: 900, height: 600 });
    sh("kdotool", ["windowactivate", id]);

    const parked = classificationFixtures(area).filter((f) => f.expect === "floating" && f.id.startsWith("class:parked"));
    console.log(`live matrix done, ${failures.length} failure(s), ${parked.length} parked-corner fixtures included in scenarios`);
    if (failures.length) {
        process.exit(1);
    }
}

main();
