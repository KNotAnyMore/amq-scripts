// ==UserScript==
// @name         AMQ Nexus Path Optimizer
// @namespace    http://tampermonkey.net/
// @version      1.0
// @description  Calculates Min/Max paths, highlights next fight, tracks player location.
// @author       KNotAnyMore
// @match        https://animemusicquiz.com/*
// @grant        none
// @require      https://github.com/joske2865/AMQ-Scripts/raw/master/common/amqWindows.js
// @downloadURL  https://github.com/KNotAnyMore/amq-scripts/raw/main/amqNexusPathOptimizer.user.js
// @updateURL    https://github.com/KNotAnyMore/amq-scripts/raw/main/amqNexusPathOptimizer.user.js
// ==/UserScript==

/* global Listener, AMQWindow, $, socket */

let globalTileLookup = {};
let currentPos = { row: 0, col: 2 };
let optimizerWindow;
let hasAutoOpened = false;

// 1. Wait for AMQ, AMQWindow, and the Socket to fully load
let setupInterval = setInterval(() => {
    if (typeof Listener !== "undefined" && typeof AMQWindow !== "undefined" && typeof socket !== "undefined") {
        clearInterval(setupInterval);
        initOptimizer();
    }
}, 500);

function initOptimizer() {
    setupNativeWindow();
    setupHotkey();
    setupNexusMonitor();
    interceptOutgoingMoves(); // New hook for perfect position tracking

    // Handler for Full Map Data (Initial Load or Rejoin)
    const handleMapData = (payload) => {
        const tiles = payload.tiles || (payload.data ? payload.data.tiles : null);
        if (tiles) {
            globalTileLookup = buildTileLookup(tiles);

            // Set current position based on saved history
            if (payload.data && payload.data.tileOrder && payload.data.tileOrder.length > 0) {
                const lastMove = payload.data.tileOrder[payload.data.tileOrder.length - 1];
                currentPos = { row: lastMove.row, col: lastMove.col };
            } else {
                const startTile = tiles.find(t => Object.keys(t.incomingDirections).length === 0);
                if (startTile) {
                    currentPos = { row: startTile.row, col: startTile.col };
                }
            }
            updateUI();

            if (!hasAutoOpened) {
                optimizerWindow.open();
                hasAutoOpened = true;
            }
        }
    };

    new Listener("nexus map init", handleMapData).bindListener();
    new Listener("nexus map state", handleMapData).bindListener();
}

// 2. Intercept Outgoing Tile Clicks
function interceptOutgoingMoves() {
    // By wrapping the socket's sendCommand, we can catch the exact moment you click a tile
    const originalSendCommand = socket.sendCommand;
    socket.sendCommand = function (payload) {
        if (payload.type === "nexus" && payload.command === "map select tile") {
            if (payload.data && payload.data.row !== undefined) {
                currentPos = { row: payload.data.row, col: payload.data.col };
                // Small delay to let the UI animations catch up
                setTimeout(updateUI, 100);
            }
        }
        originalSendCommand.apply(this, arguments);
    };
}

// 3. Build the AMQ Native Window
function setupNativeWindow() {
    optimizerWindow = new AMQWindow({
        id: "nexusOptimizerWindow",
        title: "Nexus Path Optimizer",
        width: 400,
        height: 380,
        minWidth: 320,
        minHeight: 200,
        zIndex: 1050,
        resizable: true,
        draggable: true
    });

    optimizerWindow.addPanel({
        id: "nexusOptimizerPanel",
        width: 1.0,
        height: "100%",
        scrollable: { x: false, y: true }
    });

    optimizerWindow.panels[0].panel.append(`
        <div id="nexus-opt-content" style="padding: 10px; font-size: 14px;">
            Waiting for Nexus map data...
        </div>
    `);

    optimizerWindow.window.find(".close").off("click").on("click", () => {
        optimizerWindow.close();
    });
}

// 4. Setup Hotkeys & Monitors (Combat Aware)
function setupHotkey() {
    document.addEventListener("keydown", (event) => {
        const hasMapData = Object.keys(globalTileLookup).length > 0;
        if (!hasMapData) return;

        const inFight = $("#qpAnswerInput").is(":visible");
        const isNexusMapVisible = $("#nexusMapIconOverlay").is(":visible");

        if (inFight || !isNexusMapVisible) return;

        // Tab Key
        if (event.key === "Tab" && !event.altKey && !event.ctrlKey && !event.shiftKey && !event.metaKey) {
            event.preventDefault();
            optimizerWindow.isVisible() ? optimizerWindow.close() : optimizerWindow.open();
        }

        // Alt + N Key
        if (event.altKey && event.key.toLowerCase() === "n") {
            event.preventDefault();
            optimizerWindow.isVisible() ? optimizerWindow.close() : optimizerWindow.open();
        }
    });
}

function setupNexusMonitor() {
    setInterval(() => {
        const isNexusMapVisible = $("#nexusMapIconOverlay").is(":visible");
        const inFight = $("#qpAnswerInput").is(":visible");

        if (!isNexusMapVisible || inFight) {
            if (optimizerWindow && optimizerWindow.isVisible()) {
                optimizerWindow.close();
            }
        }
    }, 500);
}

// 5. Data Processing & Math
function buildTileLookup(tiles) {
    const lookup = {};
    tiles.forEach(tile => {
        if (!lookup[tile.row]) lookup[tile.row] = {};
        lookup[tile.row][tile.col] = tile;
    });
    return lookup;
}

function updateUI() {
    const content = $("#nexus-opt-content");
    if (!content.length || Object.keys(globalTileLookup).length === 0) return;

    const currentTile = globalTileLookup[currentPos.row]?.[currentPos.col];
    if (!currentTile) {
        content.html(`<span style="color: #ff4444;">Error: Current position not found on map.</span>`);
        return;
    }

    if (currentTile.typeId === 2) {
        content.html(`<div style="color: #00ff00; font-weight: bold; text-align: center; font-size: 16px; margin-top: 20px;">👑 Boss Tile Reached!</div>`);
        return;
    }

    // Evaluate paths starting from your CURRENT tile
    const branches = [
        { name: "⬅️ Left Path", r: currentPos.row + 1, c: currentPos.col - 1, active: currentTile.connectionDirections.left },
        { name: "⬆️ Middle Path", r: currentPos.row + 1, c: currentPos.col, active: currentTile.connectionDirections.up },
        { name: "➡️ Right Path", r: currentPos.row + 1, c: currentPos.col + 1, active: currentTile.connectionDirections.right }
    ];

    const memo = {};

    function getPathsToBoss(row, col) {
        const key = `${row},${col}`;
        if (memo[key]) return memo[key];

        const tile = globalTileLookup[row]?.[col];
        if (!tile) return null;

        const isFight = tile.typeId === 3;
        const currentWeight = isFight ? 1 : 0;

        const currentFightData = isFight ? [{ genre: tile.genre ? tile.genre : "standard", floor: row }] : [];

        if (tile.typeId === 2) {
            const baseData = { fights: currentWeight, path: currentFightData };
            return { min: baseData, max: baseData };
        }

        let possibleRoutes = [];
        if (tile.connectionDirections.up) {
            let res = getPathsToBoss(row + 1, col);
            if (res) possibleRoutes.push(res);
        }
        if (tile.connectionDirections.left) {
            let res = getPathsToBoss(row + 1, col - 1);
            if (res) possibleRoutes.push(res);
        }
        if (tile.connectionDirections.right) {
            let res = getPathsToBoss(row + 1, col + 1);
            if (res) possibleRoutes.push(res);
        }

        if (possibleRoutes.length === 0) {
            const baseData = { fights: currentWeight, path: currentFightData };
            return { min: baseData, max: baseData };
        }

        const bestMinRoute = possibleRoutes.reduce((prev, curr) => (prev.min.fights < curr.min.fights) ? prev : curr).min;
        const bestMaxRoute = possibleRoutes.reduce((prev, curr) => (prev.max.fights > curr.max.fights) ? prev : curr).max;

        memo[key] = {
            min: { fights: currentWeight + bestMinRoute.fights, path: currentFightData.concat(bestMinRoute.path) },
            max: { fights: currentWeight + bestMaxRoute.fights, path: currentFightData.concat(bestMaxRoute.path) }
        };
        return memo[key];
    }

    let activeBranchData = [];
    let absoluteMinFights = Infinity;

    branches.forEach(branch => {
        if (branch.active) {
            const result = getPathsToBoss(branch.r, branch.c);
            if (result) {
                activeBranchData.push({ branch, result });
                if (result.min.fights < absoluteMinFights) {
                    absoluteMinFights = result.min.fights;
                }
            }
        }
    });

    let htmlOutput = `<div style="margin-bottom: 12px; color: #aaa; border-bottom: 1px solid #444; padding-bottom: 6px;">Current Location: Floor ${currentPos.row}</div>`;

    if (activeBranchData.length === 0) {
        content.html(htmlOutput + `<div style="color: #aaa; text-align: center; margin-top: 20px;">End of the line.</div>`);
        return;
    }

    // Function to add a glowing highlight to the FIRST genre in the path array
    const highlightFirstGenre = (pathArray) => {
        if (!pathArray || pathArray.length === 0) return "None";
        return pathArray.map((f, index) => {
            if (index === 0) {
                return `<span style="color: #ffffff; text-shadow: 0 0 6px #ffffff, 0 0 10px rgba(255,255,255,0.8); font-weight: bold; background: rgba(255,255,255,0.15); padding: 0 4px; border-radius: 3px;">${f.genre}</span>`;
            }
            return f.genre;
        }).join(" ➔ ");
    };

    activeBranchData.forEach(data => {
        const { branch, result } = data;
        const isOptimal = result.min.fights === absoluteMinFights;

        const containerStyle = isOptimal
            ? `background: rgba(0, 40, 0, 0.8); padding: 10px; border-radius: 6px; margin-bottom: 10px; border: 1px solid #00ff00; box-shadow: 0 0 12px rgba(0, 255, 0, 0.25); opacity: 1; transition: all 0.3s ease;`
            : `background: rgba(0, 0, 0, 0.3); padding: 10px; border-radius: 6px; margin-bottom: 10px; border: 1px solid #444; opacity: 0.45; filter: grayscale(40%); transition: all 0.3s ease;`;

        const titleStyle = isOptimal
            ? `color: #fff; font-size: 16px; font-weight: bold; text-shadow: 0 0 5px rgba(0,255,0,0.5);`
            : `color: #aaa; font-size: 15px; font-weight: bold;`;

        const nextFight = result.min.path.length > 0 ? result.min.path[0] : null;
        const minGenreString = highlightFirstGenre(result.min.path);
        const maxGenreString = highlightFirstGenre(result.max.path);

        htmlOutput += `
            <div style="${containerStyle}">
                <div style="display: flex; justify-content: space-between; align-items: center;">
                    <strong style="${titleStyle}">${branch.name}</strong>
                    ${isOptimal ? `<span style="background: #00ff00; color: #000; font-size: 10px; font-weight: bold; padding: 2px 6px; border-radius: 10px; text-transform: uppercase;">Best Route</span>` : ''}
                </div>

                <div style="margin-top: 8px; display: grid; grid-template-columns: 80px 1fr; gap: 6px; align-items: start;">
                    <span style="color: #00ff00; font-weight: bold;">🟢 Min: ${result.min.fights}</span>
                    <span style="color: #bbb; font-size: 12px; line-height: 1.4;">${minGenreString}</span>

                    <span style="color: #ff4444; font-weight: bold;">🔴 Max: ${result.max.fights}</span>
                    <span style="color: #bbb; font-size: 12px; line-height: 1.4;">${maxGenreString}</span>
                </div>

                ${nextFight ? `
                <div style="margin-top: 8px; border-top: 1px dashed ${isOptimal ? '#00cc00' : '#555'}; padding-top: 6px; font-size: 13px; color: ${isOptimal ? '#55ff55' : '#888'};">
                    ⚔️ <b>Next Fight:</b> Floor ${nextFight.floor} <span style="opacity: 0.8;">(${nextFight.genre})</span>
                </div>` : `
                <div style="margin-top: 8px; border-top: 1px dashed ${isOptimal ? '#00cc00' : '#555'}; padding-top: 6px; font-size: 13px; color: #aaa;">
                    🛡️ <b>Path Clear</b> - No more fights!
                </div>`}
            </div>
        `;
    });

    content.html(htmlOutput);
}
