/*******************************************************************************
 * WinK — Windows-style snapping for KDE Plasma 6
 *
 * Replicates Windows 11–style Win+Arrow snap semantics
 * (https://www.elevenforum.com/t/snap-windows-into-layouts-in-windows-11.6136/
 *  and Microsoft Press Win+Arrow notes):
 *
 *   Win+Up     not snapped → maximize
 *              maximized   → top half
 *              side snap   → top corner of that side
 *              top corner  → top half, then maximize
 *   Win+Down   not snapped → minimize
 *              maximized / top half → restore
 *              side snap   → bottom corner of that side
 *   Win+Left / Win+Right
 *              snap to that half; opposite side restores;
 *              same side again moves across screens (or restores on one display)
 *   Win+Left/Right then Win+Up/Down → quadrants
 *
 * Snap state is tracked per window. Cardinal halves (left/right/top/bottom)
 * can supply the next-arrow row from geometry; quadrants cannot. Provenance
 * records whether this script applied the last snap, and is not inferred from
 * pixels. Geometry is applied directly so custom Plasma/KZones tile layouts
 * cannot hijack slotWindowQuickTile*.
 *
 * https://github.com/markrai/WinK
 ******************************************************************************/

var TOLERANCE = 32;
var SHORTCUT_PREFIX = "WinK: ";
var LOG_PREFIX = "[WinK] ";

var cycleAcrossScreens = readConfig("CycleAcrossScreens", true);
var secondUpToTopHalf = readConfig("SecondUpToTopHalf", true);

/**
 * Per-window slot. placement is the table row; provenance is why we believe it.
 * unknown/user/external may still occupy a cardinal half for one arrow.
 * normal: pre-snap frame, kept across later script snaps.
 * expected: last rectangle this script applied.
 * pendingGen: generation of a script write we have not yet observed land.
 * @type {Object.<string, {placement:string, provenance:string, normal:object|null, expected:object|null, pendingGen:number, generation:number, interactive:boolean}>}
 */
var snapState = {};
/** Counts handleDirection calls that passed the duplicate-shortcut guard. */
var appliedTransitions = 0;

function blankSlot() {
    return {
        placement: "unknown",
        provenance: "unknown",
        normal: null,
        expected: null,
        pendingGen: 0,
        generation: 0,
        interactive: false
    };
}

function nearly(a, b, tol) {
    return Math.abs(a - b) <= (tol === undefined ? TOLERANCE : tol);
}

function activeWindow() {
    return workspace.activeWindow;
}

function usableArea(win) {
    return workspace.clientArea(KWin.MaximizeArea, win);
}

function windowKey(win) {
    if (!win) {
        return "";
    }
    try {
        if (win.internalId !== undefined && win.internalId !== null) {
            return String(win.internalId);
        }
    } catch (e0) {}
    try {
        if (win.windowId !== undefined && win.windowId !== null) {
            return "w:" + String(win.windowId);
        }
    } catch (e1) {}
    // Last resort: unstable but better than nothing for the session
    return "o:" + String(win);
}

function copyFrame(win) {
    var g = win.frameGeometry;
    return { x: g.x, y: g.y, width: g.width, height: g.height };
}

function getSlot(win) {
    var key = windowKey(win);
    if (!key) {
        return null;
    }
    var slot = snapState[key];
    if (!slot || typeof slot === "string" || !slot.provenance) {
        var born = blankSlot();
        if (slot && slot.normal) {
            born.normal = slot.normal;
        }
        slot = born;
        snapState[key] = slot;
    }
    return slot;
}

function copyRect(rect) {
    if (!rect) {
        return null;
    }
    return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
}

/**
 * Record a script-owned transition before mutating geometry.
 * pendingGen lets a matching frameGeometryChanged complete the write,
 * and lets intermediate rects (clearMaximize, then the snap) be ignored.
 * A notification count alone is not the identity of the write: the rect
 * has to match expected for this generation.
 */
function commitScriptState(win, placement, expectedRect) {
    var slot = getSlot(win);
    if (!slot) {
        return;
    }
    slot.generation += 1;
    slot.pendingGen = slot.generation;
    slot.placement = placement;
    slot.provenance = "script";
    slot.expected = copyRect(expectedRect);
}

function setCachedRegion(win, region) {
    var slot = getSlot(win);
    if (!slot) {
        return;
    }
    if (!region || region === "none" || region === "floating" || region === "unknown") {
        slot.placement = "floating";
        return;
    }
    slot.placement = region;
    slot.provenance = "script";
    slot.pendingGen = 0;
    if (region === "minimized") {
        slot.expected = null;
        return;
    }
    var target = regionsFor(usableArea(win))[region];
    slot.expected = copyRect(target);
}

function clearCachedRegion(win) {
    setCachedRegion(win, "floating");
}

/**
 * Windows remembers the restored (pre-snap) rectangle and returns to it.
 * Capture it only while the window is still floating — later snaps must not
 * overwrite that memory with a half or quadrant.
 */
function rememberNormal(win) {
    var slot = getSlot(win);
    if (!slot || !win || win.minimized || isMaximizedWindow(win)) {
        return;
    }
    // Later script snaps must not overwrite the pre-snap rectangle.
    if (slot.provenance === "script") {
        return;
    }
    slot.normal = copyFrame(win);
}

function markApplied(win) {
    // commitScriptState is the record of a script write. Kept so call sites stay put.
}

function forgetSession() {
    snapState = {};
}

function describeState(win) {
    var slot = getSlot(win);
    if (!slot) {
        return null;
    }
    return {
        placement: slot.placement,
        provenance: slot.provenance,
        normal: copyRect(slot.normal),
        expected: copyRect(slot.expected),
        pendingGen: slot.pendingGen,
        generation: slot.generation,
        transitions: appliedTransitions
    };
}

/**
 * Partition work area into halves/quarters with integer edges (no gaps/overlaps).
 */
function regionsFor(area) {
    var x0 = area.x;
    var y0 = area.y;
    var x1 = area.x + area.width;
    var y1 = area.y + area.height;
    var midX = x0 + Math.floor(area.width / 2);
    var midY = y0 + Math.floor(area.height / 2);
    return {
        maximized: { x: x0, y: y0, width: area.width, height: area.height },
        left: { x: x0, y: y0, width: midX - x0, height: area.height },
        right: { x: midX, y: y0, width: x1 - midX, height: area.height },
        top: { x: x0, y: y0, width: area.width, height: midY - y0 },
        bottom: { x: x0, y: midY, width: area.width, height: y1 - midY },
        topLeft: { x: x0, y: y0, width: midX - x0, height: midY - y0 },
        topRight: { x: midX, y: y0, width: x1 - midX, height: midY - y0 },
        bottomLeft: { x: x0, y: midY, width: midX - x0, height: y1 - midY },
        bottomRight: { x: midX, y: midY, width: x1 - midX, height: y1 - midY }
    };
}

function geometryMatches(g, target, tol) {
    return nearly(g.x, target.x, tol) && nearly(g.y, target.y, tol) &&
        nearly(g.width, target.width, tol) && nearly(g.height, target.height, tol);
}

/** Tight match against a work-area half. Approximate sizes stay floating. */
var HALF_TOLERANCE = 8;

function detectCardinalHalf(win) {
    if (!win || win.deleted || win.minimized || isMaximizedWindow(win)) {
        return null;
    }
    var g = win.frameGeometry;
    var map = regionsFor(usableArea(win));
    var halves = ["left", "right", "top", "bottom"];
    for (var i = 0; i < halves.length; i++) {
        if (geometryMatches(g, map[halves[i]], HALF_TOLERANCE)) {
            return halves[i];
        }
    }
    return null;
}

function isMaximizedWindow(win) {
    if (!win) {
        return false;
    }
    try {
        if (win.maximized === true) {
            return true;
        }
    } catch (e0) {}
    // Plasma/KWin often expose separate axes (values differ by version).
    try {
        if (win.maximizeMode !== undefined) {
            // MaximizeFull typically non-zero / MaximizeVert|MaximizeHorz
            if (win.maximizeMode && win.maximizeMode !== 0) {
                return true;
            }
        }
    } catch (e1) {}
    var area = usableArea(win);
    var g = win.frameGeometry;
    return nearly(g.x, area.x) && nearly(g.y, area.y) &&
        nearly(g.width, area.width) && nearly(g.height, area.height);
}

function isScriptSnap(slot) {
    if (!slot || slot.provenance !== "script") {
        return false;
    }
    switch (slot.placement) {
    case "left":
    case "right":
    case "top":
    case "bottom":
    case "topLeft":
    case "topRight":
    case "bottomLeft":
    case "bottomRight":
        return true;
    default:
        return false;
    }
}

function expectedStillMatches(win, slot) {
    if (!slot.expected) {
        return true;
    }
    return geometryMatches(win.frameGeometry, slot.expected);
}

/**
 * Effective row for the next arrow. Separate from provenance:
 * a matching left/right/top/bottom supplies the row without becoming
 * script-owned. Quadrants require a still-valid script snap.
 */
function currentRegion(win) {
    if (!win || win.deleted) {
        return "none";
    }
    if (win.minimized) {
        return "minimized";
    }
    if (isMaximizedWindow(win)) {
        return "maximized";
    }

    var slot = getSlot(win);
    if (isScriptSnap(slot) && regionStillFits(win, slot.placement) && expectedStillMatches(win, slot)) {
        return slot.placement;
    }

    if (slot && slot.provenance === "script" && isScriptSnap(slot)) {
        // The snap we applied is no longer on screen. Drop ownership only;
        // a matching cardinal half can still supply the row below.
        slot.provenance = "external";
        slot.placement = "floating";
        slot.pendingGen = 0;
    }

    var half = detectCardinalHalf(win);
    if (half) {
        return half;
    }

    if (slot && !slot.normal && !win.minimized) {
        slot.normal = copyFrame(win);
    }
    return "floating";
}

/**
 * frameGeometryChanged. A pending script write completes only when the frame
 * matches expected. Earlier or repeated notifications do not drop ownership.
 * A later rect that is not expected ends the snap (provenance external).
 */
function noteFrameGeometryChanged(win) {
    var slot = getSlot(win);
    if (!slot || !win || win.deleted) {
        return;
    }
    var frame = copyFrame(win);
    if (slot.pendingGen) {
        if (slot.expected && geometryMatches(frame, slot.expected)) {
            slot.pendingGen = 0;
        }
        return;
    }
    if (slot.provenance === "script" && slot.expected && !geometryMatches(frame, slot.expected)) {
        slot.provenance = "external";
        slot.placement = "floating";
    }
}

function noteInteractiveStarted(win) {
    var slot = getSlot(win);
    if (slot) {
        slot.interactive = true;
    }
}

/**
 * User released a move or resize. Identical pixels to a previous snap are
 * still a user placement: the next arrow uses the floating row.
 * If this fires for our own write, the frame matches expected while that
 * generation is pending, and ownership stays script.
 */
function noteInteractiveFinished(win) {
    var slot = getSlot(win);
    if (!slot || !win) {
        return;
    }
    slot.interactive = false;
    var frame = copyFrame(win);
    if (slot.pendingGen && slot.expected && geometryMatches(frame, slot.expected)) {
        slot.pendingGen = 0;
        return;
    }
    slot.provenance = "user";
    slot.placement = "floating";
    slot.expected = null;
    slot.pendingGen = 0;
    if (!win.minimized && !isMaximizedWindow(win)) {
        slot.normal = frame;
    }
}

function regionStillFits(win, region) {
    if (!region || region === "floating" || region === "none") {
        return false;
    }
    if (region === "maximized") {
        return isMaximizedWindow(win);
    }
    if (region === "minimized") {
        return !!win.minimized;
    }
    var target = regionsFor(usableArea(win))[region];
    if (!target) {
        return false;
    }
    var g = win.frameGeometry;
    return geometryMatches(g, target);
}

/**
 * Pure transition table — Windows 11 Win+Arrow semantics.
 * direction: "up" | "down" | "left" | "right"
 */
function nextAction(region, direction) {
    var table = {
        up: {
            floating: "maximized",
            maximized: secondUpToTopHalf ? "top" : "maximized",
            left: "topLeft",
            right: "topRight",
            top: "maximized",
            bottom: "top",
            topLeft: "top",
            topRight: "top",
            bottomLeft: "left",
            bottomRight: "right",
            minimized: "floating"
        },
        down: {
            floating: "minimize",
            maximized: "restore",
            left: "bottomLeft",
            right: "bottomRight",
            top: "restore",
            bottom: "minimize",
            topLeft: "left",
            topRight: "right",
            bottomLeft: "minimize",
            bottomRight: "minimize",
            minimized: "minimized"
        },
        left: {
            floating: "left",
            maximized: "left",
            // Same-direction: Win11 cycles left → (other screen right | same-screen right) → …
            left: "cycleLeft",
            right: "restore",
            top: "topLeft",
            bottom: "bottomLeft",
            topLeft: "cycleLeft",
            topRight: "top",
            bottomLeft: "cycleLeft",
            bottomRight: "bottom",
            minimized: "left"
        },
        right: {
            floating: "right",
            maximized: "right",
            left: "restore",
            right: "cycleRight",
            top: "topRight",
            bottom: "bottomRight",
            topLeft: "top",
            topRight: "cycleRight",
            bottomLeft: "bottom",
            bottomRight: "cycleRight",
            minimized: "right"
        }
    };

    var row = table[direction];
    if (!row) {
        return null;
    }
    return row[region] || row.floating;
}

function clearMaximize(win) {
    if (!win) {
        return;
    }
    try {
        win.setMaximize(false, false);
    } catch (e) {
        // ignore — older/odd window types
    }
}

function setFrameGeometry(win, geo) {
    win.frameGeometry = {
        x: Math.round(geo.x),
        y: Math.round(geo.y),
        width: Math.round(geo.width),
        height: Math.round(geo.height)
    };
}

function applySnapRegion(win, region) {
    var area = usableArea(win);
    var map = regionsFor(area);
    var geo = map[region];
    if (!geo) {
        return;
    }
    commitScriptState(win, region, geo);
    clearMaximize(win);
    setFrameGeometry(win, geo);
}

/**
 * Connected outputs. 0 means the count could not be read — callers must not
 * treat that as a single monitor.
 */
function screenCount() {
    try {
        var screens = workspace.screens;
        if (screens && typeof screens.length === "number" && screens.length > 0) {
            return screens.length;
        }
        // KWin 6.8.2 exposes an Array of LogicalOutput; if length is missing but
        // the value is a single output object, count that as one screen.
        if (screens && screens.geometry && screens.name) {
            return 1;
        }
    } catch (e0) {}
    try {
        if (typeof workspace.numScreens === "number" && workspace.numScreens > 0) {
            return workspace.numScreens;
        }
    } catch (e1) {}
    return 0;
}

/**
 * On exactly one monitor, same-side arrow from a corner expands to that half.
 * Two or more monitors, or an unknown count, keep cycleLeft/cycleRight.
 */
function resolveSameSideCorner(region, action) {
    if (action !== "cycleLeft" && action !== "cycleRight") {
        return action;
    }
    var n = screenCount();
    if (n !== 1) {
        if (n <= 0) {
            print(LOG_PREFIX + "screen count unknown; keeping cycle for " + region);
        }
        return action;
    }
    if (action === "cycleLeft" && (region === "topLeft" || region === "bottomLeft")) {
        return "left";
    }
    if (action === "cycleRight" && (region === "topRight" || region === "bottomRight")) {
        return "right";
    }
    return action;
}

/**
 * Attempt to move the active window one screen in direction.
 * Returns true only if the window actually changed screen/position.
 */
function moveToAdjacentScreen(direction) {
    var win = activeWindow();
    if (!win) {
        return false;
    }
    var beforeX = win.frameGeometry.x;
    var beforeY = win.frameGeometry.y;
    var beforeOutput = null;
    try {
        beforeOutput = win.output;
    } catch (eOut) {}

    var moved = false;
    if (direction === "left") {
        if (typeof workspace.slotWindowToLeftScreen === "function") {
            workspace.slotWindowToLeftScreen();
            moved = true;
        } else if (typeof workspace.slotWindowToPrevScreen === "function") {
            workspace.slotWindowToPrevScreen();
            moved = true;
        }
    } else if (direction === "right") {
        if (typeof workspace.slotWindowToRightScreen === "function") {
            workspace.slotWindowToRightScreen();
            moved = true;
        } else if (typeof workspace.slotWindowToNextScreen === "function") {
            workspace.slotWindowToNextScreen();
            moved = true;
        }
    }
    if (!moved) {
        return false;
    }

    var afterOutput = null;
    try {
        afterOutput = win.output;
    } catch (eOut2) {}
    if (beforeOutput !== null && afterOutput !== null && beforeOutput !== afterOutput) {
        return true;
    }
    if (win.frameGeometry.x !== beforeX || win.frameGeometry.y !== beforeY) {
        return true;
    }
    // Slot existed but was a no-op (typical on a single display).
    return false;
}

/**
 * Win11 same-direction cycle:
 *   cycleLeft  → hop to left screen (land right half) if allowed/possible, else flip to right
 *   cycleRight → hop to right screen (land left half) if allowed/possible, else flip to left
 *
 * Always ends by applying a half-snap on the (possibly new) screen so a no-op
 * screen slot cannot leave a quadrant stuck in place.
 */
function resolveHorizontalCycle(win, action) {
    var wantLeft = action === "cycleLeft";
    if (cycleAcrossScreens && screenCount() > 1) {
        if (wantLeft) {
            moveToAdjacentScreen("left");
        } else {
            moveToAdjacentScreen("right");
        }
    }
    // Leftward cycle lands on the right half (same screen flip, or inward half
    // after a successful hop). Rightward cycle lands on the left half.
    // Always apply so a no-op screen move cannot leave a quadrant stuck.
    applySnapRegion(win, wantLeft ? "right" : "left");
    markApplied(win);
}

function applyAction(win, action) {
    if (!win || action === null) {
        return;
    }

    if (action !== "restore" && action !== "minimize" && action !== "floating") {
        rememberNormal(win);
    }

    switch (action) {
    case "maximized":
        commitScriptState(win, "maximized", regionsFor(usableArea(win)).maximized);
        clearMaximize(win);
        try {
            win.setMaximize(true, true);
        } catch (e1) {
            workspace.slotWindowMaximize();
        }
        markApplied(win);
        break;
    case "restore":
        var slot = getSlot(win);
        var restored = null;
        if (slot && slot.normal) {
            restored = slot.normal;
        } else {
            var area = usableArea(win);
            var w = Math.min(area.width * 0.6, Math.max(640, area.width * 0.45));
            var h = Math.min(area.height * 0.6, Math.max(480, area.height * 0.5));
            restored = {
                x: area.x + (area.width - w) / 2,
                y: area.y + (area.height - h) / 2,
                width: w,
                height: h
            };
            if (slot) {
                slot.normal = copyRect(restored);
            }
        }
        commitScriptState(win, "floating", restored);
        clearMaximize(win);
        setFrameGeometry(win, restored);
        markApplied(win);
        break;
    case "minimize":
        commitScriptState(win, "minimized", null);
        win.minimized = true;
        markApplied(win);
        break;
    case "floating":
        // Unminimize into a normal floating window
        win.minimized = false;
        clearMaximize(win);
        clearCachedRegion(win);
        markApplied(win);
        break;
    case "left":
    case "right":
    case "top":
    case "bottom":
    case "topLeft":
    case "topRight":
    case "bottomLeft":
    case "bottomRight":
        applySnapRegion(win, action);
        markApplied(win);
        break;
    case "cycleLeft":
    case "cycleRight":
        resolveHorizontalCycle(win, action);
        break;
    case "screenLeft":
        // Legacy alias: hop left + land right, else same-monitor flip to right.
        resolveHorizontalCycle(win, "cycleLeft");
        break;
    case "screenRight":
        resolveHorizontalCycle(win, "cycleRight");
        break;
    default:
        break;
    }
}

function isManagedAppWindow(win) {
    if (!win) {
        return false;
    }
    if (win.desktopWindow || win.dock || win.splash || win.toolbar || win.menu ||
        win.dropdownMenu || win.popupMenu || win.tooltip || win.notification ||
        win.onScreenDisplay || win.criticalNotification) {
        return false;
    }
    if (win.normalWindow === false && !win.moveable) {
        return false;
    }
    return true;
}

/** Prevent double-fire when registerShortcut is bound more than once. */
var handlingDirection = false;
var lastHandleDir = "";
var lastHandleAt = 0;

function handleDirection(direction) {
    if (handlingDirection) {
        return;
    }
    var now = 0;
    try {
        now = Date.now();
    } catch (eNow) {
        now = 0;
    }
    // A second callback for the same arrow (duplicate script bind) would
    // advance the machine twice: Right then immediately cycle off the right.
    if (now && lastHandleDir === direction && (now - lastHandleAt) < 150) {
        return;
    }
    lastHandleDir = direction;
    lastHandleAt = now;
    handlingDirection = true;
    try {
        var win = activeWindow();
        if (!isManagedAppWindow(win)) {
            return;
        }

        var region = currentRegion(win);
        var action = nextAction(region, direction);
        action = resolveSameSideCorner(region, action);
        print(LOG_PREFIX + direction + " | " + region + " → " + action +
            " | " + (getSlot(win) ? getSlot(win).provenance : "?"));
        appliedTransitions += 1;
        applyAction(win, action);
    } finally {
        handlingDirection = false;
    }
}

function noteForeignGeometry(win) {
    var slot = getSlot(win);
    if (!slot || slot.interactive || win.move || win.resize) {
        return;
    }
    if (slot.pendingGen) {
        return;
    }
    if (slot.provenance === "script" && slot.expected &&
            geometryMatches(copyFrame(win), slot.expected)) {
        return;
    }
    if (slot.provenance === "script") {
        slot.provenance = "external";
        slot.placement = "floating";
        slot.pendingGen = 0;
    }
}

function connectWin(win, signal, fn) {
    try {
        if (win[signal] && win[signal].connect) {
            win[signal].connect(function () {
                fn(win);
            });
        }
    } catch (eSig) {}
}

function trackWindow(win) {
    if (!win || !isManagedAppWindow(win)) {
        return;
    }
    connectWin(win, "interactiveMoveResizeStarted", noteInteractiveStarted);
    connectWin(win, "interactiveMoveResizeFinished", noteInteractiveFinished);
    connectWin(win, "frameGeometryChanged", noteFrameGeometryChanged);
    // Non-interactive geometry (another client, a rule). Not a user drag.
    connectWin(win, "moveResizedChanged", noteForeignGeometry);
}

try {
    var existing = workspace.windowList();
    for (var i = 0; i < existing.length; i++) {
        trackWindow(existing[i]);
    }
} catch (eList) {}
try {
    workspace.windowAdded.connect(trackWindow);
} catch (eAdd) {}
try {
    workspace.windowRemoved.connect(function (win) {
        var key = windowKey(win);
        if (key) {
            delete snapState[key];
        }
    });
} catch (eRem) {}

registerShortcut(SHORTCUT_PREFIX + "Up", SHORTCUT_PREFIX + "Up", "Meta+Up", function () {
    handleDirection("up");
});
registerShortcut(SHORTCUT_PREFIX + "Down", SHORTCUT_PREFIX + "Down", "Meta+Down", function () {
    handleDirection("down");
});
registerShortcut(SHORTCUT_PREFIX + "Left", SHORTCUT_PREFIX + "Left", "Meta+Left", function () {
    handleDirection("left");
});
registerShortcut(SHORTCUT_PREFIX + "Right", SHORTCUT_PREFIX + "Right", "Meta+Right", function () {
    handleDirection("right");
});

print(LOG_PREFIX + "loaded (cycleScreens=" + cycleAcrossScreens +
    ", secondUpToTopHalf=" + secondUpToTopHalf + ")");
