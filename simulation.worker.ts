// --- TYPE DEFINITIONS ---
type Point = { type: 'Point', coordinates: number[] };
type LineString = { type: 'LineString', coordinates: number[][] };
type Feature<T> = { type: 'Feature', geometry: T, properties: any, id?: number | string };

interface SimStation {
    id: number | string;
    coords: number[];
    lines: {
        [lineId: string]: {
            lineId: number | string;
            distance: number;
        }
    }
}

interface SimLine {
    id: number | string;
    coords: number[][];
    length: number;
    stationDistances: { id: number | string; distance: number }[];
}

interface Train {
    id: number;
    lineId: number | string;
    distanceAlongLine: number;
    speed: number; // m/s
    direction: 1 | -1;
    state: 'moving' | 'dwelling';
    dwellTimeRemaining: number;
    currentStationIndex: number;
    load: number;
    capacity: number;
}


// --- STATE ---
let simulationInterval: number | null = null;
const trains: Train[] = [];
const simLines: { [id: string]: SimLine } = {};
const simStations: { [id: string]: SimStation } = {};
let nextTrainId = 1;

// --- CONSTANTS ---
const TICK_RATE = 1000; // 1 Hz
const MAX_SPEED_MPS = 22; // ~80 km/h
const ACCELERATION_MPS2 = 1.0;
const DWELL_TIME_BASE = 20; // seconds
const MIN_HEADWAY_SECONDS = 90; // 1.5 minutes
const MIN_HEADWAY_DISTANCE_M = 150; // meters

// --- GEOMETRY HELPERS ---
function turfDistance(from: number[], to: number[]): number {
    const R = 6371e3; // metres
    const φ1 = from[1] * Math.PI / 180;
    const φ2 = to[1] * Math.PI / 180;
    const Δφ = (to[1] - from[1]) * Math.PI / 180;
    const Δλ = (to[0] - from[0]) * Math.PI / 180;

    const a = Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
        Math.cos(φ1) * Math.cos(φ2) *
        Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

    return R * c;
}

function lineLength(coords: number[][]): number {
    let total = 0;
    for (let i = 0; i < coords.length - 1; i++) {
        total += turfDistance(coords[i], coords[i + 1]);
    }
    return total;
}

function pointOnLine(lineCoords: number[][], dist: number): number[] | null {
    if (dist < 0) return lineCoords[0];

    let travelled = 0;
    for (let i = 0; i < lineCoords.length - 1; i++) {
        const start = lineCoords[i];
        const end = lineCoords[i + 1];
        const segmentLength = turfDistance(start, end);
        if (travelled + segmentLength >= dist) {
            const distIntoSegment = dist - travelled;
            const ratio = distIntoSegment / segmentLength;
            const lng = start[0] + (end[0] - start[0]) * ratio;
            const lat = start[1] + (end[1] - start[1]) * ratio;
            return [lng, lat];
        }
        travelled += segmentLength;
    }
    return lineCoords[lineCoords.length - 1];
}


// --- SIMULATION CORE ---

function processNetwork(lines: Feature<LineString>[], stations: Feature<Point>[]) {
    Object.keys(simLines).forEach(key => delete simLines[key]);
    Object.keys(simStations).forEach(key => delete simStations[key]);
    trains.length = 0;
    
    stations.forEach(s => {
        simStations[s.id as string] = {
            id: s.id as string,
            coords: s.geometry.coordinates,
            lines: {},
        };
    });

    lines.forEach(line => {
        const lineId = line.id as string;
        const length = lineLength(line.geometry.coordinates);
        const stationDistances: { id: number | string; distance: number }[] = [];
        
        // Find stations that are part of this line's coordinates
        let travelled = 0;
        for (let i = 0; i < line.geometry.coordinates.length; i++) {
            const coord = line.geometry.coordinates[i];
            if (i > 0) {
                travelled += turfDistance(line.geometry.coordinates[i-1], coord);
            }
            for (const station of stations) {
                if (station.geometry.coordinates[0] === coord[0] && station.geometry.coordinates[1] === coord[1]) {
                    stationDistances.push({ id: station.id as string, distance: travelled });
                    simStations[station.id as string].lines[lineId] = { lineId, distance: travelled };
                    break;
                }
            }
        }
        
        stationDistances.sort((a, b) => a.distance - b.distance);
        
        simLines[lineId] = {
            id: lineId,
            coords: line.geometry.coordinates,
            length,
            stationDistances
        };
    });
}

function spawnTrains() {
    for (const lineId in simLines) {
        const line = simLines[lineId];
        if (line.stationDistances.length < 2) continue;

        const trainsOnLine = trains.filter(t => t.lineId === lineId);
        
        // Spawn at start (direction: 1)
        const trainAtStart = trainsOnLine.find(t => t.direction === 1 && t.distanceAlongLine < MIN_HEADWAY_DISTANCE_M);
        if (!trainAtStart) {
            trains.push({
                id: nextTrainId++,
                lineId,
                distanceAlongLine: 0,
                speed: 0,
                direction: 1,
                state: 'dwelling',
                dwellTimeRemaining: DWELL_TIME_BASE / 2, // Start quicker
                currentStationIndex: 0,
                load: Math.floor(Math.random() * 50),
                capacity: 150,
            });
        }
        
        // Spawn at end (direction: -1)
        const trainAtEnd = trainsOnLine.find(t => t.direction === -1 && t.distanceAlongLine > line.length - MIN_HEADWAY_DISTANCE_M);
        if (!trainAtEnd) {
             trains.push({
                id: nextTrainId++,
                lineId,
                distanceAlongLine: line.length,
                speed: 0,
                direction: -1,
                state: 'dwelling',
                dwellTimeRemaining: DWELL_TIME_BASE / 2,
                currentStationIndex: line.stationDistances.length - 1,
                load: Math.floor(Math.random() * 50),
                capacity: 150,
            });
        }
    }
}

function updateTrain(train: Train, index: number, allTrains: Train[]) {
    const line = simLines[train.lineId];
    if (!line) {
        // Line was deleted, remove train
        allTrains.splice(index, 1);
        return;
    }

    if (train.state === 'dwelling') {
        train.dwellTimeRemaining--;
        if (train.dwellTimeRemaining <= 0) {
            train.state = 'moving';
            const nextStationIndex = train.currentStationIndex + train.direction;
            if (nextStationIndex >= line.stationDistances.length || nextStationIndex < 0) {
                train.direction *= -1; // Reverse direction
            }
        }
        return;
    }
    
    // --- MOVING LOGIC ---
    let targetSpeed = MAX_SPEED_MPS;

    // Headway control
    const trainInFront = allTrains.find(other => 
        other.id !== train.id &&
        other.lineId === train.lineId &&
        other.direction === train.direction &&
        (train.direction === 1 ? other.distanceAlongLine > train.distanceAlongLine : other.distanceAlongLine < train.distanceAlongLine)
    );

    if (trainInFront) {
        const distanceToFront = Math.abs(trainInFront.distanceAlongLine - train.distanceAlongLine);
        if (distanceToFront < MIN_HEADWAY_DISTANCE_M * 2) {
             // Simple proportional control to slow down
            targetSpeed = MAX_SPEED_MPS * (distanceToFront / (MIN_HEADWAY_DISTANCE_M * 2));
        }
    }
    
    // Adjust speed
    if (train.speed < targetSpeed) {
        train.speed = Math.min(targetSpeed, train.speed + ACCELERATION_MPS2);
    } else if (train.speed > targetSpeed) {
        train.speed = Math.max(targetSpeed, train.speed - ACCELERATION_MPS2 * 2); // Brake harder
    }
    
    train.distanceAlongLine += train.speed * train.direction;

    // Check for station arrival
    const nextStationIndex = train.currentStationIndex + train.direction;
    if (nextStationIndex >= 0 && nextStationIndex < line.stationDistances.length) {
        const nextStation = line.stationDistances[nextStationIndex];
        if ((train.direction === 1 && train.distanceAlongLine >= nextStation.distance) ||
            (train.direction === -1 && train.distanceAlongLine <= nextStation.distance))
        {
            train.distanceAlongLine = nextStation.distance;
            train.currentStationIndex = nextStationIndex;
            train.state = 'dwelling';
            train.dwellTimeRemaining = DWELL_TIME_BASE;
            train.speed = 0;
            // Simplified passenger logic
            train.load += Math.floor(Math.random() * 20) - 10;
            train.load = Math.max(0, Math.min(train.capacity, train.load));
        }
    } else {
        // End of the line, just keep it clamped
        train.distanceAlongLine = Math.max(0, Math.min(line.length, train.distanceAlongLine));
    }
}

function tick() {
    if (Object.keys(simLines).length === 0) {
        if (trains.length > 0) trains.length = 0;
    } else {
        spawnTrains();
        trains.forEach(updateTrain);
    }

    const trainFeatures = trains.map(t => {
        const line = simLines[t.lineId];
        if (!line) return null;
        const coords = pointOnLine(line.coords, t.distanceAlongLine);
        if (!coords) return null;

        return {
            type: 'Feature',
            geometry: { type: 'Point', coordinates: coords },
            properties: {
                id: t.id,
                loadFactor: t.load / t.capacity
            },
        };
    }).filter(Boolean);

    postMessage({
        type: 'TICK',
        payload: {
            trains: { type: 'FeatureCollection', features: trainFeatures }
        }
    });
}

// --- MESSAGE HANDLER ---
self.onmessage = (e) => {
    const { type, payload } = e.data;
    switch (type) {
        case 'START':
            if (!simulationInterval) {
                tick(); // Tick immediately on start
                simulationInterval = self.setInterval(tick, TICK_RATE);
            }
            break;
        case 'PAUSE':
            if (simulationInterval) {
                self.clearInterval(simulationInterval);
                simulationInterval = null;
            }
            break;
        case 'UPDATE_NETWORK':
            processNetwork(payload.lines, payload.stations);
            break;
    }
};