/**
 * Runs every Windows 11 permutation against the real KWin script
 * (wink/contents/code/main.js), not a copy of the table.
 */
import fs from "node:fs";
import vm from "node:vm";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
    AREA,
    NORMAL,
    REGIONS,
    DIRECTIONS,
    NEXT,
    cells,
    buildRegions,
    classificationFixtures,
    scenarios,
    cycleAcrossLanding,
} from "./permutations.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const scriptPath = path.join(root, "wink/contents/code/main.js");

const context = {
    readConfig: (_key, fallback) => fallback,
    print: () => {},
    registerShortcut: () => {},
    KWin: { MaximizeArea: 1 },
    workspace: {
        activeWindow: null,
        screens: [{}],
        windowList: () => [],
        windowAdded: { connect() {} },
        windowRemoved: { connect() {} },
        clientArea: () => ({ ...AREA }),
        slotWindowMaximize() {},
        hops: [],
        slotWindowToLeftScreen() { this.hops.push("left"); },
        slotWindowToRightScreen() { this.hops.push("right"); },
    },
};
vm.createContext(context);
vm.runInContext(fs.readFileSync(scriptPath, "utf8"), context, { filename: scriptPath });

const api = ["nextAction", "currentRegion", "handleDirection", "setCachedRegion", "getSlot"];
for (const name of api) {
    if (typeof context[name] !== "function") {
        throw new Error(`main.js did not expose ${name}`);
    }
}

const map = buildRegions(AREA);
let failures = 0;

function fail(label, detail) {
    failures += 1;
    console.error(`FAIL ${label}: ${detail}`);
}

function makeWin(geo, id) {
    const win = {
        internalId: id,
        frameGeometry: { ...geo },
        minimized: false,
        maximized: false,
        maximizeMode: 0,
        deleted: false,
        normalWindow: true,
        moveable: true,
        move: false,
        resize: false,
        desktopWindow: false,
        dock: false,
        setMaximize(h, v) {
            this.maximized = !!(h && v);
            this.maximizeMode = this.maximized ? 3 : 0;
            if (this.maximized) {
                this.frameGeometry = { ...map.maximized };
            }
        },
    };
    context.workspace.activeWindow = win;
    return win;
}

function geoClose(actual, expected) {
    return ["x", "y", "width", "height"].every((k) => Math.abs(actual[k] - expected[k]) <= 1);
}

function observe(win) {
    if (win.minimized) {
        return { region: "minimized", geo: { ...win.frameGeometry } };
    }
    if (win.maximized || geoClose(win.frameGeometry, map.maximized)) {
        // A restored floating window must not cover the work area in these tests.
        if (win.maximized || (win.frameGeometry.width === AREA.width && win.frameGeometry.height === AREA.height &&
            context.currentRegion(win) === "maximized")) {
            return { region: "maximized", geo: { ...win.frameGeometry } };
        }
    }
    const region = context.currentRegion(win);
    return { region, geo: { ...win.frameGeometry } };
}

function expectLands(win, lands, expectGeo, label) {
    const seen = observe(win);
    if (lands === "minimized" || lands === "minimize") {
        if (!win.minimized) {
            fail(label, `expected minimized, geometry ${seen.geo.width}x${seen.geo.height}`);
        }
        return;
    }
    if (lands === "restore" || lands === "floating") {
        if (win.minimized) {
            fail(label, "expected floating, window is minimized");
            return;
        }
        if (expectGeo && !geoClose(win.frameGeometry, expectGeo)) {
            const g = win.frameGeometry;
            fail(label, `expected restored ${expectGeo.x},${expectGeo.y} ${expectGeo.width}x${expectGeo.height}, got ${g.x},${g.y} ${g.width}x${g.height}`);
        }
        return;
    }
    if (lands === "maximized") {
        if (!win.maximized && !geoClose(win.frameGeometry, map.maximized)) {
            const g = win.frameGeometry;
            fail(label, `expected maximized, got ${g.x},${g.y} ${g.width}x${g.height}`);
        }
        return;
    }
    const target = map[lands];
    if (!target) {
        fail(label, `no rect for ${lands}`);
        return;
    }
    if (!geoClose(win.frameGeometry, target)) {
        const g = win.frameGeometry;
        fail(label, `expected ${lands} ${target.x},${target.y} ${target.width}x${target.height}, got ${g.x},${g.y} ${g.width}x${g.height} (script region ${seen.region})`);
    }
}

function seedNormal(win) {
    win.frameGeometry = { ...NORMAL };
    win.minimized = false;
    win.maximized = false;
    win.maximizeMode = 0;
    context.currentRegion(win);
}

function placeAs(win, region) {
    if (region === "floating") {
        win.frameGeometry = { ...NORMAL };
        win.minimized = false;
        win.maximized = false;
        win.maximizeMode = 0;
        return;
    }
    if (region === "minimized") {
        win.frameGeometry = { ...NORMAL };
        win.minimized = true;
        win.maximized = false;
        return;
    }
    if (region === "maximized") {
        win.minimized = false;
        win.setMaximize(true, true);
        return;
    }
    win.minimized = false;
    win.maximized = false;
    win.maximizeMode = 0;
    win.frameGeometry = { ...map[region] };
    // Occupying the rect is not enough. The cell is the snapped state.
    context.setCachedRegion(win, region);
}

function press(direction) {
    context.lastHandleAt = 0;
    context.handleDirection(direction);
}

// Spec completeness: every region × arrow exists, and main.js agrees.
const seen = new Set();
for (const cell of cells()) {
    seen.add(cell.id);
    const fromScript = context.nextAction(cell.region, cell.direction);
    if (fromScript !== cell.action) {
        fail(cell.id, `script nextAction ${fromScript}, spec ${cell.action}`);
    }
}
for (const region of REGIONS) {
    for (const direction of DIRECTIONS) {
        if (!seen.has(`${region}+${direction}`)) {
            fail(`${region}+${direction}`, "missing from the permutation list");
        }
    }
}

// Classification, including corner-parked windows that must stay floating.
for (const fixture of classificationFixtures()) {
    const win = makeWin(fixture.geo, fixture.id);
    if (fixture.maximized) {
        win.maximized = true;
        win.maximizeMode = 3;
    }
    if (fixture.seedCache) {
        context.setCachedRegion(win, fixture.seedCache);
    }
    const got = context.currentRegion(win);
    if (got !== fixture.expect) {
        fail(fixture.id, `classified as ${got}, expected ${fixture.expect}`);
    }
}

// Every cell: start in that region (with a remembered normal rect) and press once.
for (const cell of cells()) {
    const win = makeWin(NORMAL, `cell-${cell.id}`);
    seedNormal(win);
    placeAs(win, cell.region);
    press(cell.direction);
    const lands = cell.lands === "restore" ? "floating" : cell.lands === "minimize" ? "minimized" : cell.lands;
    const expectGeo = cell.lands === "restore" ? NORMAL : null;
    expectLands(win, lands, expectGeo, cell.id);
}

// Named sequences, including stale cache and windowed-in-corner.
for (const scenario of scenarios()) {
    const win = makeWin(scenario.geo, `sc-${scenario.id}`);
    seedNormal(win);
    win.frameGeometry = { ...scenario.geo };
    win.minimized = false;
    win.maximized = false;
    win.maximizeMode = 0;
    if (scenario.seedCache) {
        context.setCachedRegion(win, scenario.seedCache);
    }
    scenario.steps.forEach((step, index) => {
        press(step.direction);
        expectLands(win, step.lands, step.geo || null, `${scenario.id} step ${index + 1} ${step.direction}`);
    });
}

// A second callback for the same arrow must not advance again (that pair
// looks like a no-op: quadrant → other half → restore).
{
    const win = makeWin(map.bottomLeft, "double-left");
    seedNormal(win);
    win.frameGeometry = { ...map.bottomLeft };
    context.setCachedRegion(win, "bottomLeft");
    context.lastHandleAt = 0;
    context.handleDirection("left");
    context.handleDirection("left");
    expectLands(win, "left", null, "double Left on bottom-left stays on the first result");
}

// Multi-monitor: corner same-side arrows keep the existing hop-then-inward-half cycle.
function withScreens(count, fn) {
    const previous = context.workspace.screens;
    context.workspace.screens = Array.from({ length: count }, () => ({}));
    context.workspace.hops = [];
    try {
        fn();
    } finally {
        context.workspace.screens = previous;
        context.workspace.hops = [];
    }
}

for (const count of [2, 3]) {
    for (const [region, direction, action] of [
        ["topLeft", "left", "cycleLeft"],
        ["bottomLeft", "left", "cycleLeft"],
        ["topRight", "right", "cycleRight"],
        ["bottomRight", "right", "cycleRight"],
    ]) {
        const baseline = cycleAcrossLanding(action);
        withScreens(count, () => {
            if (context.resolveSameSideCorner(region, action) !== action) {
                fail(`${count}mon ${region}+${direction} resolve`, "must keep cycle token");
            }
            const win = makeWin(NORMAL, `${count}mon-${region}-${direction}`);
            seedNormal(win);
            placeAs(win, region);
            context.workspace.hops = [];
            press(direction);
            expectLands(win, baseline.lands, null, `${count}mon ${region}+${direction} lands ${baseline.lands}`);
            const hops = context.workspace.hops.join(",");
            if (hops !== baseline.hop) {
                fail(`${count}mon ${region}+${direction} hop`, `expected ${baseline.hop}, got ${hops || "none"}`);
            }
        });
    }
}

withScreens(1, () => {
    for (const [region, direction, lands] of [
        ["topLeft", "left", "left"],
        ["bottomLeft", "left", "left"],
        ["topRight", "right", "right"],
        ["bottomRight", "right", "right"],
    ]) {
        const win = makeWin(NORMAL, `1mon-${region}-${direction}`);
        seedNormal(win);
        placeAs(win, region);
        context.workspace.hops = [];
        press(direction);
        expectLands(win, lands, null, `1mon ${region}+${direction}`);
        if (context.workspace.hops.length) {
            fail(`1mon ${region}+${direction} hop`, "must not hop on one monitor");
        }
        const slot = context.describeState(win);
        if (slot.provenance !== "script" || slot.placement !== lands) {
            fail(`1mon ${region}+${direction} provenance`, `${slot.provenance}/${slot.placement}`);
        }
        if (!slot.normal || Math.abs(slot.normal.x - NORMAL.x) > 1 || Math.abs(slot.normal.width - NORMAL.width) > 1) {
            fail(`1mon ${region}+${direction} normal`, JSON.stringify(slot.normal));
        }
    }
});

if (!NEXT.left.bottomLeft || !NEXT.up.floating) {
    fail("spec", "NEXT table incomplete");
}

if (failures) {
    console.error(`${failures} permutation failure(s)`);
    process.exit(1);
}

console.log(`All permutations passed (${cells().length} region×arrow cells, ${classificationFixtures().length} classifications, ${scenarios().length} sequences).`);
