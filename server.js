/**
 * 这是 24点游戏的 WebSocket 后端代码 (V27 - 云端专用版)
 * 运行环境: Node.js
 * 核心依赖: socket.io
 */

const { Server } = require("socket.io");
const http = require("http");

const httpServer = http.createServer();
const io = new Server(httpServer, {
  cors: {
    origin: "*", // 允许任何前端连接
    methods: ["GET", "POST"]
  }
});

const rooms = new Map();

// --- 24点发牌逻辑 ---
const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
const SUITS = ['spades', 'hearts', 'clubs', 'diamonds'];

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
      for (let v of ops) if (solve24([...rest, v])) return true;
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
        id: Math.random().toString(36).substr(2, 9), 
        val: r + 1, 
        displayVal: RANKS[r], 
        suit: SUITS[s], 
        color: (s % 2 === 1 ? 'text-red-500' : 'text-slate-900') 
      };
    });
    if (solve24(p.map(c => c.val))) return p;
  }
}

// --- WebSocket 核心逻辑 ---
io.on("connection", (socket) => {
  console.log("新连接:", socket.id);

  socket.on("join-room", ({ roomId, playerId }) => {
    socket.join(roomId);
    if (!rooms.has(roomId)) {
      rooms.set(roomId, {
        status: 'waiting',
        players: [],
        cards: [],
        grabbedBy: null,
        winner: null
      });
    }
    const room = rooms.get(roomId);
    if (!room.players.find(p => p.id === playerId)) {
      room.players.push({ id: playerId, socketId: socket.id, ready: false });
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
        room.status = 'counting';
        io.to(roomId).emit("room-update", room);
        setTimeout(() => {
          room.status = 'playing';
          room.cards = generatePuzzle();
          room.grabbedBy = null;
          io.to(roomId).emit("room-update", room);
        }, 2500);
      } else {
        io.to(roomId).emit("room-update", room);
      }
    }
  });

  socket.on("buzz", ({ roomId, playerId }) => {
    const room = rooms.get(roomId);
    if (room && !room.grabbedBy && room.status === 'playing') {
      room.grabbedBy = playerId;
      io.to(roomId).emit("room-update", room);
    }
  });

  socket.on("submit-cards", ({ roomId, cards, isWin, playerId }) => {
    const room = rooms.get(roomId);
    if (room) {
      room.cards = cards;
      if (isWin) {
        room.status = 'won';
        room.winner = playerId;
        io.to(roomId).emit("room-update", room);
        setTimeout(() => {
          room.status = 'waiting';
          room.cards = [];
          room.winner = null;
          room.players.forEach(p => p.ready = false);
          io.to(roomId).emit("room-update", room);
        }, 4000);
      } else {
        io.to(roomId).emit("room-update", room);
      }
    }
  });

  socket.on("disconnect", () => {
    rooms.forEach((room, roomId) => {
      room.players = room.players.filter(p => p.socketId !== socket.id);
      if (room.players.length === 0) rooms.delete(roomId);
      else io.to(roomId).emit("room-update", room);
    });
  });
});

const PORT = process.env.PORT || 3001;
httpServer.listen(PORT, () => console.log(`Server on port ${PORT}`));
