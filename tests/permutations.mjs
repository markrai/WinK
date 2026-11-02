/**
 * Windows 11 Meta+Arrow specification.
 *
 * Every region × arrow cell is mandatory. tests/state-machine.test.mjs loads
 * the real KWin script and checks each cell. tests/live-matrix.mjs drives the
 * same cells against a real window.
 *
 * A window is "in" a region only when its frame fills that rect (about 32px).
 * A smaller window parked in a corner is floating: Left/Right take the full
 * column, Up maximizes. A window that actually fills a quadrant follows the
 * quadrant cycle.
 *
 * Sources: ElevenForum snap layouts, Microsoft Press Win+Arrow notes.
 */

export const REGIONS = [
    "floating",
    "maximized",
    "minimized",
    "left",
    "right",
    "top",
    "bottom",
    "topLeft",
    "topRight",
    "bottomLeft",
    "bottomRight",
];

export const DIRECTIONS = ["up", "down", "left", "right"];

/** Reference work area used by the in-process matrix. Live tests measure the real one. */
export const AREA = { x: 0, y: 0, width: 1920, height: 1080 };

/** Pre-snap rectangle remembered for restore. Not itself a snap rect. */
export const NORMAL = { x: 120, y: 80, width: 720, height: 480 };

/**
 * Observable next state for one arrow.
 * cycleLeft/cycleRight stay the table tokens (multi-monitor hop, or flip).
 * On one monitor, corners resolve to a same-side half instead of cycling.
 */
export const NEXT = {
    up: {
        floating: "maximized",
        maximized: "top",
        left: "topLeft",
        right: "topRight",
        top: "maximized",
        bottom: "top",
        topLeft: "top",
        topRight: "top",
        bottomLeft: "left",
        bottomRight: "right",
        minimized: "floating",
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
        minimized: "minimized",
    },
    left: {
        floating: "left",
        maximized: "left",
        left: "cycleLeft",
        right: "restore",
        top: "topLeft",
        bottom: "bottomLeft",
        topLeft: "cycleLeft",
        topRight: "top",
        bottomLeft: "cycleLeft",
        bottomRight: "bottom",
        minimized: "left",
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
        minimized: "right",
    },
};

export function buildRegions(area = AREA) {
    const x0 = area.x;
    const y0 = area.y;
    const x1 = area.x + area.width;
    const y1 = area.y + area.height;
    const midX = x0 + Math.floor(area.width / 2);
    const midY = y0 + Math.floor(area.height / 2);
    return {
        maximized: { x: x0, y: y0, width: area.width, height: area.height },
        left: { x: x0, y: y0, width: midX - x0, height: area.height },
        right: { x: midX, y: y0, width: x1 - midX, height: area.height },
        top: { x: x0, y: y0, width: area.width, height: midY - y0 },
        bottom: { x: x0, y: midY, width: area.width, height: y1 - midY },
        topLeft: { x: x0, y: y0, width: midX - x0, height: midY - y0 },
        topRight: { x: midX, y: y0, width: x1 - midX, height: midY - y0 },
        bottomLeft: { x: x0, y: midY, width: midX - x0, height: y1 - midY },
        bottomRight: { x: midX, y: midY, width: x1 - midX, height: y1 - midY },
    };
}

/** One-monitor landing region for a cycle token. */
export function cycleLands(action) {
    if (action === "cycleLeft") {
        return "right";
    }
    if (action === "cycleRight") {
        return "left";
    }
    return action;
}

/**
 * Baseline cross-screen landing for cycleLeft/cycleRight (unchanged):
 * hop toward that side, then snap to the inward half.
 */
export function cycleAcrossLanding(action) {
    if (action === "cycleLeft") {
        return { hop: "left", lands: "right" };
    }
    if (action === "cycleRight") {
        return { hop: "right", lands: "left" };
    }
    return { hop: null, lands: action };
}

/** Exactly one monitor: corner + same-side arrow expands to that half. */
export function resolveSameSideCorner(region, action, screens) {
    if (screens !== 1) {
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

export function cells(screens = 1) {
    const out = [];
    for (const direction of DIRECTIONS) {
        for (const region of REGIONS) {
            const action = NEXT[direction][region];
            if (!action) {
                throw new Error(`missing permutation: ${region} + ${direction}`);
            }
            const resolved = resolveSameSideCorner(region, action, screens);
            out.push({
                id: `${region}+${direction}`,
                region,
                direction,
                action,
                resolved,
                lands: cycleLands(resolved),
            });
        }
    }
    return out;
}

/**
 * How a frame is classified before any arrow.
 * Cardinal halves are the effective row even without script ownership.
 * Quadrants stay floating unless seedCache records a script snap.
 */
export function classificationFixtures(area = AREA) {
    const map = buildRegions(area);
    const parked = {
        bottomLeft: { x: area.x, y: area.y + Math.floor(area.height / 2) + 40, width: 640, height: 420 },
        topRight: {
            x: area.x + area.width - 800,
            y: area.y + 36,
            width: 760,
            height: 460,
        },
        topLeft: { x: area.x + 24, y: area.y + 28, width: 700, height: 400 },
        bottomRight: {
            x: area.x + Math.floor(area.width / 2) + 80,
            y: area.y + Math.floor(area.height / 2) + 30,
            width: 680,
            height: 400,
        },
    };
    const almost = {
        // About half the screen, sitting in the corner, but not filling the quadrant.
        bottomLeft: {
            x: area.x,
            y: area.y + Math.floor(area.height / 2) + 20,
            width: Math.floor(area.width * 0.47),
            height: Math.floor(area.height * 0.46),
        },
        topRight: {
            x: area.x + area.width - Math.floor(area.width * 0.47),
            y: area.y,
            width: Math.floor(area.width * 0.47),
            height: Math.floor(area.height * 0.46),
        },
    };
    return [
        { id: "class:floating-normal", geo: { ...NORMAL }, expect: "floating" },
        { id: "class:parked-bottom-left", geo: parked.bottomLeft, expect: "floating" },
        { id: "class:parked-top-right", geo: parked.topRight, expect: "floating" },
        { id: "class:parked-top-left", geo: parked.topLeft, expect: "floating" },
        { id: "class:parked-bottom-right", geo: parked.bottomRight, expect: "floating" },
        { id: "class:almost-quadrant-bottom-left", geo: almost.bottomLeft, expect: "floating" },
        { id: "class:almost-quadrant-top-right", geo: almost.topRight, expect: "floating" },
        { id: "class:filled-top-right-still-windowed", geo: { ...map.topRight }, expect: "floating" },
        { id: "class:filled-bottom-left-still-windowed", geo: { ...map.bottomLeft }, expect: "floating" },
        { id: "class:filled-left-column", geo: { ...map.left }, expect: "left" },
        { id: "class:filled-right-column", geo: { ...map.right }, expect: "right" },
        { id: "class:filled-top-row", geo: { ...map.top }, expect: "top" },
        { id: "class:filled-bottom-row", geo: { ...map.bottom }, expect: "bottom" },
        { id: "class:snapped-topRight", geo: { ...map.topRight }, expect: "topRight", seedCache: "topRight" },
        { id: "class:snapped-left", geo: { ...map.left }, expect: "left", seedCache: "left" },
        { id: "class:maximized", geo: { ...map.maximized }, expect: "maximized", maximized: true },
    ];
}

/**
 * Named sequences, including the ones that failed in manual testing.
 * geo is a rect or a region name (filled exactly).
 */
export function scenarios(area = AREA) {
    const map = buildRegions(area);
    const parkedBL = classificationFixtures(area).find((f) => f.id === "class:parked-bottom-left").geo;
    const parkedTR = classificationFixtures(area).find((f) => f.id === "class:parked-top-right").geo;
    const almostBL = classificationFixtures(area).find((f) => f.id === "class:almost-quadrant-bottom-left").geo;
    const almostTR = classificationFixtures(area).find((f) => f.id === "class:almost-quadrant-top-right").geo;
    return [
        {
            id: "windowed bottom-left + Left → left column",
            geo: parkedBL,
            steps: [{ direction: "left", lands: "left" }],
        },
        {
            id: "windowed top-right + Right → right column",
            geo: parkedTR,
            steps: [{ direction: "right", lands: "right" }],
        },
        {
            id: "windowed top-right + Up → maximize",
            geo: parkedTR,
            steps: [{ direction: "up", lands: "maximized" }],
        },
        {
            id: "almost-quadrant bottom-left + Left → left column",
            geo: almostBL,
            steps: [{ direction: "left", lands: "left" }],
        },
        {
            id: "almost-quadrant top-right + Right → right column",
            geo: almostTR,
            steps: [{ direction: "right", lands: "right" }],
        },
        {
            id: "almost-quadrant top-right + Up → maximize",
            geo: almostTR,
            steps: [{ direction: "up", lands: "maximized" }],
        },
        {
            id: "window filling bottom-left + Left → left column",
            geo: { ...map.bottomLeft },
            steps: [{ direction: "left", lands: "left" }],
        },
        {
            id: "window filling top-right + Up → maximize",
            geo: { ...map.topRight },
            steps: [{ direction: "up", lands: "maximized" }],
        },
        {
            id: "right column + Up → top-right quadrant",
            geo: { ...map.right },
            steps: [{ direction: "up", lands: "topRight" }],
        },
        {
            id: "right column + Down → bottom-right quadrant",
            geo: { ...map.right },
            steps: [{ direction: "down", lands: "bottomRight" }],
        },
        {
            id: "left column + Up → top-left quadrant",
            geo: { ...map.left },
            steps: [{ direction: "up", lands: "topLeft" }],
        },
        {
            id: "left column + Down → bottom-left quadrant",
            geo: { ...map.left },
            steps: [{ direction: "down", lands: "bottomLeft" }],
        },
        {
            id: "top half + Left → top-left quadrant",
            geo: { ...map.top },
            steps: [{ direction: "left", lands: "topLeft" }],
        },
        {
            id: "top half + Right → top-right quadrant",
            geo: { ...map.top },
            steps: [{ direction: "right", lands: "topRight" }],
        },
        {
            id: "bottom half + Left → bottom-left quadrant",
            geo: { ...map.bottom },
            steps: [{ direction: "left", lands: "bottomLeft" }],
        },
        {
            id: "bottom half + Right → bottom-right quadrant",
            geo: { ...map.bottom },
            steps: [{ direction: "right", lands: "bottomRight" }],
        },
        {
            id: "window filling top-right + Right → right column",
            geo: { ...map.topRight },
            steps: [{ direction: "right", lands: "right" }],
        },
        {
            id: "script top-right + Up expands to top half",
            geo: { ...map.topRight },
            seedCache: "topRight",
            steps: [{ direction: "up", lands: "top" }],
        },
        {
            id: "script top-left + Up expands to top half",
            geo: { ...map.topLeft },
            seedCache: "topLeft",
            steps: [{ direction: "up", lands: "top" }],
        },
        {
            id: "script top-right + Up + Up maximizes",
            geo: { ...map.topRight },
            seedCache: "topRight",
            steps: [
                { direction: "up", lands: "top" },
                { direction: "up", lands: "maximized" },
            ],
        },
        {
            id: "script top-left + Up + Up maximizes",
            geo: { ...map.topLeft },
            seedCache: "topLeft",
            steps: [
                { direction: "up", lands: "top" },
                { direction: "up", lands: "maximized" },
            ],
        },
        {
            id: "stale bottomLeft cache + small window + Left → left column",
            geo: parkedBL,
            seedCache: "bottomLeft",
            steps: [{ direction: "left", lands: "left" }],
        },
        {
            id: "stale topRight cache + small window + Up → maximize",
            geo: parkedTR,
            seedCache: "topRight",
            steps: [{ direction: "up", lands: "maximized" }],
        },
        {
            id: "stale right cache + small top-right + Right → right column",
            geo: parkedTR,
            seedCache: "right",
            steps: [{ direction: "right", lands: "right" }],
        },
        {
            id: "Left Left Left restores the original rect",
            geo: { ...NORMAL },
            steps: [
                { direction: "left", lands: "left" },
                { direction: "left", lands: "right" },
                { direction: "left", lands: "floating", geo: { ...NORMAL } },
            ],
        },
        {
            id: "Right Right Right restores the original rect",
            geo: { ...NORMAL },
            steps: [
                { direction: "right", lands: "right" },
                { direction: "right", lands: "left" },
                { direction: "right", lands: "floating", geo: { ...NORMAL } },
            ],
        },
        {
            id: "script top-left + Left expands to left half",
            geo: { ...map.topLeft },
            seedCache: "topLeft",
            steps: [{ direction: "left", lands: "left" }],
        },
        {
            id: "script bottom-left + Left expands to left half",
            geo: { ...map.bottomLeft },
            seedCache: "bottomLeft",
            steps: [{ direction: "left", lands: "left" }],
        },
        {
            id: "script top-right + Right expands to right half",
            geo: { ...map.topRight },
            seedCache: "topRight",
            steps: [{ direction: "right", lands: "right" }],
        },
        {
            id: "script bottom-right + Right expands to right half",
            geo: { ...map.bottomRight },
            seedCache: "bottomRight",
            steps: [{ direction: "right", lands: "right" }],
        },
        {
            id: "Left Up Down Left expands from the bottom-left quadrant",
            geo: { ...NORMAL },
            steps: [
                { direction: "left", lands: "left" },
                { direction: "up", lands: "topLeft" },
                { direction: "down", lands: "left" },
                { direction: "down", lands: "bottomLeft" },
                { direction: "left", lands: "left" },
            ],
        },
        {
            id: "Up Up is maximize then top half; Down restores",
            geo: { ...NORMAL },
            steps: [
                { direction: "up", lands: "maximized" },
                { direction: "up", lands: "top" },
                { direction: "down", lands: "floating", geo: { ...NORMAL } },
            ],
        },
    ];
}
