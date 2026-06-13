const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const crypto = require('crypto');
const fs = require('fs');

const app = express();
const wss = new WebSocket.Server({ port: 8446 });

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json({ limit: '50mb' }));

const DATA_DIR = path.join(__dirname, 'data');
const SNAPSHOTS_DIR = path.join(DATA_DIR, 'snapshots');
const ROOMS_FILE = path.join(DATA_DIR, 'rooms.json');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(SNAPSHOTS_DIR)) fs.mkdirSync(SNAPSHOTS_DIR, { recursive: true });

function loadRooms() {
  try {
    if (fs.existsSync(ROOMS_FILE)) {
      return JSON.parse(fs.readFileSync(ROOMS_FILE, 'utf8'));
    }
  } catch (e) {
    console.error('加载房间数据失败:', e.message);
  }
  return {};
}

function saveRooms(roomsData) {
  try {
    fs.writeFileSync(ROOMS_FILE, JSON.stringify(roomsData, null, 2));
  } catch (e) {
    console.error('保存房间数据失败:', e.message);
  }
}

function getSnapshotFilePath(roomCode) {
  return path.join(SNAPSHOTS_DIR, `${roomCode}.json`);
}

function loadSnapshots(roomCode) {
  try {
    const filePath = getSnapshotFilePath(roomCode);
    if (fs.existsSync(filePath)) {
      return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    }
  } catch (e) {
    console.error('加载 ' + roomCode + ' 快照失败:', e.message);
  }
  return [];
}

function saveSnapshotFile(roomCode, snapshot) {
  try {
    const snapshots = loadSnapshots(roomCode);
    snapshots.push(snapshot);
    if (snapshots.length > 50) {
      snapshots.splice(0, snapshots.length - 50);
    }
    fs.writeFileSync(getSnapshotFilePath(roomCode), JSON.stringify(snapshots));
    return true;
  } catch (e) {
    console.error('保存 ' + roomCode + ' 快照失败:', e.message);
    return false;
  }
}

const rooms = new Map();

function generateRoomCode() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let code;
  do {
    code = '';
    for (let i = 0; i < 6; i++) {
      code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
  } while (rooms.has(code));
  return code;
}

function generateUserId() {
  return crypto.randomBytes(8).toString('hex');
}

function getRoom(roomCode) {
  if (!rooms.has(roomCode)) {
    rooms.set(roomCode, {
      code: roomCode,
      users: new Map(),
      operations: [],
      layers: {
        background: { visible: true, opacity: 100, operations: [] },
        middle: { visible: true, opacity: 100, operations: [] },
        foreground: { visible: true, opacity: 100, operations: [] }
      },
      isLocked: false,
      ownerId: null
    });
  }
  return rooms.get(roomCode);
}

function broadcastToRoom(roomCode, message, excludeId = null) {
  const room = rooms.get(roomCode);
  if (!room) return;
  const data = JSON.stringify(message);
  for (const [userId, user] of room.users) {
    if (userId !== excludeId && user.ws.readyState === WebSocket.OPEN) {
      user.ws.send(data);
    }
  }
}

function getUserList(room) {
  const users = [];
  for (const [id, user] of room.users) {
    users.push({
      id,
      name: user.name,
      color: user.color,
      isOwner: id === room.ownerId
    });
  }
  return users;
}

function getOperationsBounds(operations) {
  if (!operations || operations.length === 0) return null;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  
  for (const op of operations) {
    const bounds = getOperationBounds(op);
    if (bounds) {
      minX = Math.min(minX, bounds.minX);
      minY = Math.min(minY, bounds.minY);
      maxX = Math.max(maxX, bounds.maxX);
      maxY = Math.max(maxY, bounds.maxY);
    }
  }
  
  if (minX === Infinity) return null;
  return { minX, minY, maxX, maxY };
}

function getOperationBounds(op) {
  switch (op.type) {
    case 'freehand':
    case 'eraser':
      if (!op.points || op.points.length === 0) return null;
      let fx = Infinity, fy = Infinity, fmaxX = -Infinity, fmaxY = -Infinity;
      for (const p of op.points) {
        fx = Math.min(fx, p.x);
        fy = Math.min(fy, p.y);
        fmaxX = Math.max(fmaxX, p.x);
        fmaxY = Math.max(fmaxY, p.y);
      }
      return { minX: fx, minY: fy, maxX: fmaxX, maxY: fmaxY };
    case 'line':
      return {
        minX: Math.min(op.x1, op.x2),
        minY: Math.min(op.y1, op.y2),
        maxX: Math.max(op.x1, op.x2),
        maxY: Math.max(op.y1, op.y2)
      };
    case 'rect':
      return {
        minX: Math.min(op.x, op.x + op.width),
        minY: Math.min(op.y, op.y + op.height),
        maxX: Math.max(op.x, op.x + op.width),
        maxY: Math.max(op.y, op.y + op.height)
      };
    case 'circle':
      return {
        minX: op.x - op.radius,
        minY: op.y - op.radius,
        maxX: op.x + op.radius,
        maxY: op.y + op.radius
      };
    case 'text':
      return {
        minX: op.x,
        minY: op.y,
        maxX: op.x + (op.text?.length || 0) * 12,
        maxY: op.y + op.size
      };
    default:
      return null;
  }
}

function offsetOperation(op, offsetX, offsetY) {
  switch (op.type) {
    case 'freehand':
    case 'eraser':
      if (op.points) {
        for (const p of op.points) {
          p.x += offsetX;
          p.y += offsetY;
        }
      }
      break;
    case 'line':
      op.x1 += offsetX;
      op.y1 += offsetY;
      op.x2 += offsetX;
      op.y2 += offsetY;
      break;
    case 'rect':
      op.x += offsetX;
      op.y += offsetY;
      break;
    case 'circle':
      op.x += offsetX;
      op.y += offsetY;
      break;
    case 'text':
      op.x += offsetX;
      op.y += offsetY;
      break;
  }
}

function getRandomColor() {
  const colors = ['#e74c3c', '#3498db', '#2ecc71', '#f39c12', '#9b59b6', '#1abc9c', '#e67e22', '#34495e'];
  return colors[Math.floor(Math.random() * colors.length)];
}

wss.on('connection', (ws) => {
  let userId = null;
  let currentRoom = null;

  ws.on('message', (message) => {
    let data;
    try {
      data = JSON.parse(message);
    } catch (e) {
      return;
    }

    switch (data.type) {
      case 'create_room': {
        userId = generateUserId();
        const roomCode = generateRoomCode();
        const room = getRoom(roomCode);
        room.ownerId = userId;
        const userColor = getRandomColor();
        room.users.set(userId, {
          ws,
          name: data.userName || '用户' + userId.slice(0, 4),
          color: userColor
        });
        currentRoom = roomCode;

        const roomsData = loadRooms();
        roomsData[roomCode] = {
          ownerId: userId,
          isLocked: false,
          createdAt: Date.now()
        };
        saveRooms(roomsData);

        ws.send(JSON.stringify({
          type: 'room_created',
          roomCode,
          userId,
          userName: room.users.get(userId).name,
          userColor,
          isOwner: true,
          layers: room.layers,
          isLocked: room.isLocked
        }));

        broadcastToRoom(roomCode, {
          type: 'user_list',
          users: getUserList(room)
        });

        const latestSnapshot = getLatestSnapshot(roomCode);
        if (latestSnapshot) {
          ws.send(JSON.stringify({
            type: 'snapshot_loaded',
            snapshotData: latestSnapshot
          }));
        }
        break;
      }

      case 'join_room': {
        const roomCode = data.roomCode?.toUpperCase();
        const roomsData = loadRooms();
        if (!rooms.has(roomCode) && !roomsData[roomCode]) {
          ws.send(JSON.stringify({ type: 'error', message: '房间不存在' }));
          return;
        }
        const room = getRoom(roomCode);
        if (room.users.size >= 8) {
          ws.send(JSON.stringify({ type: 'error', message: '房间已满（最多8人）' }));
          return;
        }
        userId = generateUserId();
        const userColor = getRandomColor();
        room.users.set(userId, {
          ws,
          name: data.userName || '用户' + userId.slice(0, 4),
          color: userColor
        });
        currentRoom = roomCode;

        if (roomsData[roomCode]) {
          room.ownerId = roomsData[roomCode].ownerId;
          room.isLocked = roomsData[roomCode].isLocked || false;
        }

        if (room.operations.length === 0) {
          const latestSnapshot = getLatestSnapshot(roomCode);
          if (latestSnapshot && latestSnapshot.operations) {
            room.operations = latestSnapshot.operations || [];
            if (latestSnapshot.layers) {
              for (const [layer, info] of Object.entries(latestSnapshot.layers)) {
                if (room.layers[layer]) {
                  room.layers[layer].visible = info.visible ?? true;
                  room.layers[layer].opacity = info.opacity ?? 100;
                }
              }
            }
            for (const op of room.operations) {
              const layer = op.layer || 'middle';
              if (room.layers[layer]) {
                room.layers[layer].operations.push(op);
              }
            }
          }
        }

        ws.send(JSON.stringify({
          type: 'room_joined',
          roomCode,
          userId,
          userName: room.users.get(userId).name,
          userColor,
          isOwner: userId === room.ownerId,
          layers: room.layers,
          isLocked: room.isLocked
        }));

        broadcastToRoom(roomCode, {
          type: 'user_list',
          users: getUserList(room)
        }, userId);

        ws.send(JSON.stringify({
          type: 'user_list',
          users: getUserList(room)
        }));

        const allOps = getAllLayerOperations(room);
        ws.send(JSON.stringify({
          type: 'full_state',
          operations: allOps
        }));
        break;
      }

      case 'draw_operation': {
        if (!currentRoom || !userId) return;
        const room = rooms.get(currentRoom);
        if (!room) return;
        if (room.isLocked && userId !== room.ownerId) return;

        const operation = {
          ...data.operation,
          userId,
          timestamp: Date.now()
        };

        const layer = data.layer || 'middle';
        if (room.layers[layer]) {
          room.layers[layer].operations.push(operation);
        }

        room.operations.push(operation);

        broadcastToRoom(currentRoom, {
          type: 'draw_operation',
          operation,
          layer
        }, userId);
        break;
      }

      case 'clear_canvas': {
        if (!currentRoom || !userId) return;
        const room = rooms.get(currentRoom);
        if (!room || userId !== room.ownerId) return;

        room.operations = [];
        for (const layer of Object.values(room.layers)) {
          layer.operations = [];
        }

        broadcastToRoom(currentRoom, {
          type: 'canvas_cleared'
        });
        break;
      }

      case 'kick_user': {
        if (!currentRoom || !userId) return;
        const room = rooms.get(currentRoom);
        if (!room || userId !== room.ownerId) return;

        const targetUser = room.users.get(data.targetUserId);
        if (targetUser && targetUser.ws.readyState === WebSocket.OPEN) {
          targetUser.ws.send(JSON.stringify({ type: 'kicked' }));
          targetUser.ws.close();
        }
        room.users.delete(data.targetUserId);

        broadcastToRoom(currentRoom, {
          type: 'user_list',
          users: getUserList(room)
        });
        break;
      }

      case 'toggle_lock': {
        if (!currentRoom || !userId) return;
        const room = rooms.get(currentRoom);
        if (!room || userId !== room.ownerId) return;

        room.isLocked = data.isLocked;
        const roomsData = loadRooms();
        if (roomsData[currentRoom]) {
          roomsData[currentRoom].isLocked = data.isLocked;
          saveRooms(roomsData);
        }

        broadcastToRoom(currentRoom, {
          type: 'lock_changed',
          isLocked: room.isLocked
        });
        break;
      }

      case 'layer_visibility': {
        if (!currentRoom) return;
        const room = rooms.get(currentRoom);
        if (!room || !room.layers[data.layer]) return;

        room.layers[data.layer].visible = data.visible;
        broadcastToRoom(currentRoom, {
          type: 'layer_visibility',
          layer: data.layer,
          visible: data.visible
        });
        break;
      }

      case 'layer_opacity': {
        if (!currentRoom) return;
        const room = rooms.get(currentRoom);
        if (!room || !room.layers[data.layer]) return;

        room.layers[data.layer].opacity = data.opacity;
        broadcastToRoom(currentRoom, {
          type: 'layer_opacity',
          layer: data.layer,
          opacity: data.opacity
        });
        break;
      }

      case 'get_all_operations': {
        if (!currentRoom) return;
        const room = rooms.get(currentRoom);
        if (!room) return;
        ws.send(JSON.stringify({
          type: 'all_operations',
          operations: room.operations
        }));
        break;
      }

      case 'save_snapshot': {
        if (!currentRoom) return;
        saveSnapshot(currentRoom, data.snapshotData);
        break;
      }

      case 'undo_operation': {
        if (!currentRoom || !userId) return;
        const room = rooms.get(currentRoom);
        if (!room || room.isLocked) return;

        for (let i = room.operations.length - 1; i >= 0; i--) {
          if (room.operations[i].userId === userId) {
            const removed = room.operations.splice(i, 1)[0];
            for (const layer of Object.values(room.layers)) {
              const idx = layer.operations.findIndex(op => op.timestamp === removed.timestamp && op.userId === userId);
              if (idx !== -1) {
                layer.operations.splice(idx, 1);
                break;
              }
            }
            broadcastToRoom(currentRoom, {
              type: 'undo_operation',
              timestamp: removed.timestamp,
              userId
            });
            break;
          }
        }
        break;
      }

      case 'move_operations': {
        if (!currentRoom || !userId) return;
        const room = rooms.get(currentRoom);
        if (!room || room.isLocked) return;

        const { operationIds, offsetX, offsetY } = data;
        if (!operationIds || !Array.isArray(operationIds)) return;

        for (const op of room.operations) {
          if (operationIds.includes(op.timestamp)) {
            offsetOperation(op, offsetX, offsetY);
          }
        }
        for (const layer of Object.values(room.layers)) {
          for (const op of layer.operations) {
            if (operationIds.includes(op.timestamp)) {
              offsetOperation(op, offsetX, offsetY);
            }
          }
        }

        broadcastToRoom(currentRoom, {
          type: 'move_operations',
          operationIds,
          offsetX,
          offsetY,
          userId
        }, userId);
        break;
      }

      case 'delete_operations': {
        if (!currentRoom || !userId) return;
        const room = rooms.get(currentRoom);
        if (!room || room.isLocked) return;

        const { operationIds } = data;
        if (!operationIds || !Array.isArray(operationIds)) return;

        for (const layer of Object.values(room.layers)) {
          layer.operations = layer.operations.filter(op => !operationIds.includes(op.timestamp));
        }
        room.operations = room.operations.filter(op => !operationIds.includes(op.timestamp));

        broadcastToRoom(currentRoom, {
          type: 'delete_operations',
          operationIds,
          userId
        }, userId);
        break;
      }

      case 'cursor_move': {
        if (!currentRoom || !userId) return;
        const room = rooms.get(currentRoom);
        if (!room) return;

        const user = room.users.get(userId);
        if (user) {
          user.cursorX = data.x;
          user.cursorY = data.y;
          user.isDrawing = data.isDrawing || false;
          user.viewportScale = data.scale || 1;
          user.viewportOffsetX = data.offsetX || 0;
          user.viewportOffsetY = data.offsetY || 0;
        }

        broadcastToRoom(currentRoom, {
          type: 'cursor_move',
          userId,
          x: data.x,
          y: data.y,
          isDrawing: data.isDrawing || false,
          scale: data.scale || 1,
          offsetX: data.offsetX || 0,
          offsetY: data.offsetY || 0
        }, userId);
        break;
      }

      case 'viewport_sync': {
        if (!currentRoom || !userId) return;
        const room = rooms.get(currentRoom);
        if (!room) return;

        broadcastToRoom(currentRoom, {
          type: 'viewport_sync',
          userId,
          scale: data.scale,
          offsetX: data.offsetX,
          offsetY: data.offsetY,
          targetUserId: data.targetUserId
        }, userId);
        break;
      }

      case 'get_content_bounds': {
        if (!currentRoom || !userId) return;
        const room = rooms.get(currentRoom);
        if (!room) return;

        const bounds = getOperationsBounds(room.operations);
        ws.send(JSON.stringify({
          type: 'content_bounds',
          bounds
        }));
        break;
      }
    }
  });

  ws.on('close', () => {
    if (currentRoom && userId) {
      const room = rooms.get(currentRoom);
      if (room) {
        room.users.delete(userId);
        if (room.users.size === 0) {
          scheduleRoomCleanup(currentRoom);
        } else {
          broadcastToRoom(currentRoom, {
            type: 'user_list',
            users: getUserList(room)
          });
        }
      }
    }
  });
});

function getAllLayerOperations(room) {
  return room.operations;
}

function getLatestSnapshot(roomCode) {
  const snapshots = loadSnapshots(roomCode);
  if (snapshots.length > 0) {
    return snapshots[snapshots.length - 1];
  }
  return null;
}

function saveSnapshot(roomCode, snapshotData) {
  const snapshot = {
    id: Date.now(),
    createdAt: new Date().toISOString(),
    ...snapshotData
  };
  saveSnapshotFile(roomCode, snapshot);
}

const roomCleanupTimers = new Map();

function scheduleRoomCleanup(roomCode) {
  if (roomCleanupTimers.has(roomCode)) {
    clearTimeout(roomCleanupTimers.get(roomCode));
  }
  roomCleanupTimers.set(roomCode, setTimeout(() => {
    rooms.delete(roomCode);
    roomCleanupTimers.delete(roomCode);
  }, 300000));
}

setInterval(() => {
  for (const [roomCode, room] of rooms) {
    if (room.operations.length > 0) {
      const snapshotData = {
        operations: room.operations,
        layers: {
          background: { visible: room.layers.background.visible, opacity: room.layers.background.opacity },
          middle: { visible: room.layers.middle.visible, opacity: room.layers.middle.opacity },
          foreground: { visible: room.layers.foreground.visible, opacity: room.layers.foreground.opacity }
        }
      };
      saveSnapshot(roomCode, snapshotData);
    }
  }
}, 30000);

app.get('/api/snapshots/:roomCode', (req, res) => {
  const roomCode = req.params.roomCode.toUpperCase();
  const snapshots = loadSnapshots(roomCode);
  const list = snapshots.map((s, idx) => ({
    id: s.id || idx,
    created_at: s.createdAt || new Date().toISOString()
  })).reverse().slice(0, 20);
  res.json(list);
});

app.get('/api/snapshots/:roomCode/:id', (req, res) => {
  const roomCode = req.params.roomCode.toUpperCase();
  const id = parseInt(req.params.id);
  const snapshots = loadSnapshots(roomCode);
  const snapshot = snapshots.find(s => s.id === id);
  if (snapshot) {
    res.json(snapshot);
  } else {
    res.status(404).json({ error: 'Snapshot not found' });
  }
});

const sampleOperations = [
  { type: 'freehand', points: [{x: 100, y: 200}, {x: 150, y: 180}, {x: 200, y: 220}, {x: 250, y: 200}, {x: 300, y: 250}], color: '#e74c3c', size: 3, layer: 'middle', userId: 'sample', timestamp: Date.now() - 100000 },
  { type: 'rect', x: 400, y: 150, width: 200, height: 150, color: '#3498db', size: 2, layer: 'middle', userId: 'sample', timestamp: Date.now() - 90000 },
  { type: 'circle', x: 700, y: 250, radius: 80, color: '#2ecc71', size: 3, fill: false, layer: 'middle', userId: 'sample', timestamp: Date.now() - 80000 },
  { type: 'line', x1: 100, y1: 400, x2: 500, y2: 450, color: '#f39c12', size: 4, layer: 'middle', userId: 'sample', timestamp: Date.now() - 70000 },
  { type: 'text', x: 200, y: 550, text: '欢迎使用协作画板！', color: '#9b59b6', size: 24, layer: 'middle', userId: 'sample', timestamp: Date.now() - 60000 },
  { type: 'freehand', points: [{x: 900, y: 100}, {x: 950, y: 200}, {x: 1000, y: 150}, {x: 1050, y: 250}, {x: 1100, y: 180}], color: '#e67e22', size: 5, layer: 'foreground', userId: 'sample', timestamp: Date.now() - 50000 },
  { type: 'rect', x: 50, y: 50, width: 1100, height: 700, color: '#34495e', size: 1, layer: 'background', userId: 'sample', timestamp: Date.now() - 40000 }
];

const sampleSnapshotData = {
  id: Date.now() - 30000,
  createdAt: new Date(Date.now() - 30000).toISOString(),
  operations: sampleOperations,
  layers: {
    background: { visible: true, opacity: 100 },
    middle: { visible: true, opacity: 100 },
    foreground: { visible: true, opacity: 100 }
  }
};

const demoSnapshots = loadSnapshots('DEMO01');
if (demoSnapshots.length === 0) {
  saveSnapshotFile('DEMO01', sampleSnapshotData);
}

const roomsData = loadRooms();
if (!roomsData['DEMO01']) {
  roomsData['DEMO01'] = {
    ownerId: 'sample_owner',
    isLocked: false,
    createdAt: Date.now() - 86400000
  };
  saveRooms(roomsData);
}

const HTTP_PORT = 3446;
app.listen(HTTP_PORT, () => {
  console.log(`HTTP 服务器运行在 http://localhost:${HTTP_PORT}`);
  console.log(`WebSocket 服务器运行在 ws://localhost:8446`);
  console.log('演示房间: DEMO01');
});
