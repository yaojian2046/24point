/**
 * ==========================================
 * 【服务器端代码】三八二十四 黄金版 V1.0
 * 核心逻辑：
 * 1. 服务器权威计时器 (Server-side Authoritative Timer)
 * 2. 玩家昵称及积分同步优化
 * 3. 强制超时重置逻辑 (解决30s/120s不重置痛点)
 * ==========================================
 */

const { Server } = require("socket.io");
const http = require("http");

const httpServer = http.createServer();
const io = new Server(httpServer, {
  cors: { origin: "*", methods: ["GET", "POST"] }
});

const rooms = new Map();
const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
const SUITS = ['spades', 'hearts', 'clubs', 'diamonds'];

// 24点递归解法
function solve24(nums) {
  const EPS = 0.0001;
  if (nums.length === 1) return Math.abs(nums[0] - 24) < EPS;
  for (let i = 0; i < nums.length; i++) {
    for (let j = 0; j < nums.length; j++) {
      if (i === j) continue;
      const a = nums[i], b = nums[j], rest = nums.filter((_, idx) => idx !== i && idx !== j);
      const ops = [a + b, a - b, b - a, a * b];
      if (Math.abs(b) > EPS) ops.push(a / b);
      if (Math.abs(a) > EPS) ops.push(b / a);
      if (Math.abs(b) > EPS) ops.push(Math.pow(a, b));
      for (let v of ops) if (isFinite(v) && solve24([...rest, v])) return true;
    }
  }
  return false;
}

function generatePuzzle() {
  while (true) {
    const p = Array.from({ length: 4 }, () => {
      const r = Math.floor(Math.random() * 13);
      const s = Math.floor(Math.random() * 4);
      return { 
        id: "C-" + Math.random().toString(36).substr(2, 9), 
        val: r + 1, 
        displayVal: RANKS[r], 
        suit: SUITS[s], 
        color: (s % 2 === 1 ? 'text-red-500' : 'text-slate-900') 
      };
    });
    if (solve24(p.map(c => c.val))) return p;
  }
}

function resetRoomState(room) {
    if (room.timer) clearInterval(room.timer);
    room.status = 'waiting';
    room.cards = [];
    room.grabbedBy = null;
    room.winner = null;
    room.timeLeft = 120;
    room.players.forEach(p => { p.ready = false; });
}

function startServerTimer(roomId) {
    const room = rooms.get(roomId);
    if (!room) return;
    if (room.timer) clearInterval(room.timer);

    room.timer = setInterval(() => {
        room.timeLeft--;
        if (room.timeLeft <= 0) {
            clearInterval(room.timer);
            const message = room.grabbedBy ? "抢答超时！重置牌面" : "本局无人解出，自动换题";
            io.to(roomId).emit("force-timeout", { message });
            resetRoomState(room);
            io.to(roomId).emit("room-update", room);
        } else {
            // 每秒同步一次时间
            io.to(roomId).emit("timer-sync", { timeLeft: room.timeLeft });
        }
    }, 1000);
}

io.on("connection", (socket) => {
  socket.on("join-room", ({ roomId, playerId, nick, score }) => {
    socket.join(roomId);
    if (!rooms.has(roomId)) {
      rooms.set(roomId, {
        id: roomId,
        mode: parseInt(roomId) <= 4 ? '搶答' : '搶先',
        status: 'waiting',
        players: [],
        cards: [],
        originalCards: [],
        grabbedBy: null,
        timeLeft: 120,
        timer: null
      });
    }
    const room = rooms.get(roomId);
    let player = room.players.find(p => p.id === playerId);
    if (!player) {
      player = { id: playerId, socketId: socket.id, nick: nick || "未知", score: score || 0, ready: false };
      room.players.push(player);
    } else {
      player.socketId = socket.id;
      player.nick = nick; // 更新可能的昵称变化
    }
    io.to(roomId).emit("room-update", room);
  });

  socket.on("toggle-ready", ({ roomId, playerId }) => {
    const room = rooms.get(roomId);
    if (!room) return;
    const player = room.players.find(p => p.id === playerId);
    if (player) {
      player.ready = !player.ready;
      const allReady = room.players.length >= 2 && room.players.every(p => p.ready);
      if (allReady && room.status === 'waiting') {
        room.status = 'playing';
        room.cards = generatePuzzle();
        room.originalCards = JSON.parse(JSON.stringify(room.cards));
        room.timeLeft = 120;
        startServerTimer(roomId);
      }
      io.to(roomId).emit("room-update", room);
    }
  });

  socket.on("buzz", ({ roomId, playerId }) => {
    const room = rooms.get(roomId);
    if (room && room.mode === '搶答' && !room.grabbedBy && room.status === 'playing') {
      room.grabbedBy = playerId;
      room.timeLeft = 30; // 抢答限时30秒
      io.to(roomId).emit("room-update", room);
    }
  });

  socket.on("submit-cards", ({ roomId, cards, isWin, playerId, score }) => {
    const room = rooms.get(roomId);
    if (!room || room.status !== 'playing') return;
    
    room.cards = cards;
    if (isWin) {
        clearInterval(room.timer);
        room.status = 'won';
        room.winner = playerId;
        const p = room.players.find(p => p.id === playerId);
        if (p) p.score = score;
        io.to(roomId).emit("room-update", room);
        // 4秒后自动重置回待机状态
        setTimeout(() => { 
            resetRoomState(room); 
            io.to(roomId).emit("room-update", room); 
        }, 4000);
    } else {
        io.to(roomId).emit("room-update", room);
    }
  });

  socket.on("disconnect", () => {
    rooms.forEach((room, roomId) => {
      room.players = room.players.filter(p => p.socketId !== socket.id);
      if (room.players.length === 0) {
          if (room.timer) clearInterval(room.timer);
          rooms.delete(roomId);
      } else {
          io.to(roomId).emit("room-update", room);
      }
    });
  });
});

const PORT = process.env.PORT || 3001;
httpServer.listen(PORT, () => console.log(`Server V32.0 (Golden) on ${PORT}`));
