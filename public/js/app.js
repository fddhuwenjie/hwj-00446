class Whiteboard {
  constructor() {
    this.currentTool = 'freehand';
    this.currentColor = '#000000';
    this.currentSize = 3;
    this.currentLayer = 'middle';
    this.brushMode = 'normal';
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

    this.viewport = {
      scale: 1,
      offsetX: 0,
      offsetY: 0,
      minScale: 0.25,
      maxScale: 4
    };

    this.selection = {
      active: false,
      startX: 0,
      startY: 0,
      endX: 0,
      endY: 0,
      selectedIds: [],
      isDragging: false,
      dragStartX: 0,
      dragStartY: 0,
      lastOffsetX: 0,
      lastOffsetY: 0
    };

    this.clipboard = [];
    this.clipboardOffset = { x: 0, y: 0 };

    this.remoteCursors = new Map();
    this.remoteViewports = new Map();
    this.followingUserId = null;
    this.isPanning = false;
    this.panStartX = 0;
    this.panStartY = 0;
    this.spacePressed = false;

    this.users = [];

    this.replayMode = false;
    this.replayOperations = [];
    this.replayIndex = 0;
    this.replayTimer = null;
    this.replaySpeed = 1;

    this.ws = null;
    this.roomCode = null;
    this.userId = null;
    this.userName = '';
    this.userColor = '';
    this.isOwner = false;
    this.isLocked = false;

    this.cursorThrottleTimer = null;
    this.lastCursorSent = 0;

    this.selectionRectElement = null;

    this.initCanvas();
    this.bindEvents();
  }

  initCanvas() {
    this.bgCanvas = document.getElementById('bgCanvas');
    this.middleCanvas = document.getElementById('middleCanvas');
    this.fgCanvas = document.getElementById('fgCanvas');
    this.previewCanvas = document.getElementById('previewCanvas');
    this.canvasWrapper = document.querySelector('.canvas-wrapper');
    this.cursorsContainer = document.getElementById('cursorsContainer');

    this.bgCtx = this.bgCanvas.getContext('2d');
    this.middleCtx = this.middleCanvas.getContext('2d');
    this.fgCtx = this.fgCanvas.getContext('2d');
    this.previewCtx = this.previewCanvas.getContext('2d');

    this.canvasMap = {
      background: { canvas: this.bgCanvas, ctx: this.bgCtx },
      middle: { canvas: this.middleCanvas, ctx: this.middleCtx },
      foreground: { canvas: this.fgCanvas, ctx: this.fgCtx }
    };

    this.resizeCanvases();
    window.addEventListener('resize', () => this.resizeCanvases());
  }

  resizeCanvases() {
    const width = this.canvasWrapper.clientWidth;
    const height = this.canvasWrapper.clientHeight;

    [this.bgCanvas, this.middleCanvas, this.fgCanvas, this.previewCanvas].forEach(canvas => {
      canvas.width = width;
      canvas.height = height;
      canvas.style.width = width + 'px';
      canvas.style.height = height + 'px';
    });

    this.redrawAll();
    this.updateViewportInfo();
  }

  screenToWorld(screenX, screenY) {
    return {
      x: (screenX - this.viewport.offsetX) / this.viewport.scale,
      y: (screenY - this.viewport.offsetY) / this.viewport.scale
    };
  }

  worldToScreen(worldX, worldY) {
    return {
      x: worldX * this.viewport.scale + this.viewport.offsetX,
      y: worldY * this.viewport.scale + this.viewport.offsetY
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
        this.clearSelection();
        if (this.currentTool === 'select') {
          this.previewCanvas.style.cursor = 'default';
        } else {
          this.previewCanvas.style.cursor = 'crosshair';
        }
      });
    });

    document.querySelectorAll('.brush-mode-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.brush-mode-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.brushMode = btn.dataset.brushMode;
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

    this.previewCanvas.addEventListener('mousedown', (e) => this.onMouseDown(e));
    this.previewCanvas.addEventListener('mousemove', (e) => this.onMouseMove(e));
    this.previewCanvas.addEventListener('mouseup', (e) => this.onMouseUp(e));
    this.previewCanvas.addEventListener('mouseleave', (e) => this.onMouseUp(e));
    this.previewCanvas.addEventListener('wheel', (e) => this.onWheel(e), { passive: false });
    this.previewCanvas.addEventListener('contextmenu', (e) => e.preventDefault());

    document.addEventListener('mousedown', (e) => {
      if (e.button === 1) {
        e.preventDefault();
        this.startPanning(e.clientX, e.clientY);
      }
    });

    document.addEventListener('mousemove', (e) => {
      if (this.isPanning) {
        this.onPanMove(e.clientX, e.clientY);
      }
    });

    document.addEventListener('mouseup', (e) => {
      if (e.button === 1) {
        this.stopPanning();
      }
    });

    document.addEventListener('keydown', (e) => this.onKeyDown(e));
    document.addEventListener('keyup', (e) => this.onKeyUp(e));

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

    document.getElementById('deleteSelectionBtn').addEventListener('click', () => this.deleteSelection());
    document.getElementById('copySelectionBtn').addEventListener('click', () => this.copySelection());
    document.getElementById('pasteSelectionBtn').addEventListener('click', () => this.pasteSelection());
  }

  onKeyDown(e) {
    if (e.key === ' ' && !this.spacePressed && !e.repeat) {
      e.preventDefault();
      this.spacePressed = true;
      this.canvasWrapper.classList.add('grab');
    }

    if ((e.ctrlKey || e.metaKey)) {
      if (e.key === 'c' || e.key === 'C') {
        e.preventDefault();
        if (this.selection.selectedIds.length > 0) {
          this.copySelection();
        }
      } else if (e.key === 'v' || e.key === 'V') {
        e.preventDefault();
        if (this.clipboard.length > 0) {
          this.pasteSelection();
        }
      } else if (e.key === 'z' || e.key === 'Z') {
        e.preventDefault();
        if (e.shiftKey) {
          this.redo();
        } else {
          this.undo();
        }
      } else if (e.key === 'y' || e.key === 'Y') {
        e.preventDefault();
        this.redo();
      } else if (e.key === 'a' || e.key === 'A') {
        e.preventDefault();
        this.selectAll();
      }
    }

    if (e.key === 'Delete' || e.key === 'Backspace') {
      if (this.selection.selectedIds.length > 0 && document.activeElement.tagName !== 'INPUT' && document.activeElement.tagName !== 'TEXTAREA') {
        e.preventDefault();
        this.deleteSelection();
      }
    }

    if (e.key === 'Escape') {
      this.clearSelection();
    }
  }

  onKeyUp(e) {
    if (e.key === ' ') {
      this.spacePressed = false;
      this.canvasWrapper.classList.remove('grab', 'grabbing');
      if (this.isPanning) {
        this.stopPanning();
      }
    }
  }

  onWheel(e) {
    e.preventDefault();
    if (this.followingUserId) return;

    const rect = this.previewCanvas.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    const worldBefore = this.screenToWorld(mouseX, mouseY);

    const delta = e.deltaY > 0 ? 0.9 : 1.1;
    let newScale = this.viewport.scale * delta;
    newScale = Math.max(this.viewport.minScale, Math.min(this.viewport.maxScale, newScale));

    const scaleChange = newScale / this.viewport.scale;
    this.viewport.scale = newScale;

    const worldAfter = this.screenToWorld(mouseX, mouseY);
    this.viewport.offsetX += (worldAfter.x - worldBefore.x) * this.viewport.scale;
    this.viewport.offsetY += (worldAfter.y - worldBefore.y) * this.viewport.scale;

    this.redrawAll();
    this.updateViewportInfo();
    this.updateSelectionRect();
    this.updateRemoteCursors();
    this.sendViewportSync();
  }

  startPanning(clientX, clientY) {
    if (this.followingUserId) return;
    this.isPanning = true;
    this.panStartX = clientX - this.viewport.offsetX;
    this.panStartY = clientY - this.viewport.offsetY;
    this.canvasWrapper.classList.add('grabbing');
    this.previewCanvas.style.cursor = 'grabbing';
  }

  onPanMove(clientX, clientY) {
    if (!this.isPanning || this.followingUserId) return;
    this.viewport.offsetX = clientX - this.panStartX;
    this.viewport.offsetY = clientY - this.panStartY;
    this.redrawAll();
    this.updateViewportInfo();
    this.updateSelectionRect();
    this.updateRemoteCursors();
    this.sendViewportSync();
  }

  stopPanning() {
    this.isPanning = false;
    this.canvasWrapper.classList.remove('grabbing');
    if (this.currentTool === 'select') {
      this.previewCanvas.style.cursor = 'default';
    } else {
      this.previewCanvas.style.cursor = 'crosshair';
    }
  }

  getCanvasPos(e) {
    const rect = this.previewCanvas.getBoundingClientRect();
    const scaleX = this.previewCanvas.width / rect.width;
    const scaleY = this.previewCanvas.height / rect.height;
    const screenX = (e.clientX - rect.left) * scaleX;
    const screenY = (e.clientY - rect.top) * scaleY;
    return this.screenToWorld(screenX, screenY);
  }

  onMouseDown(e) {
    if (this.isLocked && !this.isOwner) return;
    if (this.replayMode) return;

    if (this.spacePressed && e.button === 0) {
      e.preventDefault();
      this.startPanning(e.clientX, e.clientY);
      return;
    }

    if (e.button !== 0) return;

    const pos = this.getCanvasPos(e);
    const screenPos = {
      x: (e.clientX - this.previewCanvas.getBoundingClientRect().left) * (this.previewCanvas.width / this.previewCanvas.getBoundingClientRect().width),
      y: (e.clientY - this.previewCanvas.getBoundingClientRect().top) * (this.previewCanvas.height / this.previewCanvas.getBoundingClientRect().height)
    };

    if (this.currentTool === 'select') {
      if (this.isPointInSelection(screenPos)) {
        this.selection.isDragging = true;
        this.selection.dragStartX = pos.x;
        this.selection.dragStartY = pos.y;
        this.selection.lastOffsetX = 0;
        this.selection.lastOffsetY = 0;
      } else {
        this.clearSelection();
        this.selection.active = true;
        this.selection.startX = screenPos.x;
        this.selection.startY = screenPos.y;
        this.selection.endX = screenPos.x;
        this.selection.endY = screenPos.y;
        this.createSelectionRect();
      }
      return;
    }

    this.isDrawing = true;
    this.startPoint = pos;
    this.currentPoints = [pos];

    if (this.currentTool === 'text') {
      this.textPosition = pos;
      this.showTextInput();
      this.isDrawing = false;
    }
  }

  onMouseMove(e) {
    const pos = this.getCanvasPos(e);
    const screenPos = {
      x: (e.clientX - this.previewCanvas.getBoundingClientRect().left) * (this.previewCanvas.width / this.previewCanvas.getBoundingClientRect().width),
      y: (e.clientY - this.previewCanvas.getBoundingClientRect().top) * (this.previewCanvas.height / this.previewCanvas.getBoundingClientRect().height)
    };

    this.updateCoordinates(pos);
    this.sendCursorMove(pos.x, pos.y, this.isDrawing || this.selection.isDragging);

    if (this.isPanning) return;

    if (this.currentTool === 'select' && this.selection.active) {
      if (this.selection.isDragging) {
        const offsetX = pos.x - this.selection.dragStartX - this.selection.lastOffsetX;
        const offsetY = pos.y - this.selection.dragStartY - this.selection.lastOffsetY;
        
        if (Math.abs(offsetX) > 0.1 || Math.abs(offsetY) > 0.1) {
          this.dragSelection(offsetX, offsetY);
          this.selection.lastOffsetX += offsetX;
          this.selection.lastOffsetY += offsetY;
        }
      } else {
        this.selection.endX = screenPos.x;
        this.selection.endY = screenPos.y;
        this.updateSelectionRect();
      }
      return;
    }

    if (!this.isDrawing) return;

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

  onMouseUp(e) {
    if (this.isPanning) {
      if (this.spacePressed) {
        this.canvasWrapper.classList.remove('grabbing');
        this.canvasWrapper.classList.add('grab');
      }
      this.isPanning = false;
      return;
    }

    if (this.currentTool === 'select' && this.selection.active) {
      if (this.selection.isDragging) {
        this.selection.isDragging = false;
        if (Math.abs(this.selection.lastOffsetX) > 0.1 || Math.abs(this.selection.lastOffsetY) > 0.1) {
          this.sendMoveOperations(this.selection.lastOffsetX, this.selection.lastOffsetY);
        }
      } else {
        this.selectOperationsInRect();
      }
      return;
    }

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
        layer: this.currentLayer,
        brushMode: this.brushMode
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
        layer: this.currentLayer,
        brushMode: this.brushMode
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
        layer: this.currentLayer,
        brushMode: this.brushMode
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
        layer: this.currentLayer,
        brushMode: this.brushMode
      };
    }

    if (operation) {
      this.executeOperation(operation);
      this.sendOperation(operation);
    }

    this.currentPoints = [];
  }

  applyBrushStyle(ctx, brushMode) {
    ctx.globalAlpha = 1;
    ctx.setLineDash([]);

    if (brushMode === 'dashed') {
      ctx.setLineDash([10, 5]);
    } else if (brushMode === 'highlighter') {
      ctx.globalAlpha = 0.3;
    }
  }

  resetBrushStyle(ctx) {
    ctx.globalAlpha = 1;
    ctx.setLineDash([]);
  }

  drawFreehand(ctx, points, color, size, brushMode = 'normal') {
    if (points.length < 2) return;
    
    ctx.save();
    this.applyBrushStyle(ctx, brushMode);
    
    ctx.strokeStyle = color;
    ctx.lineWidth = size * this.viewport.scale;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    
    const first = this.worldToScreen(points[0].x, points[0].y);
    ctx.moveTo(first.x, first.y);
    
    for (let i = 1; i < points.length; i++) {
      const p = this.worldToScreen(points[i].x, points[i].y);
      ctx.lineTo(p.x, p.y);
    }
    ctx.stroke();
    
    ctx.restore();
  }

  drawLine(ctx, x1, y1, x2, y2, color, size, brushMode = 'normal') {
    ctx.save();
    this.applyBrushStyle(ctx, brushMode);
    
    const p1 = this.worldToScreen(x1, y1);
    const p2 = this.worldToScreen(x2, y2);
    
    ctx.strokeStyle = color;
    ctx.lineWidth = size * this.viewport.scale;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(p1.x, p1.y);
    ctx.lineTo(p2.x, p2.y);
    ctx.stroke();
    
    ctx.restore();
  }

  drawRect(ctx, x, y, width, height, color, size, brushMode = 'normal') {
    ctx.save();
    this.applyBrushStyle(ctx, brushMode);
    
    const p = this.worldToScreen(x, y);
    const w = width * this.viewport.scale;
    const h = height * this.viewport.scale;
    
    ctx.strokeStyle = color;
    ctx.lineWidth = size * this.viewport.scale;
    ctx.strokeRect(p.x, p.y, w, h);
    
    ctx.restore();
  }

  drawCircle(ctx, x, y, radius, color, size, brushMode = 'normal') {
    ctx.save();
    this.applyBrushStyle(ctx, brushMode);
    
    const p = this.worldToScreen(x, y);
    const r = radius * this.viewport.scale;
    
    ctx.strokeStyle = color;
    ctx.lineWidth = size * this.viewport.scale;
    ctx.beginPath();
    ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
    ctx.stroke();
    
    ctx.restore();
  }

  drawText(ctx, x, y, text, color, size) {
    const p = this.worldToScreen(x, y);
    ctx.save();
    ctx.fillStyle = color;
    ctx.font = `${size * this.viewport.scale}px Arial, sans-serif`;
    ctx.textBaseline = 'top';
    ctx.fillText(text, p.x, p.y);
    ctx.restore();
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
    const brushMode = operation.brushMode || 'normal';
    switch (operation.type) {
      case 'freehand':
      case 'eraser':
        if (operation.points) {
          this.drawFreehand(ctx, operation.points, operation.color, operation.size, brushMode);
        }
        break;
      case 'line':
        this.drawLine(ctx, operation.x1, operation.y1, operation.x2, operation.y2, operation.color, operation.size, brushMode);
        break;
      case 'rect':
        this.drawRect(ctx, operation.x, operation.y, operation.width, operation.height, operation.color, operation.size, brushMode);
        break;
      case 'circle':
        this.drawCircle(ctx, operation.x, operation.y, operation.radius, operation.color, operation.size, brushMode);
        break;
      case 'text':
        this.drawText(ctx, operation.x, operation.y, operation.text, operation.color, operation.size);
        break;
    }
  }

  createSelectionRect() {
    if (this.selectionRectElement) {
      this.selectionRectElement.remove();
    }
    this.selectionRectElement = document.createElement('div');
    this.selectionRectElement.className = 'selection-rect';
    this.canvasWrapper.appendChild(this.selectionRectElement);
  }

  updateSelectionRect() {
    if (!this.selectionRectElement || !this.selection.active) return;

    const left = Math.min(this.selection.startX, this.selection.endX);
    const top = Math.min(this.selection.startY, this.selection.endY);
    const width = Math.abs(this.selection.endX - this.selection.startX);
    const height = Math.abs(this.selection.endY - this.selection.startY);

    this.selectionRectElement.style.left = left + 'px';
    this.selectionRectElement.style.top = top + 'px';
    this.selectionRectElement.style.width = width + 'px';
    this.selectionRectElement.style.height = height + 'px';
  }

  clearSelection() {
    this.selection.active = false;
    this.selection.selectedIds = [];
    this.selection.isDragging = false;
    if (this.selectionRectElement) {
      this.selectionRectElement.remove();
      this.selectionRectElement = null;
    }
    document.getElementById('selectionActions').style.display = 'none';
  }

  getOperationBounds(op) {
    switch (op.type) {
      case 'freehand':
      case 'eraser':
        if (!op.points || op.points.length === 0) return null;
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (const p of op.points) {
          minX = Math.min(minX, p.x);
          minY = Math.min(minY, p.y);
          maxX = Math.max(maxX, p.x);
          maxY = Math.max(maxY, p.y);
        }
        return { minX, minY, maxX, maxY };
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

  selectOperationsInRect() {
    const worldStart = this.screenToWorld(this.selection.startX, this.selection.startY);
    const worldEnd = this.screenToWorld(this.selection.endX, this.selection.endY);

    const rectMinX = Math.min(worldStart.x, worldEnd.x);
    const rectMinY = Math.min(worldStart.y, worldEnd.y);
    const rectMaxX = Math.max(worldStart.x, worldEnd.x);
    const rectMaxY = Math.max(worldStart.y, worldEnd.y);

    this.selection.selectedIds = [];

    for (const op of this.operations) {
      const bounds = this.getOperationBounds(op);
      if (!bounds) continue;

      if (bounds.minX >= rectMinX && bounds.maxX <= rectMaxX &&
          bounds.minY >= rectMinY && bounds.maxY <= rectMaxY) {
        this.selection.selectedIds.push(op.timestamp);
      }
    }

    if (this.selection.selectedIds.length > 0) {
      document.getElementById('selectionActions').style.display = 'block';
    } else {
      this.clearSelection();
    }
  }

  selectAll() {
    this.selection.active = true;
    this.selection.selectedIds = this.operations.map(op => op.timestamp);
    
    if (this.operations.length > 0) {
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const op of this.operations) {
        const bounds = this.getOperationBounds(op);
        if (bounds) {
          minX = Math.min(minX, bounds.minX);
          minY = Math.min(minY, bounds.minY);
          maxX = Math.max(maxX, bounds.maxX);
          maxY = Math.max(maxY, bounds.maxY);
        }
      }
      
      const screenMin = this.worldToScreen(minX, minY);
      const screenMax = this.worldToScreen(maxX, maxY);
      
      this.selection.startX = screenMin.x;
      this.selection.startY = screenMin.y;
      this.selection.endX = screenMax.x;
      this.selection.endY = screenMax.y;
      
      this.createSelectionRect();
      this.updateSelectionRect();
      document.getElementById('selectionActions').style.display = 'block';
    }
  }

  isPointInSelection(screenPos) {
    if (!this.selection.active || this.selection.selectedIds.length === 0) return false;

    const left = Math.min(this.selection.startX, this.selection.endX);
    const right = Math.max(this.selection.startX, this.selection.endX);
    const top = Math.min(this.selection.startY, this.selection.endY);
    const bottom = Math.max(this.selection.startY, this.selection.endY);

    return screenPos.x >= left && screenPos.x <= right && 
           screenPos.y >= top && screenPos.y <= bottom;
  }

  dragSelection(offsetX, offsetY) {
    for (const op of this.operations) {
      if (this.selection.selectedIds.includes(op.timestamp)) {
        this.offsetOperation(op, offsetX, offsetY);
      }
    }
    for (const layer of Object.values(this.layers)) {
      for (const op of layer.operations) {
        if (this.selection.selectedIds.includes(op.timestamp)) {
          this.offsetOperation(op, offsetX, offsetY);
        }
      }
    }
    
    this.selection.startX += offsetX * this.viewport.scale;
    this.selection.startY += offsetY * this.viewport.scale;
    this.selection.endX += offsetX * this.viewport.scale;
    this.selection.endY += offsetY * this.viewport.scale;
    
    this.redrawAll();
    this.updateSelectionRect();
  }

  offsetOperation(op, offsetX, offsetY) {
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

  deleteSelection() {
    if (this.selection.selectedIds.length === 0) return;
    if (this.isLocked && !this.isOwner) return;

    for (const layer of Object.values(this.layers)) {
      layer.operations = layer.operations.filter(op => !this.selection.selectedIds.includes(op.timestamp));
    }
    this.operations = this.operations.filter(op => !this.selection.selectedIds.includes(op.timestamp));

    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({
        type: 'delete_operations',
        operationIds: [...this.selection.selectedIds]
      }));
    }

    this.redrawAll();
    this.clearSelection();
  }

  copySelection() {
    if (this.selection.selectedIds.length === 0) return;

    this.clipboard = [];
    let minX = Infinity, minY = Infinity;

    for (const op of this.operations) {
      if (this.selection.selectedIds.includes(op.timestamp)) {
        const bounds = this.getOperationBounds(op);
        if (bounds) {
          minX = Math.min(minX, bounds.minX);
          minY = Math.min(minY, bounds.minY);
        }
        this.clipboard.push(JSON.parse(JSON.stringify(op)));
      }
    }

    this.clipboardOffset = { x: minX, y: minY };
  }

  pasteSelection() {
    if (this.clipboard.length === 0) return;
    if (this.isLocked && !this.isOwner) return;

    const pastedIds = [];
    const offset = { x: 20, y: 20 };

    for (const clipOp of this.clipboard) {
      const newOp = JSON.parse(JSON.stringify(clipOp));
      newOp.timestamp = Date.now() + Math.random();
      newOp.userId = this.userId;
      this.offsetOperation(newOp, offset.x - this.clipboardOffset.x + newOp.timestamp % 100, offset.y - this.clipboardOffset.y + newOp.timestamp % 100);
      
      const layer = newOp.layer || 'middle';
      if (this.layers[layer]) {
        this.layers[layer].operations.push(newOp);
      }
      this.operations.push(newOp);
      this.undoStack.push(newOp);
      pastedIds.push(newOp.timestamp);
      
      this.sendOperation(newOp);
    }

    this.redrawAll();

    this.selection.selectedIds = pastedIds;
    this.selection.active = true;
    this.createSelectionRect();
    
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const id of pastedIds) {
      const op = this.operations.find(o => o.timestamp === id);
      if (op) {
        const bounds = this.getOperationBounds(op);
        if (bounds) {
          minX = Math.min(minX, bounds.minX);
          minY = Math.min(minY, bounds.minY);
          maxX = Math.max(maxX, bounds.maxX);
          maxY = Math.max(maxY, bounds.maxY);
        }
      }
    }
    
    const screenMin = this.worldToScreen(minX, minY);
    const screenMax = this.worldToScreen(maxX, maxY);
    this.selection.startX = screenMin.x;
    this.selection.startY = screenMin.y;
    this.selection.endX = screenMax.x;
    this.selection.endY = screenMax.y;
    this.updateSelectionRect();
    
    document.getElementById('selectionActions').style.display = 'block';
  }

  sendMoveOperations(offsetX, offsetY) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    this.ws.send(JSON.stringify({
      type: 'move_operations',
      operationIds: [...this.selection.selectedIds],
      offsetX,
      offsetY
    }));
  }

  sendCursorMove(x, y, isDrawing) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    
    const now = Date.now();
    if (now - this.lastCursorSent < 100) return;
    this.lastCursorSent = now;

    this.ws.send(JSON.stringify({
      type: 'cursor_move',
      x,
      y,
      isDrawing,
      scale: this.viewport.scale,
      offsetX: this.viewport.offsetX,
      offsetY: this.viewport.offsetY
    }));
  }

  sendViewportSync() {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    this.ws.send(JSON.stringify({
      type: 'viewport_sync',
      scale: this.viewport.scale,
      offsetX: this.viewport.offsetX,
      offsetY: this.viewport.offsetY
    }));
  }

  updateRemoteCursor(userId, x, y, isDrawing, scale, offsetX, offsetY) {
    this.remoteViewports.set(userId, { scale, offsetX, offsetY });

    if (this.followingUserId === userId) {
      this.viewport.scale = scale;
      this.viewport.offsetX = offsetX;
      this.viewport.offsetY = offsetY;
      this.redrawAll();
      this.updateViewportInfo();
    }

    let cursorEl = this.remoteCursors.get(userId);
    const user = this.users.find(u => u.id === userId);
    
    if (!cursorEl && user) {
      cursorEl = document.createElement('div');
      cursorEl.className = 'remote-cursor';
      cursorEl.innerHTML = `
        <div class="remote-cursor-dot" style="background: ${user.color}"></div>
        <div class="remote-cursor-label">${this.escapeHtml(user.name)}</div>
        <div class="remote-cursor-brush-icon" style="display: none;">✏️</div>
      `;
      this.cursorsContainer.appendChild(cursorEl);
      this.remoteCursors.set(userId, cursorEl);
    }

    if (cursorEl) {
      const screenPos = this.worldToScreen(x, y);
      cursorEl.style.transform = `translate(${screenPos.x - 6}px, ${screenPos.y - 6}px)`;
      
      const brushIcon = cursorEl.querySelector('.remote-cursor-brush-icon');
      if (brushIcon) {
        brushIcon.style.display = isDrawing ? 'block' : 'none';
      }
    }
  }

  updateRemoteCursors() {
    for (const [userId, cursorEl] of this.remoteCursors) {
      const userData = this.remoteViewports.get(userId);
      if (userData) {
        const screenPos = this.worldToScreen(userData.x || 0, userData.y || 0);
        cursorEl.style.transform = `translate(${screenPos.x - 6}px, ${screenPos.y - 6}px)`;
      }
    }
  }

  removeRemoteCursor(userId) {
    const cursorEl = this.remoteCursors.get(userId);
    if (cursorEl) {
      cursorEl.remove();
      this.remoteCursors.delete(userId);
    }
    this.remoteViewports.delete(userId);
  }

  toggleFollowUser(userId) {
    if (this.followingUserId === userId) {
      this.followingUserId = null;
      this.removeFollowingIndicator();
      this.updateUserListUI();
    } else {
      this.followingUserId = userId;
      this.showFollowingIndicator(userId);
      this.updateUserListUI();
      
      const userViewport = this.remoteViewports.get(userId);
      if (userViewport) {
        this.viewport.scale = userViewport.scale;
        this.viewport.offsetX = userViewport.offsetX;
        this.viewport.offsetY = userViewport.offsetY;
        this.redrawAll();
        this.updateViewportInfo();
      }
    }
  }

  showFollowingIndicator(userId) {
    this.removeFollowingIndicator();
    const user = this.users.find(u => u.id === userId);
    if (!user) return;

    const indicator = document.createElement('div');
    indicator.className = 'following-indicator';
    indicator.id = 'followingIndicator';
    indicator.innerHTML = `
      👁 正在跟随 ${this.escapeHtml(user.name)}
      <button id="stopFollowingBtn">停止跟随</button>
    `;
    document.querySelector('.main-container').appendChild(indicator);

    document.getElementById('stopFollowingBtn').addEventListener('click', () => {
      this.toggleFollowUser(userId);
    });
  }

  removeFollowingIndicator() {
    const indicator = document.getElementById('followingIndicator');
    if (indicator) {
      indicator.remove();
    }
  }

  updateUserListUI() {
    const userItems = document.querySelectorAll('.user-item');
    userItems.forEach(item => {
      item.classList.remove('following');
    });

    const followBtns = document.querySelectorAll('.user-follow-btn');
    followBtns.forEach(btn => {
      btn.classList.remove('active');
      btn.textContent = '👁';
      btn.title = '跟随视角';
    });

    if (this.followingUserId) {
      const user = this.users.find(u => u.id === this.followingUserId);
      if (user) {
        const userItems = document.querySelectorAll('.user-item');
        userItems.forEach((item, index) => {
          if (this.users[index] && this.users[index].id === this.followingUserId) {
            item.classList.add('following');
          }
        });
      }
    }
  }

  updateViewportInfo() {
    const zoomPercent = Math.round(this.viewport.scale * 100);
    document.getElementById('zoomLevel').textContent = zoomPercent + '%';
  }

  updateCoordinates(worldPos) {
    document.getElementById('coordinates').textContent = 
      `X: ${Math.round(worldPos.x)}, Y: ${Math.round(worldPos.y)}`;
  }

  setColor(color) {
    this.currentColor = color;
    document.getElementById('colorPicker').value = color;
    document.getElementById('hexInput').value = color;
    document.querySelectorAll('.color-swatch').forEach(swatch => {
      swatch.classList.toggle('active', swatch.dataset.color.toLowerCase() === color.toLowerCase());
    });
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
      layer: this.currentLayer,
      brushMode: this.brushMode
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
      case 'move_operations':
        if (data.userId !== this.userId) {
          this.receiveMoveOperations(data.operationIds, data.offsetX, data.offsetY);
        }
        break;
      case 'delete_operations':
        if (data.userId !== this.userId) {
          this.receiveDeleteOperations(data.operationIds);
        }
        break;
      case 'cursor_move':
        if (data.userId !== this.userId) {
          this.updateRemoteCursor(data.userId, data.x, data.y, data.isDrawing, data.scale, data.offsetX, data.offsetY);
        }
        break;
      case 'viewport_sync':
        if (data.targetUserId === this.userId || this.followingUserId === data.userId) {
          this.viewport.scale = data.scale;
          this.viewport.offsetX = data.offsetX;
          this.viewport.offsetY = data.offsetY;
          this.redrawAll();
          this.updateViewportInfo();
        }
        break;
      case 'content_bounds':
        this.onContentBoundsReceived(data.bounds);
        break;
    }
  }

  receiveMoveOperations(operationIds, offsetX, offsetY) {
    for (const op of this.operations) {
      if (operationIds.includes(op.timestamp)) {
        this.offsetOperation(op, offsetX, offsetY);
      }
    }
    for (const layer of Object.values(this.layers)) {
      for (const op of layer.operations) {
        if (operationIds.includes(op.timestamp)) {
          this.offsetOperation(op, offsetX, offsetY);
        }
      }
    }
    this.redrawAll();
  }

  receiveDeleteOperations(operationIds) {
    for (const layer of Object.values(this.layers)) {
      layer.operations = layer.operations.filter(op => !operationIds.includes(op.timestamp));
    }
    this.operations = this.operations.filter(op => !operationIds.includes(op.timestamp));
    this.redrawAll();
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

    setTimeout(() => {
      this.resizeCanvases();
      if (!this.isOwner) {
        this.requestContentBounds();
      } else {
        this.centerViewportToContent();
      }
    }, 100);
  }

  requestContentBounds() {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({
        type: 'get_content_bounds'
      }));
    }
  }

  onContentBoundsReceived(bounds) {
    if (bounds) {
      this.centerViewportToBounds(bounds);
    } else {
      this.viewport.offsetX = this.previewCanvas.width / 2;
      this.viewport.offsetY = this.previewCanvas.height / 2;
      this.redrawAll();
      this.updateViewportInfo();
    }
  }

  centerViewportToContent() {
    if (this.operations.length === 0) {
      this.viewport.offsetX = this.previewCanvas.width / 2;
      this.viewport.offsetY = this.previewCanvas.height / 2;
      this.redrawAll();
      this.updateViewportInfo();
      return;
    }

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const op of this.operations) {
      const bounds = this.getOperationBounds(op);
      if (bounds) {
        minX = Math.min(minX, bounds.minX);
        minY = Math.min(minY, bounds.minY);
        maxX = Math.max(maxX, bounds.maxX);
        maxY = Math.max(maxY, bounds.maxY);
      }
    }

    if (minX !== Infinity) {
      this.centerViewportToBounds({ minX, minY, maxX, maxY });
    }
  }

  centerViewportToBounds(bounds) {
    const centerX = (bounds.minX + bounds.maxX) / 2;
    const centerY = (bounds.minY + bounds.maxY) / 2;
    const contentWidth = bounds.maxX - bounds.minX;
    const contentHeight = bounds.maxY - bounds.minY;

    const padding = 100;
    const scaleX = (this.previewCanvas.width - padding * 2) / (contentWidth || 1);
    const scaleY = (this.previewCanvas.height - padding * 2) / (contentHeight || 1);
    const scale = Math.min(1, scaleX, scaleY);

    this.viewport.scale = Math.max(this.viewport.minScale, Math.min(this.viewport.maxScale, scale));
    
    const screenCenter = this.worldToScreen(centerX, centerY);
    this.viewport.offsetX += this.previewCanvas.width / 2 - screenCenter.x;
    this.viewport.offsetY += this.previewCanvas.height / 2 - screenCenter.y;

    this.redrawAll();
    this.updateViewportInfo();
  }

  updateUserList(users) {
    this.users = users;
    document.getElementById('userCount').textContent = users.length;

    const container = document.getElementById('userList');
    container.innerHTML = '';

    users.forEach(user => {
      const div = document.createElement('div');
      div.className = 'user-item';
      if (this.followingUserId === user.id) {
        div.classList.add('following');
      }

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

      const btnContainer = document.createElement('div');
      btnContainer.style.display = 'flex';
      btnContainer.style.gap = '4px';

      if (user.id !== this.userId) {
        const followBtn = document.createElement('button');
        followBtn.className = 'user-follow-btn';
        followBtn.textContent = '👁';
        followBtn.title = '跟随视角';
        if (this.followingUserId === user.id) {
          followBtn.classList.add('active');
        }
        followBtn.addEventListener('click', () => this.toggleFollowUser(user.id));
        btnContainer.appendChild(followBtn);
      }

      if (this.isOwner && user.id !== this.userId) {
        const kickBtn = document.createElement('button');
        kickBtn.className = 'user-kick-btn';
        kickBtn.textContent = '✕';
        kickBtn.title = '踢出用户';
        kickBtn.addEventListener('click', () => this.kickUser(user.id));
        btnContainer.appendChild(kickBtn);
      }

      if (btnContainer.children.length > 0) {
        div.appendChild(btnContainer);
      }

      container.appendChild(div);
    });

    for (const userId of this.remoteCursors.keys()) {
      if (!users.find(u => u.id === userId)) {
        this.removeRemoteCursor(userId);
      }
    }
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
    
    this.centerViewportToContent();
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
    this.clearSelection();
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
    const bounds = this.getOperationsBounds(this.operations);
    if (!bounds) {
      alert('画布为空，无法导出');
      return;
    }

    const padding = 50;
    const width = Math.ceil(bounds.maxX - bounds.minX + padding * 2);
    const height = Math.ceil(bounds.maxY - bounds.minY + padding * 2);

    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = width;
    tempCanvas.height = height;
    const tempCtx = tempCanvas.getContext('2d');

    tempCtx.fillStyle = 'white';
    tempCtx.fillRect(0, 0, width, height);

    tempCtx.save();
    tempCtx.translate(-bounds.minX + padding, -bounds.minY + padding);

    for (const layer of ['background', 'middle', 'foreground']) {
      if (this.layers[layer].visible) {
        tempCtx.globalAlpha = this.layers[layer].opacity / 100;
        for (const op of this.layers[layer].operations) {
          this.drawOperationForExport(tempCtx, op);
        }
      }
    }
    tempCtx.globalAlpha = 1;
    tempCtx.restore();

    const link = document.createElement('a');
    link.download = `画板_${this.roomCode}_${Date.now()}.png`;
    link.href = tempCanvas.toDataURL('image/png');
    link.click();
  }

  drawOperationForExport(ctx, operation) {
    const brushMode = operation.brushMode || 'normal';
    switch (operation.type) {
      case 'freehand':
      case 'eraser':
        if (operation.points && operation.points.length >= 2) {
          ctx.save();
          this.applyBrushStyle(ctx, brushMode);
          ctx.strokeStyle = operation.color;
          ctx.lineWidth = operation.size;
          ctx.lineCap = 'round';
          ctx.lineJoin = 'round';
          ctx.beginPath();
          ctx.moveTo(operation.points[0].x, operation.points[0].y);
          for (let i = 1; i < operation.points.length; i++) {
            ctx.lineTo(operation.points[i].x, operation.points[i].y);
          }
          ctx.stroke();
          ctx.restore();
        }
        break;
      case 'line':
        ctx.save();
        this.applyBrushStyle(ctx, brushMode);
        ctx.strokeStyle = operation.color;
        ctx.lineWidth = operation.size;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(operation.x1, operation.y1);
        ctx.lineTo(operation.x2, operation.y2);
        ctx.stroke();
        ctx.restore();
        break;
      case 'rect':
        ctx.save();
        this.applyBrushStyle(ctx, brushMode);
        ctx.strokeStyle = operation.color;
        ctx.lineWidth = operation.size;
        ctx.strokeRect(operation.x, operation.y, operation.width, operation.height);
        ctx.restore();
        break;
      case 'circle':
        ctx.save();
        this.applyBrushStyle(ctx, brushMode);
        ctx.strokeStyle = operation.color;
        ctx.lineWidth = operation.size;
        ctx.beginPath();
        ctx.arc(operation.x, operation.y, operation.radius, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
        break;
      case 'text':
        ctx.fillStyle = operation.color;
        ctx.font = `${operation.size}px Arial, sans-serif`;
        ctx.textBaseline = 'top';
        ctx.fillText(operation.text, operation.x, operation.y);
        break;
    }
  }

  getOperationsBounds(operations) {
    if (!operations || operations.length === 0) return null;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    
    for (const op of operations) {
      const bounds = this.getOperationBounds(op);
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

  exportSVG() {
    const bounds = this.getOperationsBounds(this.operations);
    if (!bounds) {
      alert('画布为空，无法导出');
      return;
    }

    const padding = 50;
    const width = Math.ceil(bounds.maxX - bounds.minX + padding * 2);
    const height = Math.ceil(bounds.maxY - bounds.minY + padding * 2);
    const offsetX = -bounds.minX + padding;
    const offsetY = -bounds.minY + padding;

    let svgContent = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`;
    svgContent += `<rect width="${width}" height="${height}" fill="white"/>`;

    for (const layer of ['background', 'middle', 'foreground']) {
      if (!this.layers[layer].visible) continue;
      const opacity = this.layers[layer].opacity / 100;
      svgContent += `<g opacity="${opacity}">`;

      for (const op of this.layers[layer].operations) {
        svgContent += this.operationToSVG(op, offsetX, offsetY);
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

  operationToSVG(op, offsetX = 0, offsetY = 0) {
    const brushMode = op.brushMode || 'normal';
    let dashArray = '';
    let opacity = 1;
    
    if (brushMode === 'dashed') {
      dashArray = ' stroke-dasharray="10,5"';
    } else if (brushMode === 'highlighter') {
      opacity = 0.3;
    }

    switch (op.type) {
      case 'freehand':
      case 'eraser':
        if (!op.points || op.points.length < 2) return '';
        let d = `M ${op.points[0].x + offsetX} ${op.points[0].y + offsetY}`;
        for (let i = 1; i < op.points.length; i++) {
          d += ` L ${op.points[i].x + offsetX} ${op.points[i].y + offsetY}`;
        }
        return `<path d="${d}" stroke="${op.color}" stroke-width="${op.size}" stroke-linecap="round" stroke-linejoin="round" fill="none" opacity="${opacity}"${dashArray}/>`;

      case 'line':
        return `<line x1="${op.x1 + offsetX}" y1="${op.y1 + offsetY}" x2="${op.x2 + offsetX}" y2="${op.y2 + offsetY}" stroke="${op.color}" stroke-width="${op.size}" stroke-linecap="round" opacity="${opacity}"${dashArray}/>`;

      case 'rect':
        return `<rect x="${op.x + offsetX}" y="${op.y + offsetY}" width="${op.width}" height="${op.height}" stroke="${op.color}" stroke-width="${op.size}" fill="none" opacity="${opacity}"${dashArray}/>`;

      case 'circle':
        return `<circle cx="${op.x + offsetX}" cy="${op.y + offsetY}" r="${op.radius}" stroke="${op.color}" stroke-width="${op.size}" fill="none" opacity="${opacity}"${dashArray}/>`;

      case 'text':
        return `<text x="${op.x + offsetX}" y="${op.y + offsetY}" fill="${op.color}" font-size="${op.size}" font-family="Arial, sans-serif">${this.escapeHtml(op.text || '')}</text>`;

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