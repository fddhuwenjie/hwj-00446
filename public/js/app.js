class Whiteboard {
  constructor() {
    this.currentTool = 'freehand';
    this.currentColor = '#000000';
    this.currentSize = 3;
    this.currentLayer = 'middle';
    this.isDrawing = false;
    this.startPoint = { x: 0, y: 0 };
    this.currentPoints = [];
    this.textPosition = { x: 0, y: 0 };

    this.operations = [];
    this.undoStack = [];
    this.redoStack = [];

    this.layers = {
      background: { visible: true, opacity: 100, operations: [] },
      middle: { visible: true, opacity: 100, operations: [] },
      foreground: { visible: true, opacity: 100, operations: [] }
    };

    this.ws = null;
    this.roomCode = null;
    this.userId = null;
    this.userName = '';
    this.userColor = '';
    this.isOwner = false;
    this.isLocked = false;
    this.users = [];

    this.replayMode = false;
    this.replayOperations = [];
    this.replayIndex = 0;
    this.replayTimer = null;
    this.replaySpeed = 1;

    this.initCanvas();
    this.bindEvents();
  }

  initCanvas() {
    this.bgCanvas = document.getElementById('bgCanvas');
    this.middleCanvas = document.getElementById('middleCanvas');
    this.fgCanvas = document.getElementById('fgCanvas');
    this.previewCanvas = document.getElementById('previewCanvas');

    this.bgCtx = this.bgCanvas.getContext('2d');
    this.middleCtx = this.middleCanvas.getContext('2d');
    this.fgCtx = this.fgCanvas.getContext('2d');
    this.previewCtx = this.previewCanvas.getContext('2d');

    this.canvasMap = {
      background: { canvas: this.bgCanvas, ctx: this.bgCtx },
      middle: { canvas: this.middleCanvas, ctx: this.middleCtx },
      foreground: { canvas: this.fgCanvas, ctx: this.fgCtx }
    };
  }

  bindEvents() {
    document.getElementById('createRoomBtn').addEventListener('click', () => this.createRoom());
    document.getElementById('joinRoomBtn').addEventListener('click', () => this.joinRoom());
    document.getElementById('roomCodeInput').addEventListener('keypress', (e) => {
      if (e.key === 'Enter') this.joinRoom();
    });
    document.getElementById('userName').addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        if (document.getElementById('roomCodeInput').value.trim()) {
          this.joinRoom();
        } else {
          this.createRoom();
        }
      }
    });

    document.querySelectorAll('.tool-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.tool-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.currentTool = btn.dataset.tool;
      });
    });

    document.querySelectorAll('.color-swatch').forEach(swatch => {
      swatch.addEventListener('click', () => {
        this.setColor(swatch.dataset.color);
      });
    });

    document.getElementById('colorPicker').addEventListener('input', (e) => {
      this.setColor(e.target.value);
    });

    document.getElementById('hexInput').addEventListener('change', (e) => {
      let hex = e.target.value.trim();
      if (!hex.startsWith('#')) hex = '#' + hex;
      if (/^#[0-9A-Fa-f]{6}$/.test(hex)) {
        this.setColor(hex);
      }
    });

    document.getElementById('sizeSlider').addEventListener('input', (e) => {
      this.currentSize = parseInt(e.target.value);
      document.getElementById('sizeValue').textContent = this.currentSize;
    });

    document.querySelectorAll('.layer-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.layer-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.currentLayer = btn.dataset.layer;
      });
    });

    this.previewCanvas.addEventListener('mousedown', (e) => this.startDrawing(e));
    this.previewCanvas.addEventListener('mousemove', (e) => this.draw(e));
    this.previewCanvas.addEventListener('mouseup', (e) => this.endDrawing(e));
    this.previewCanvas.addEventListener('mouseleave', (e) => this.endDrawing(e));

    this.previewCanvas.addEventListener('touchstart', (e) => {
      e.preventDefault();
      const touch = e.touches[0];
      const mouseEvent = new MouseEvent('mousedown', {
        clientX: touch.clientX,
        clientY: touch.clientY
      });
      this.previewCanvas.dispatchEvent(mouseEvent);
    });
    this.previewCanvas.addEventListener('touchmove', (e) => {
      e.preventDefault();
      const touch = e.touches[0];
      const mouseEvent = new MouseEvent('mousemove', {
        clientX: touch.clientX,
        clientY: touch.clientY
      });
      this.previewCanvas.dispatchEvent(mouseEvent);
    });
    this.previewCanvas.addEventListener('touchend', (e) => {
      e.preventDefault();
      const mouseEvent = new MouseEvent('mouseup', {});
      this.previewCanvas.dispatchEvent(mouseEvent);
    });

    document.getElementById('undoBtn').addEventListener('click', () => this.undo());
    document.getElementById('redoBtn').addEventListener('click', () => this.redo());

    document.addEventListener('keydown', (e) => {
      if (e.ctrlKey || e.metaKey) {
        if (e.key === 'z' || e.key === 'Z') {
          e.preventDefault();
          if (e.shiftKey) {
            this.redo();
          } else {
            this.undo();
          }
        } else if (e.key === 'y' || e.key === 'Y') {
          e.preventDefault();
          this.redo();
        }
      }
    });

    document.querySelectorAll('.layer-visible').forEach(checkbox => {
      checkbox.addEventListener('change', (e) => {
        const layer = e.target.dataset.layer;
        this.layers[layer].visible = e.target.checked;
        this.updateLayerVisibility(layer);
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
          this.ws.send(JSON.stringify({
            type: 'layer_visibility',
            layer,
            visible: e.target.checked
          }));
        }
      });
    });

    document.querySelectorAll('.opacity-slider').forEach(slider => {
      slider.addEventListener('input', (e) => {
        const layer = e.target.dataset.layer;
        const opacity = parseInt(e.target.value);
        this.layers[layer].opacity = opacity;
        const valueSpan = e.target.parentElement.querySelector('.opacity-value');
        if (valueSpan) valueSpan.textContent = opacity + '%';
        this.redrawLayer(layer);
      });
      slider.addEventListener('change', (e) => {
        const layer = e.target.dataset.layer;
        const opacity = parseInt(e.target.value);
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
          this.ws.send(JSON.stringify({
            type: 'layer_opacity',
            layer,
            opacity
          }));
        }
      });
    });

    document.getElementById('exportPngBtn').addEventListener('click', () => this.exportPNG());
    document.getElementById('exportSvgBtn').addEventListener('click', () => this.exportSVG());

    document.getElementById('clearCanvasBtn').addEventListener('click', () => {
      if (confirm('确定要清空画布吗？此操作不可撤销。')) {
        this.clearCanvas();
      }
    });

    document.getElementById('toggleLockBtn').addEventListener('click', () => this.toggleLock());
    document.getElementById('replayBtn').addEventListener('click', () => this.startReplayMode());

    document.getElementById('replayPlayBtn').addEventListener('click', () => this.playReplay());
    document.getElementById('replayPauseBtn').addEventListener('click', () => this.pauseReplay());
    document.getElementById('replayResetBtn').addEventListener('click', () => this.resetReplay());
    document.getElementById('replayCloseBtn').addEventListener('click', () => this.closeReplay());
    document.getElementById('replaySpeed').addEventListener('change', (e) => {
      this.replaySpeed = parseFloat(e.target.value);
    });

    document.getElementById('loadSnapshotsBtn').addEventListener('click', () => this.loadSnapshots());

    document.getElementById('textCancelBtn').addEventListener('click', () => {
      document.getElementById('textInputModal').classList.add('hidden');
    });
    document.getElementById('textConfirmBtn').addEventListener('click', () => this.confirmText());
    document.getElementById('textInput').addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        this.confirmText();
      }
    });
  }

  getCanvasPos(e) {
    const rect = this.previewCanvas.getBoundingClientRect();
    const scaleX = this.previewCanvas.width / rect.width;
    const scaleY = this.previewCanvas.height / rect.height;
    return {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top) * scaleY
    };
  }

  setColor(color) {
    this.currentColor = color;
    document.getElementById('colorPicker').value = color;
    document.getElementById('hexInput').value = color;
    document.querySelectorAll('.color-swatch').forEach(swatch => {
      swatch.classList.toggle('active', swatch.dataset.color.toLowerCase() === color.toLowerCase());
    });
  }

  startDrawing(e) {
    if (this.isLocked && !this.isOwner) return;
    if (this.replayMode) return;

    const pos = this.getCanvasPos(e);
    this.isDrawing = true;
    this.startPoint = pos;
    this.currentPoints = [pos];

    if (this.currentTool === 'text') {
      this.textPosition = pos;
      this.showTextInput();
      this.isDrawing = false;
    }
  }

  draw(e) {
    if (!this.isDrawing) return;

    const pos = this.getCanvasPos(e);
    this.currentPoints.push(pos);

    this.clearPreview();

    if (this.currentTool === 'freehand') {
      this.drawFreehand(this.previewCtx, this.currentPoints, this.currentColor, this.currentSize);
    } else if (this.currentTool === 'eraser') {
      this.drawFreehand(this.previewCtx, this.currentPoints, '#ffffff', this.currentSize * 3);
    } else if (this.currentTool === 'line') {
      this.drawLine(this.previewCtx, this.startPoint.x, this.startPoint.y, pos.x, pos.y, this.currentColor, this.currentSize);
    } else if (this.currentTool === 'rect') {
      this.drawRect(this.previewCtx, this.startPoint.x, this.startPoint.y, pos.x - this.startPoint.x, pos.y - this.startPoint.y, this.currentColor, this.currentSize);
    } else if (this.currentTool === 'circle') {
      const radius = Math.sqrt(Math.pow(pos.x - this.startPoint.x, 2) + Math.pow(pos.y - this.startPoint.y, 2));
      this.drawCircle(this.previewCtx, this.startPoint.x, this.startPoint.y, radius, this.currentColor, this.currentSize);
    }
  }

  endDrawing(e) {
    if (!this.isDrawing) return;
    this.isDrawing = false;

    this.clearPreview();

    if (this.currentTool === 'text') return;

    const pos = this.getCanvasPos(e);
    let operation;

    if (this.currentTool === 'freehand' || this.currentTool === 'eraser') {
      if (this.currentPoints.length < 2) return;
      operation = {
        type: this.currentTool,
        points: [...this.currentPoints],
        color: this.currentTool === 'eraser' ? '#ffffff' : this.currentColor,
        size: this.currentTool === 'eraser' ? this.currentSize * 3 : this.currentSize,
        layer: this.currentLayer
      };
    } else if (this.currentTool === 'line') {
      operation = {
        type: 'line',
        x1: this.startPoint.x,
        y1: this.startPoint.y,
        x2: pos.x,
        y2: pos.y,
        color: this.currentColor,
        size: this.currentSize,
        layer: this.currentLayer
      };
    } else if (this.currentTool === 'rect') {
      operation = {
        type: 'rect',
        x: this.startPoint.x,
        y: this.startPoint.y,
        width: pos.x - this.startPoint.x,
        height: pos.y - this.startPoint.y,
        color: this.currentColor,
        size: this.currentSize,
        layer: this.currentLayer
      };
    } else if (this.currentTool === 'circle') {
      const radius = Math.sqrt(Math.pow(pos.x - this.startPoint.x, 2) + Math.pow(pos.y - this.startPoint.y, 2));
      operation = {
        type: 'circle',
        x: this.startPoint.x,
        y: this.startPoint.y,
        radius,
        color: this.currentColor,
        size: this.currentSize,
        layer: this.currentLayer
      };
    }

    if (operation) {
      this.executeOperation(operation);
      this.sendOperation(operation);
    }

    this.currentPoints = [];
  }

  drawFreehand(ctx, points, color, size) {
    if (points.length < 2) return;
    ctx.strokeStyle = color;
    ctx.lineWidth = size;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    for (let i = 1; i < points.length; i++) {
      ctx.lineTo(points[i].x, points[i].y);
    }
    ctx.stroke();
  }

  drawLine(ctx, x1, y1, x2, y2, color, size) {
    ctx.strokeStyle = color;
    ctx.lineWidth = size;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
  }

  drawRect(ctx, x, y, width, height, color, size) {
    ctx.strokeStyle = color;
    ctx.lineWidth = size;
    ctx.strokeRect(x, y, width, height);
  }

  drawCircle(ctx, x, y, radius, color, size) {
    ctx.strokeStyle = color;
    ctx.lineWidth = size;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.stroke();
  }

  drawText(ctx, x, y, text, color, size) {
    ctx.fillStyle = color;
    ctx.font = `${size}px Arial, sans-serif`;
    ctx.textBaseline = 'top';
    ctx.fillText(text, x, y);
  }

  clearPreview() {
    this.previewCtx.clearRect(0, 0, this.previewCanvas.width, this.previewCanvas.height);
  }

  executeOperation(operation) {
    const layer = operation.layer || 'middle';
    if (!this.layers[layer]) return;

    this.layers[layer].operations.push(operation);
    this.operations.push(operation);
    this.undoStack.push(operation);
    this.redoStack = [];

    this.drawOperationOnLayer(operation, layer);
  }

  drawOperationOnLayer(operation, layer) {
    const { ctx } = this.canvasMap[layer];
    this.drawOperation(ctx, operation);
  }

  drawOperation(ctx, operation) {
    switch (operation.type) {
      case 'freehand':
      case 'eraser':
        if (operation.points) {
          this.drawFreehand(ctx, operation.points, operation.color, operation.size);
        }
        break;
      case 'line':
        this.drawLine(ctx, operation.x1, operation.y1, operation.x2, operation.y2, operation.color, operation.size);
        break;
      case 'rect':
        this.drawRect(ctx, operation.x, operation.y, operation.width, operation.height, operation.color, operation.size);
        break;
      case 'circle':
        this.drawCircle(ctx, operation.x, operation.y, operation.radius, operation.color, operation.size);
        break;
      case 'text':
        this.drawText(ctx, operation.x, operation.y, operation.text, operation.color, operation.size);
        break;
    }
  }

  undo() {
    if (this.undoStack.length === 0) return;
    if (this.isLocked && !this.isOwner) return;

    const lastOp = this.undoStack.pop();
    this.redoStack.push(lastOp);

    this.removeOperation(lastOp);

    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({
        type: 'undo_operation'
      }));
    }
  }

  redo() {
    if (this.redoStack.length === 0) return;
    if (this.isLocked && !this.isOwner) return;

    const op = this.redoStack.pop();
    this.undoStack.push(op);
    this.executeOperation(op);
  }

  removeOperation(operation) {
    const layer = operation.layer || 'middle';
    if (!this.layers[layer]) return;

    const layerOps = this.layers[layer].operations;
    const idx = layerOps.indexOf(operation);
    if (idx !== -1) {
      layerOps.splice(idx, 1);
    }

    const opIdx = this.operations.indexOf(operation);
    if (opIdx !== -1) {
      this.operations.splice(opIdx, 1);
    }

    this.redrawLayer(layer);
  }

  redrawLayer(layer) {
    const { canvas, ctx } = this.canvasMap[layer];
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    if (!this.layers[layer].visible) return;

    ctx.globalAlpha = this.layers[layer].opacity / 100;
    for (const op of this.layers[layer].operations) {
      this.drawOperation(ctx, op);
    }
    ctx.globalAlpha = 1;
  }

  redrawAll() {
    for (const layer of ['background', 'middle', 'foreground']) {
      this.redrawLayer(layer);
    }
  }

  updateLayerVisibility(layer) {
    const { canvas } = this.canvasMap[layer];
    canvas.style.display = this.layers[layer].visible ? 'block' : 'none';
    this.redrawLayer(layer);
  }

  showTextInput() {
    document.getElementById('textInput').value = '';
    document.getElementById('textInputModal').classList.remove('hidden');
    document.getElementById('textInput').focus();
  }

  confirmText() {
    const text = document.getElementById('textInput').value.trim();
    if (!text) {
      document.getElementById('textInputModal').classList.add('hidden');
      return;
    }

    const operation = {
      type: 'text',
      x: this.textPosition.x,
      y: this.textPosition.y,
      text,
      color: this.currentColor,
      size: 24,
      layer: this.currentLayer
    };

    this.executeOperation(operation);
    this.sendOperation(operation);
    document.getElementById('textInputModal').classList.add('hidden');
  }

  createRoom() {
    const name = document.getElementById('userName').value.trim() || '匿名用户';
    this.userName = name;
    this.connectWebSocket();
    this.ws.onopen = () => {
      this.ws.send(JSON.stringify({
        type: 'create_room',
        userName: name
      }));
    };
  }

  joinRoom() {
    const name = document.getElementById('userName').value.trim() || '匿名用户';
    const roomCode = document.getElementById('roomCodeInput').value.trim().toUpperCase();
    if (!roomCode) {
      alert('请输入房间号');
      return;
    }
    this.userName = name;
    this.connectWebSocket();
    this.ws.onopen = () => {
      this.ws.send(JSON.stringify({
        type: 'join_room',
        roomCode,
        userName: name
      }));
    };
  }

  connectWebSocket() {
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//localhost:8446`;
    this.ws = new WebSocket(wsUrl);

    this.ws.onmessage = (event) => {
      const data = JSON.parse(event.data);
      this.handleMessage(data);
    };

    this.ws.onerror = (error) => {
      console.error('WebSocket error:', error);
      alert('连接失败，请刷新页面重试');
    };

    this.ws.onclose = () => {
      console.log('WebSocket连接关闭');
    };
  }

  handleMessage(data) {
    switch (data.type) {
      case 'room_created':
      case 'room_joined':
        this.onRoomJoined(data);
        break;
      case 'error':
        alert(data.message);
        break;
      case 'user_list':
        this.updateUserList(data.users);
        break;
      case 'draw_operation':
        if (data.operation.userId !== this.userId) {
          this.receiveOperation(data.operation, data.layer);
        }
        break;
      case 'full_state':
        this.loadFullState(data.operations);
        break;
      case 'canvas_cleared':
        this.clearAllLayers();
        break;
      case 'kicked':
        alert('你已被管理员移出房间');
        location.reload();
        break;
      case 'lock_changed':
        this.onLockChanged(data.isLocked);
        break;
      case 'layer_visibility':
        this.layers[data.layer].visible = data.visible;
        const checkbox = document.querySelector(`.layer-visible[data-layer="${data.layer}"]`);
        if (checkbox) checkbox.checked = data.visible;
        this.updateLayerVisibility(data.layer);
        break;
      case 'layer_opacity':
        this.layers[data.layer].opacity = data.opacity;
        const slider = document.querySelector(`.opacity-slider[data-layer="${data.layer}"]`);
        if (slider) {
          slider.value = data.opacity;
          const valueSpan = slider.parentElement.querySelector('.opacity-value');
          if (valueSpan) valueSpan.textContent = data.opacity + '%';
        }
        this.redrawLayer(data.layer);
        break;
      case 'undo_operation':
        this.removeRemoteUndo(data.timestamp, data.userId);
        break;
      case 'snapshot_loaded':
        break;
      case 'all_operations':
        if (this.replayMode) {
          this.replayOperations = data.operations;
          document.getElementById('replayProgress').max = data.operations.length;
          document.getElementById('replayStatus').textContent = `0 / ${data.operations.length} 笔`;
        }
        break;
    }
  }

  onRoomJoined(data) {
    this.roomCode = data.roomCode;
    this.userId = data.userId;
    this.userColor = data.userColor;
    this.isOwner = data.isOwner;
    this.isLocked = data.isLocked;

    if (data.layers) {
      for (const [layer, info] of Object.entries(data.layers)) {
        if (this.layers[layer]) {
          this.layers[layer].visible = info.visible;
          this.layers[layer].opacity = info.opacity;
          const checkbox = document.querySelector(`.layer-visible[data-layer="${layer}"]`);
          if (checkbox) checkbox.checked = info.visible;
          const slider = document.querySelector(`.opacity-slider[data-layer="${layer}"]`);
          if (slider) {
            slider.value = info.opacity;
            const valueSpan = slider.parentElement.querySelector('.opacity-value');
            if (valueSpan) valueSpan.textContent = info.opacity + '%';
          }
        }
      }
    }

    document.getElementById('loginModal').classList.add('hidden');
    document.getElementById('app').classList.remove('hidden');
    document.getElementById('roomCodeDisplay').textContent = this.roomCode;

    this.updateLockStatus();

    if (this.isOwner) {
      document.getElementById('adminSection').style.display = 'block';
    } else {
      document.getElementById('adminSection').style.display = 'none';
    }
  }

  updateUserList(users) {
    this.users = users;
    document.getElementById('userCount').textContent = users.length;

    const container = document.getElementById('userList');
    container.innerHTML = '';

    users.forEach(user => {
      const div = document.createElement('div');
      div.className = 'user-item';

      const infoDiv = document.createElement('div');
      infoDiv.className = 'user-info';

      const colorDot = document.createElement('div');
      colorDot.className = 'user-color-dot';
      colorDot.style.background = user.color;

      const nameSpan = document.createElement('span');
      nameSpan.className = 'user-name';
      nameSpan.textContent = user.name;

      infoDiv.appendChild(colorDot);
      infoDiv.appendChild(nameSpan);

      if (user.isOwner) {
        const badge = document.createElement('span');
        badge.className = 'user-owner-badge';
        badge.textContent = '房主';
        infoDiv.appendChild(badge);
      }

      div.appendChild(infoDiv);

      if (this.isOwner && user.id !== this.userId) {
        const kickBtn = document.createElement('button');
        kickBtn.className = 'user-kick-btn';
        kickBtn.textContent = '✕';
        kickBtn.title = '踢出用户';
        kickBtn.addEventListener('click', () => this.kickUser(user.id));
        div.appendChild(kickBtn);
      }

      container.appendChild(div);
    });
  }

  sendOperation(operation) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    this.ws.send(JSON.stringify({
      type: 'draw_operation',
      operation,
      layer: operation.layer || 'middle'
    }));
  }

  receiveOperation(operation, layer) {
    const targetLayer = layer || operation.layer || 'middle';
    if (!this.layers[targetLayer]) return;

    operation.layer = targetLayer;
    this.layers[targetLayer].operations.push(operation);
    this.operations.push(operation);
    this.drawOperationOnLayer(operation, targetLayer);
  }

  removeRemoteUndo(timestamp, userId) {
    for (const layer of ['background', 'middle', 'foreground']) {
      const ops = this.layers[layer].operations;
      for (let i = ops.length - 1; i >= 0; i--) {
        if (ops[i].timestamp === timestamp && ops[i].userId === userId) {
          ops.splice(i, 1);
          this.redrawLayer(layer);
          return;
        }
      }
    }
  }

  loadFullState(operations) {
    this.clearAllLayers();
    this.operations = [];
    this.undoStack = [];
    this.redoStack = [];

    for (const op of operations) {
      const layer = op.layer || 'middle';
      if (!this.layers[layer]) continue;
      this.layers[layer].operations.push(op);
      this.operations.push(op);
      this.drawOperationOnLayer(op, layer);
    }
  }

  clearAllLayers() {
    for (const layer of ['background', 'middle', 'foreground']) {
      this.layers[layer].operations = [];
      const { canvas, ctx } = this.canvasMap[layer];
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    }
    this.operations = [];
    this.undoStack = [];
    this.redoStack = [];
  }

  clearCanvas() {
    if (!this.isOwner) return;
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({
        type: 'clear_canvas'
      }));
    }
    this.clearAllLayers();
  }

  kickUser(userId) {
    if (!this.isOwner) return;
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({
        type: 'kick_user',
        targetUserId: userId
      }));
    }
  }

  toggleLock() {
    if (!this.isOwner) return;
    this.isLocked = !this.isLocked;
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({
        type: 'toggle_lock',
        isLocked: this.isLocked
      }));
    }
    this.updateLockStatus();
  }

  onLockChanged(isLocked) {
    this.isLocked = isLocked;
    this.updateLockStatus();
  }

  updateLockStatus() {
    const statusEl = document.getElementById('lockStatus');
    const overlay = document.getElementById('readonlyOverlay');
    const lockBtn = document.getElementById('toggleLockBtn');

    if (this.isLocked) {
      statusEl.textContent = '🔒 已锁定';
      statusEl.classList.add('locked');
      lockBtn.textContent = '解锁画布';
      if (!this.isOwner) {
        overlay.classList.remove('hidden');
      }
    } else {
      statusEl.textContent = '🔓 可编辑';
      statusEl.classList.remove('locked');
      lockBtn.textContent = '锁定画布';
      overlay.classList.add('hidden');
    }
  }

  startReplayMode() {
    if (!this.isOwner) return;
    this.replayMode = true;
    this.replayIndex = 0;

    this.clearAllLayers();

    document.getElementById('replayModal').classList.remove('hidden');

    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({
        type: 'get_all_operations'
      }));
    }

    this.replayOperations = [...this.operations];
    document.getElementById('replayProgress').max = this.replayOperations.length;
    document.getElementById('replayStatus').textContent = `0 / ${this.replayOperations.length} 笔`;
  }

  playReplay() {
    if (this.replayIndex >= this.replayOperations.length) return;
    if (this.replayTimer) return;

    this.replayTimer = setInterval(() => {
      if (this.replayIndex >= this.replayOperations.length) {
        this.pauseReplay();
        return;
      }
      const op = this.replayOperations[this.replayIndex];
      const layer = op.layer || 'middle';
      if (this.layers[layer]) {
        this.layers[layer].operations.push(op);
        this.drawOperationOnLayer(op, layer);
      }
      this.replayIndex++;
      document.getElementById('replayProgress').value = this.replayIndex;
      document.getElementById('replayStatus').textContent = `${this.replayIndex} / ${this.replayOperations.length} 笔`;
    }, 300 / this.replaySpeed);
  }

  pauseReplay() {
    if (this.replayTimer) {
      clearInterval(this.replayTimer);
      this.replayTimer = null;
    }
  }

  resetReplay() {
    this.pauseReplay();
    this.replayIndex = 0;
    this.clearAllLayers();
    document.getElementById('replayProgress').value = 0;
    document.getElementById('replayStatus').textContent = `0 / ${this.replayOperations.length} 笔`;
  }

  closeReplay() {
    this.pauseReplay();
    this.replayMode = false;
    document.getElementById('replayModal').classList.add('hidden');
    this.redrawAll();
  }

  exportPNG() {
    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = 1200;
    tempCanvas.height = 800;
    const tempCtx = tempCanvas.getContext('2d');

    tempCtx.fillStyle = 'white';
    tempCtx.fillRect(0, 0, 1200, 800);

    for (const layer of ['background', 'middle', 'foreground']) {
      if (this.layers[layer].visible) {
        tempCtx.globalAlpha = this.layers[layer].opacity / 100;
        tempCtx.drawImage(this.canvasMap[layer].canvas, 0, 0);
      }
    }
    tempCtx.globalAlpha = 1;

    const link = document.createElement('a');
    link.download = `画板_${this.roomCode}_${Date.now()}.png`;
    link.href = tempCanvas.toDataURL('image/png');
    link.click();
  }

  exportSVG() {
    let svgContent = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="800" viewBox="0 0 1200 800">`;
    svgContent += `<rect width="1200" height="800" fill="white"/>`;

    for (const layer of ['background', 'middle', 'foreground']) {
      if (!this.layers[layer].visible) continue;
      const opacity = this.layers[layer].opacity / 100;
      svgContent += `<g opacity="${opacity}">`;

      for (const op of this.layers[layer].operations) {
        svgContent += this.operationToSVG(op);
      }

      svgContent += `</g>`;
    }

    svgContent += `</svg>`;

    const blob = new Blob([svgContent], { type: 'image/svg+xml' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.download = `画板_${this.roomCode}_${Date.now()}.svg`;
    link.href = url;
    link.click();
    URL.revokeObjectURL(url);
  }

  operationToSVG(op) {
    switch (op.type) {
      case 'freehand':
      case 'eraser':
        if (!op.points || op.points.length < 2) return '';
        let d = `M ${op.points[0].x} ${op.points[0].y}`;
        for (let i = 1; i < op.points.length; i++) {
          d += ` L ${op.points[i].x} ${op.points[i].y}`;
        }
        return `<path d="${d}" stroke="${op.color}" stroke-width="${op.size}" stroke-linecap="round" stroke-linejoin="round" fill="none"/>`;

      case 'line':
        return `<line x1="${op.x1}" y1="${op.y1}" x2="${op.x2}" y2="${op.y2}" stroke="${op.color}" stroke-width="${op.size}" stroke-linecap="round"/>`;

      case 'rect':
        return `<rect x="${op.x}" y="${op.y}" width="${op.width}" height="${op.height}" stroke="${op.color}" stroke-width="${op.size}" fill="none"/>`;

      case 'circle':
        return `<circle cx="${op.x}" cy="${op.y}" r="${op.radius}" stroke="${op.color}" stroke-width="${op.size}" fill="none"/>`;

      case 'text':
        return `<text x="${op.x}" y="${op.y}" fill="${op.color}" font-size="${op.size}" font-family="Arial, sans-serif">${this.escapeHtml(op.text || '')}</text>`;

      default:
        return '';
    }
  }

  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  loadSnapshots() {
    if (!this.roomCode) return;
    fetch(`/api/snapshots/${this.roomCode}`)
      .then(res => res.json())
      .then(snapshots => {
        const container = document.getElementById('snapshotList');
        container.innerHTML = '';
        snapshots.forEach(snapshot => {
          const div = document.createElement('div');
          div.className = 'snapshot-item';
          const date = new Date(snapshot.created_at);
          div.textContent = date.toLocaleString('zh-CN');
          div.addEventListener('click', () => this.loadSnapshot(snapshot.id));
          container.appendChild(div);
        });
        if (snapshots.length === 0) {
          container.innerHTML = '<p style="font-size:12px;color:#999;">暂无快照</p>';
        }
      });
  }

  loadSnapshot(snapshotId) {
    if (!this.roomCode) return;
    if (!confirm('确定要加载此快照吗？当前画布内容将被替换。')) return;

    fetch(`/api/snapshots/${this.roomCode}/${snapshotId}`)
      .then(res => res.json())
      .then(data => {
        if (data.operations) {
          this.loadFullState(data.operations);
        }
        if (data.layers) {
          for (const [layer, info] of Object.entries(data.layers)) {
            if (this.layers[layer]) {
              this.layers[layer].visible = info.visible ?? true;
              this.layers[layer].opacity = info.opacity ?? 100;
            }
          }
          this.redrawAll();
        }
      });
  }
}

document.addEventListener('DOMContentLoaded', () => {
  window.whiteboard = new Whiteboard();
});
