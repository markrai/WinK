/**
 * Provenance versus effective placement.
 *
 * Cardinal halves (left/right/top/bottom) supply the arrow row from geometry.
 * That does not invent script ownership. Quadrants stay floating unless this
 * script snapped them. A later successful arrow becomes script-owned.
 */
import fs from "node:fs";
import vm from "node:vm";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { AREA, NORMAL, buildRegions } from "./permutations.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const scriptPath = path.join(root, "wink/contents/code/main.js");
const map = buildRegions(AREA);

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
        slotWindowToLeftScreen() {},
        slotWindowToRightScreen() {},
    },
};
vm.createContext(context);
vm.runInContext(fs.readFileSync(scriptPath, "utf8"), context, { filename: scriptPath });

let failures = 0;
function fail(label, detail) {
    failures += 1;
    console.error(`FAIL ${label}: ${detail}`);
}
function eqRect(a, b) {
    return a && b && ["x", "y", "width", "height"].every((k) => Math.abs(a[k] - b[k]) <= 1);
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

function press(direction) {
    context.lastHandleAt = 0;
    context.handleDirection(direction);
}

function state(win) {
    return context.describeState(win);
}

const HALF_TRANSITIONS = [
    { half: "top", direction: "left", lands: "topLeft" },
    { half: "top", direction: "right", lands: "topRight" },
    { half: "bottom", direction: "left", lands: "bottomLeft" },
    { half: "bottom", direction: "right", lands: "bottomRight" },
    { half: "left", direction: "up", lands: "topLeft" },
    { half: "left", direction: "down", lands: "bottomLeft" },
    { half: "right", direction: "up", lands: "topRight" },
    { half: "right", direction: "down", lands: "bottomRight" },
];

function assertHalf(win, half, direction, lands, label) {
    if (context.currentRegion(win) !== half) {
        fail(`${label} row`, `effective ${context.currentRegion(win)}, wanted ${half}`);
    }
    const before = state(win);
    press(direction);
    const after = state(win);
    if (!eqRect(win.frameGeometry, map[lands])) {
        fail(`${label} geometry`, JSON.stringify(win.frameGeometry));
    }
    if (after.provenance !== "script" || after.placement !== lands) {
        fail(`${label} after`, `${after.provenance}/${after.placement}`);
    }
    if (before.provenance === "unknown" && after.provenance !== "script") {
        fail(`${label} ownership`, "result should become script-owned");
    }
}

// Eight half-to-quadrant transitions from unknown (externally placed) geometry.
for (const t of HALF_TRANSITIONS) {
    const win = makeWin(map[t.half], `ext-${t.half}-${t.direction}`);
    if (state(win).provenance !== "unknown") {
        fail(`ext ${t.half} start`, state(win).provenance);
    }
    assertHalf(win, t.half, t.direction, t.lands, `external ${t.half}+${t.direction}`);
}

// The same eight after a script placed the half.
for (const t of HALF_TRANSITIONS) {
    const win = makeWin(NORMAL, `script-${t.half}-${t.direction}`);
    if (t.half === "left") {
        press("left");
    } else if (t.half === "right") {
        press("right");
    } else if (t.half === "top") {
        press("up");
        press("up");
    } else {
        press("left");
        press("down");
        press("right");
    }
    if (state(win).provenance !== "script") {
        fail(`script ${t.half} start`, state(win).provenance);
    }
    assertHalf(win, t.half, t.direction, t.lands, `script ${t.half}+${t.direction}`);
}

// After reload, a matching half is still the effective row, provenance unknown.
{
    const win = makeWin(map.right, "reload-right");
    context.forgetSession();
    const slot = state(win);
    if (slot.provenance !== "unknown") {
        fail("reload half provenance", slot.provenance);
    }
    if (context.currentRegion(win) !== "right") {
        fail("reload half row", context.currentRegion(win));
    }
    press("up");
    if (!eqRect(win.frameGeometry, map.topRight) || state(win).provenance !== "script") {
        fail("reload right + Up", `${state(win).provenance} ${JSON.stringify(win.frameGeometry)}`);
    }
}

// Identical geometry, two histories: quadrant.
{
    const manual = makeWin(map.topRight, "manual-tr");
    if (state(manual).provenance !== "unknown") {
        fail("manual start", `provenance ${state(manual).provenance}`);
    }
    if (context.currentRegion(manual) !== "floating") {
        fail("manual top-right row", context.currentRegion(manual));
    }
    press("up");
    if (!manual.maximized) {
        fail("manual top-right + Up", "expected maximize");
    }
}

{
    const snapped = makeWin(NORMAL, "script-tr");
    press("right");
    press("up");
    const atCorner = state(snapped);
    if (atCorner.provenance !== "script" || atCorner.placement !== "topRight") {
        fail("script path to top-right", `${atCorner.provenance}/${atCorner.placement}`);
    }
    if (!eqRect(atCorner.normal, NORMAL)) {
        fail("normal preserved through snaps", JSON.stringify(atCorner.normal));
    }
    press("up");
    if (!eqRect(snapped.frameGeometry, map.top) || state(snapped).placement !== "top") {
        fail("script top-right + Up → top", JSON.stringify(snapped.frameGeometry));
    }
    press("up");
    if (!snapped.maximized) {
        fail("script top-right + Up + Up", "expected maximize");
    }
}

{
    const win = makeWin(NORMAL, "script-tl-up2");
    press("left");
    press("up");
    if (state(win).placement !== "topLeft") {
        fail("reach topLeft", state(win).placement);
    }
    press("up");
    if (state(win).placement !== "top" || !eqRect(win.frameGeometry, map.top)) {
        fail("script top-left + Up → top", `${state(win).placement} ${JSON.stringify(win.frameGeometry)}`);
    }
    press("up");
    if (!win.maximized) {
        fail("script top-left + Up + Up", "expected maximize");
    }
}

// Ordinary floating window maximizes.
{
    const win = makeWin(NORMAL, "float-up");
    if (context.currentRegion(win) !== "floating") {
        fail("floating row", context.currentRegion(win));
    }
    press("up");
    if (!win.maximized) {
        fail("floating + Up", "expected maximize");
    }
}

// Unknown quadrant is not a half; Left takes the full left column.
{
    const quad = makeWin(map.bottomLeft, "unknown-quad");
    if (context.currentRegion(quad) !== "floating") {
        fail("unknown quadrant row", context.currentRegion(quad));
    }
    press("left");
    if (state(quad).placement !== "left" || state(quad).provenance !== "script") {
        fail("unknown quadrant + Left", `${state(quad).provenance}/${state(quad).placement}`);
    }
}

// Restore cycle keeps the original rectangle.
{
    const win = makeWin(NORMAL, "restore-cycle");
    press("left");
    press("left");
    press("left");
    if (!eqRect(win.frameGeometry, NORMAL)) {
        fail("Left Left Left restore", JSON.stringify(win.frameGeometry));
    }
    if (!eqRect(state(win).normal, NORMAL)) {
        fail("restore kept original normal", JSON.stringify(state(win).normal));
    }
}

// Drag of a quadrant drops script ownership; same pixels then maximize.
// A drag that leaves a cardinal half still folds (effective row, not script history).
{
    const win = makeWin(NORMAL, "drag");
    press("right");
    context.noteFrameGeometryChanged(win);
    press("up");
    context.noteFrameGeometryChanged(win);
    context.noteInteractiveFinished(win);
    const slot = state(win);
    if (slot.provenance !== "user" || slot.placement !== "floating") {
        fail("drag invalidates", `${slot.provenance}/${slot.placement}`);
    }
    press("up");
    if (!win.maximized) {
        fail("after drag + Up", "still treated as a corner snap");
    }
}

// Our own write, including a matching finish signal, stays script-owned.
{
    const win = makeWin(NORMAL, "self-notify");
    press("left");
    context.noteInteractiveFinished(win);
    context.noteFrameGeometryChanged(win);
    context.noteFrameGeometryChanged(win);
    const slot = state(win);
    if (slot.provenance !== "script" || slot.placement !== "left") {
        fail("script write kept", `${slot.provenance}/${slot.placement} pending ${slot.pendingGen}`);
    }
}

// Foreign geometry ends script ownership. A remaining cardinal half still folds.
{
    const win = makeWin(NORMAL, "foreign-half");
    press("left");
    context.noteFrameGeometryChanged(win);
    win.frameGeometry = { ...map.right };
    context.noteFrameGeometryChanged(win);
    if (state(win).provenance !== "external") {
        fail("foreign half provenance", state(win).provenance);
    }
    if (context.currentRegion(win) !== "right") {
        fail("foreign half row", context.currentRegion(win));
    }
    press("up");
    if (!eqRect(win.frameGeometry, map.topRight)) {
        fail("foreign half + Up", JSON.stringify(win.frameGeometry));
    }
}

{
    const win = makeWin(NORMAL, "foreign-float");
    press("left");
    context.noteFrameGeometryChanged(win);
    win.frameGeometry = { x: 30, y: 40, width: 500, height: 320 };
    context.noteFrameGeometryChanged(win);
    if (state(win).provenance !== "external") {
        fail("foreign float provenance", state(win).provenance);
    }
    if (!eqRect(state(win).normal, NORMAL)) {
        fail("foreign float kept normal", JSON.stringify(state(win).normal));
    }
    press("up");
    if (!win.maximized) {
        fail("external float + Up", "did not maximize");
    }
}

// Interrupted write: pending, frame never arrives, next read drops the stale row.
{
    const win = makeWin(NORMAL, "interrupted");
    press("left");
    win.frameGeometry = { x: 12, y: 12, width: 400, height: 300 };
    context.noteFrameGeometryChanged(win);
    if (state(win).provenance !== "script") {
        fail("interrupted still pending", state(win).provenance);
    }
    if (context.currentRegion(win) !== "floating" || state(win).provenance !== "external") {
        fail("interrupted reconcile", `${state(win).provenance} row ${context.currentRegion(win)}`);
    }
}

// Reload of a quadrant does not reconstruct a corner snap.
{
    const win = makeWin(map.topRight, "reload-quad");
    press("right");
    press("up");
    context.forgetSession();
    if (state(win).provenance !== "unknown") {
        fail("after reload quadrant", state(win).provenance);
    }
    press("up");
    if (!win.maximized) {
        fail("reload quadrant + Up", "reconstructed a corner snap");
    }
}

// One shortcut invocation, one transition.
{
    const win = makeWin(map.bottomLeft, "once");
    context.setCachedRegion(win, "bottomLeft");
    const before = state(win).transitions;
    context.lastHandleAt = 0;
    context.handleDirection("left");
    context.handleDirection("left");
    const delta = state(win).transitions - before;
    if (delta !== 1) {
        fail("single invocation", `transitions ${delta}`);
    }
    if (!eqRect(win.frameGeometry, map.left)) {
        fail("single invocation geometry", JSON.stringify(win.frameGeometry));
    }
}

// One monitor: recognized corners expand on the same-side arrow.
for (const [region, direction, lands] of [
    ["topLeft", "left", "left"],
    ["bottomLeft", "left", "left"],
    ["topRight", "right", "right"],
    ["bottomRight", "right", "right"],
]) {
    const win = makeWin(NORMAL, `expand-${region}`);
    context.currentRegion(win);
    context.setCachedRegion(win, region);
    win.frameGeometry = { ...map[region] };
    const beforeNormal = state(win).normal;
    press(direction);
    if (!eqRect(win.frameGeometry, map[lands])) {
        fail(`expand ${region}+${direction}`, JSON.stringify(win.frameGeometry));
    }
    if (state(win).provenance !== "script" || state(win).placement !== lands) {
        fail(`expand ${region} provenance`, `${state(win).provenance}/${state(win).placement}`);
    }
    if (beforeNormal && !eqRect(state(win).normal, beforeNormal)) {
        fail(`expand ${region} normal`, JSON.stringify(state(win).normal));
    }
}

// Unknown screen count keeps the cycle (opposite half), no expansion.
{
    const previous = context.workspace.screens;
    context.workspace.screens = { length: 0 };
    const win = makeWin(map.topLeft, "unknown-screens");
    context.setCachedRegion(win, "topLeft");
    press("left");
    if (!eqRect(win.frameGeometry, map.right)) {
        fail("unknown screens keep cycle", JSON.stringify(win.frameGeometry));
    }
    context.workspace.screens = previous;
}

if (failures) {
    console.error(`${failures} provenance failure(s)`);
    process.exit(1);
}
console.log("Provenance tests passed.");
