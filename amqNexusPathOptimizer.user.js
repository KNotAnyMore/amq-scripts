// ==UserScript==
// @name         AMQ Nexus Path Optimizer
// @namespace    http://tampermonkey.net/
// @version      1.1
// @description  Calculates best paths, highlights next fight, tracks player location.
// @author       KNotAnyMore
// @match        https://animemusicquiz.com/*
// @grant        none
// @require      https://github.com/joske2865/AMQ-Scripts/raw/master/common/amqWindows.js
// @downloadURL  https://github.com/KNotAnyMore/amq-scripts/raw/main/amqNexusPathOptimizer.user.js
// @updateURL    https://github.com/KNotAnyMore/amq-scripts/raw/main/amqNexusPathOptimizer.user.js
// ==/UserScript==

// --- CONFIGURATION ---
const FIGHT_TYPE_ID = 3;
const BOSS_TYPE_ID = 2;
const SHOP_TYPE_ID = 5; 

let globalTileLookup = {};
let currentPos = { row: 0, col: 2 };
let optimizerWindow;
let hasAutoOpened = false;
let currentPriority = "minFights"; 

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
    interceptOutgoingMoves(); 
    
    // Handler for Full Map Data
    const handleMapData = (payload) => {
        const tiles = payload.tiles || (payload.data ? payload.data.tiles : null);
        if (tiles) {
            globalTileLookup = buildTileLookup(tiles);

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
    const originalSendCommand = socket.sendCommand;
    socket.sendCommand = function (payload) {
        if (payload.type === "nexus" && payload.command === "map select tile") {
            if (payload.data && payload.data.row !== undefined) {
                currentPos = { row: payload.data.row, col: payload.data.col };
                setTimeout(updateUI, 100); 
            }
        }
        originalSendCommand.apply(this, arguments);
    };
}

// 3. Build the AMQ Native Window & Dropdown
function setupNativeWindow() {
    optimizerWindow = new AMQWindow({
        id: "nexusOptimizerWindow",
        title: "Nexus Path Optimizer",
        width: 440,
        height: 500,
        minWidth: 380,
        minHeight: 300,
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
        <div style="padding: 10px; border-bottom: 1px solid #444; display: flex; justify-content: space-between; align-items: center; background: rgba(0,0,0,0.4);">
            <span style="color: #ccc; font-weight: bold; font-size: 13px;">Target Priority:</span>
            <select id="nexus-opt-priority" style="background: #222; color: #00ccff; border: 1px solid #00ccff; border-radius: 4px; padding: 4px 8px; outline: none; cursor: pointer; font-weight: bold;">
                <option value="minFights">🟢 Lowest Fights</option>
                <option value="maxFights">🔴 Highest Fights</option>
                <option value="maxShops">🛍️ Highest Shops</option>
            </select>
        </div>
        <div id="nexus-opt-content" style="padding: 10px; font-size: 14px;">
            Waiting for Nexus map data...
        </div>
    `);

    // Listen for dropdown changes
    $("#nexus-opt-priority").on("change", function() {
        currentPriority = $(this).val();
        updateUI();
    });

    optimizerWindow.window.find(".close").off("click").on("click", () => {
        optimizerWindow.close();
    });
}

// 4. Setup Hotkeys & Monitors
function setupHotkey() {
    document.addEventListener("keydown", (event) => {
        const hasMapData = Object.keys(globalTileLookup).length > 0;
        if (!hasMapData) return;

        const inFight = $("#qpAnswerInput").is(":visible");
        const isNexusMapVisible = $("#nexusMapIconOverlay").is(":visible");

        if (inFight || !isNexusMapVisible) return;

        if (event.key === "Tab" && !event.altKey && !event.ctrlKey && !event.shiftKey && !event.metaKey) {
            event.preventDefault(); 
            optimizerWindow.isVisible() ? optimizerWindow.close() : optimizerWindow.open();
        }

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

    if (currentTile.typeId === BOSS_TYPE_ID) {
        content.html(`<div style="color: #00ff00; font-weight: bold; text-align: center; font-size: 16px; margin-top: 20px;">👑 Boss Tile Reached!</div>`);
        return;
    }

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

        const isFight = tile.typeId === FIGHT_TYPE_ID;
        const isShop = tile.typeId === SHOP_TYPE_ID;
        
        const fWeight = isFight ? 1 : 0;
        const sWeight = isShop ? 1 : 0;
        
        let encounterData = [];
        if (isFight) encounterData = [{ name: tile.genre || "standard", floor: row, type: "fight", icon: "⚔️" }];
        if (isShop) encounterData = [{ name: "Shop", floor: row, type: "shop", icon: "🛍️" }];

        if (tile.typeId === BOSS_TYPE_ID) {
            const baseData = { fights: fWeight, shops: sWeight, path: encounterData };
            return { minFights: baseData, maxFights: baseData, maxShops: baseData };
        }

        let possibleRoutes = [];
        if (tile.connectionDirections.up) { let r = getPathsToBoss(row + 1, col); if(r) possibleRoutes.push(r); }
        if (tile.connectionDirections.left) { let r = getPathsToBoss(row + 1, col - 1); if(r) possibleRoutes.push(r); }
        if (tile.connectionDirections.right) { let r = getPathsToBoss(row + 1, col + 1); if(r) possibleRoutes.push(r); }

        if (possibleRoutes.length === 0) {
            const baseData = { fights: fWeight, shops: sWeight, path: encounterData };
            return { minFights: baseData, maxFights: baseData, maxShops: baseData };
        }

        const bestMinF = possibleRoutes.reduce((prev, curr) => (prev.minFights.fights < curr.minFights.fights) ? prev : curr).minFights;
        const bestMaxF = possibleRoutes.reduce((prev, curr) => (prev.maxFights.fights > curr.maxFights.fights) ? prev : curr).maxFights;
        const bestMaxS = possibleRoutes.reduce((prev, curr) => (prev.maxShops.shops > curr.maxShops.shops) ? prev : curr).maxShops;

        memo[key] = {
            minFights: { fights: fWeight + bestMinF.fights, shops: sWeight + bestMinF.shops, path: encounterData.concat(bestMinF.path) },
            maxFights: { fights: fWeight + bestMaxF.fights, shops: sWeight + bestMaxF.shops, path: encounterData.concat(bestMaxF.path) },
            maxShops: { fights: fWeight + bestMaxS.fights, shops: sWeight + bestMaxS.shops, path: encounterData.concat(bestMaxS.path) }
        };
        return memo[key];
    }

    let activeBranchData = [];
    let absoluteTarget = null; 

    branches.forEach(branch => {
        if (!branch.active) return;
        const result = getPathsToBoss(branch.r, branch.c);
        if (!result) return;
        
        activeBranchData.push({ branch, result });
        
        let val;
        if (currentPriority === 'minFights') val = result.minFights.fights;
        if (currentPriority === 'maxFights') val = result.maxFights.fights;
        if (currentPriority === 'maxShops') val = result.maxShops.shops;

        if (absoluteTarget === null) {
            absoluteTarget = val;
        } else {
            if (currentPriority === 'minFights' && val < absoluteTarget) absoluteTarget = val;
            if (currentPriority === 'maxFights' && val > absoluteTarget) absoluteTarget = val;
            if (currentPriority === 'maxShops' && val > absoluteTarget) absoluteTarget = val;
        }
    });

    let htmlOutput = `<div style="margin-bottom: 8px; color: #888; padding-bottom: 4px;">Current Location: Floor ${currentPos.row}</div>`;
    
    if (activeBranchData.length === 0) {
        content.html(htmlOutput + `<div style="color: #aaa; text-align: center; margin-top: 20px;">End of the line.</div>`);
        return;
    }

    const formatPathStr = (pathArray) => {
        if (!pathArray || pathArray.length === 0) return "No Encounters";
        return pathArray.map((enc, index) => {
            if (index === 0) {
                const glowColor = enc.type === 'shop' ? '#00ccff' : '#ffffff';
                return `<span style="color: ${glowColor}; text-shadow: 0 0 6px ${glowColor}, 0 0 10px rgba(255,255,255,0.6); font-weight: bold; background: rgba(255,255,255,0.15); padding: 0 4px; border-radius: 3px;">${enc.icon} ${enc.name}</span>`;
            }
            return `${enc.icon} ${enc.name}`;
        }).join(" ➔ ");
    };

    activeBranchData.forEach(data => {
        const { branch, result } = data;
        
        let isOptimal = false;
        if (currentPriority === 'minFights' && result.minFights.fights === absoluteTarget) isOptimal = true;
        if (currentPriority === 'maxFights' && result.maxFights.fights === absoluteTarget) isOptimal = true;
        if (currentPriority === 'maxShops' && result.maxShops.shops === absoluteTarget) isOptimal = true;
        
        const containerStyle = isOptimal 
            ? `background: rgba(0, 40, 0, 0.8); padding: 12px; border-radius: 6px; margin-bottom: 12px; border: 1px solid #00ff00; box-shadow: 0 0 12px rgba(0, 255, 0, 0.25); opacity: 1; transition: all 0.3s ease;` 
            : `background: rgba(0, 0, 0, 0.3); padding: 12px; border-radius: 6px; margin-bottom: 12px; border: 1px solid #444; opacity: 0.45; filter: grayscale(50%); transition: all 0.3s ease;`;

        let optimalNextEnc = null;
        if (currentPriority === 'minFights') optimalNextEnc = result.minFights.path.length > 0 ? result.minFights.path[0] : null;
        if (currentPriority === 'maxFights') optimalNextEnc = result.maxFights.path.length > 0 ? result.maxFights.path[0] : null;
        if (currentPriority === 'maxShops') optimalNextEnc = result.maxShops.path.length > 0 ? result.maxShops.path[0] : null;

        htmlOutput += `
            <div style="${containerStyle}">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
                    <strong style="${isOptimal ? 'color:#fff; text-shadow: 0 0 5px rgba(0,255,0,0.5);' : 'color:#aaa;'} font-size: 16px;">${branch.name}</strong>
                    ${isOptimal ? `<span style="background: #00ff00; color: #000; font-size: 10px; font-weight: bold; padding: 2px 6px; border-radius: 10px;">BEST ROUTE</span>` : ''}
                </div>
                
                <div style="display: grid; gap: 8px;">
                    <div>
                        <div style="font-size: 13px; margin-bottom: 2px;">
                            <span style="color: #00ff00; font-weight: bold;">🟢 Min Fights: ${result.minFights.fights}</span>
                            <span style="color: #888; font-size: 11px; margin-left: 6px;">(🛍️ Shops: ${result.minFights.shops})</span>
                        </div>
                        <div style="color: #bbb; font-size: 12px; line-height: 1.4;">${formatPathStr(result.minFights.path)}</div>
                    </div>
                    
                    <div>
                        <div style="font-size: 13px; margin-bottom: 2px;">
                            <span style="color: #ff4444; font-weight: bold;">🔴 Max Fights: ${result.maxFights.fights}</span>
                            <span style="color: #888; font-size: 11px; margin-left: 6px;">(🛍️ Shops: ${result.maxFights.shops})</span>
                        </div>
                        <div style="color: #bbb; font-size: 12px; line-height: 1.4;">${formatPathStr(result.maxFights.path)}</div>
                    </div>

                    <div>
                        <div style="font-size: 13px; margin-bottom: 2px;">
                            <span style="color: #00ccff; font-weight: bold;">🛍️ Max Shops: ${result.maxShops.shops}</span>
                            <span style="color: #888; font-size: 11px; margin-left: 6px;">(⚔️ Fights: ${result.maxShops.fights})</span>
                        </div>
                        <div style="color: #bbb; font-size: 12px; line-height: 1.4;">${formatPathStr(result.maxShops.path)}</div>
                    </div>
                </div>

                ${optimalNextEnc ? `
                <div style="margin-top: 10px; border-top: 1px dashed ${isOptimal ? '#00cc00' : '#555'}; padding-top: 8px; font-size: 13px; color: ${isOptimal ? '#55ff55' : '#888'};">
                    ${optimalNextEnc.icon} <b>Next Encounter:</b> Floor ${optimalNextEnc.floor} <span style="opacity: 0.8;">(${optimalNextEnc.name})</span>
                </div>` : `
                <div style="margin-top: 10px; border-top: 1px dashed ${isOptimal ? '#00cc00' : '#555'}; padding-top: 8px; font-size: 13px; color: #aaa;">
                    🛡️ <b>Path Clear</b> - No more encounters!
                </div>`}
            </div>
        `;
    });

    content.html(htmlOutput);
}
