/**
 * ==========================================
 * 【服务器端代码 / SERVER SIDE】
 * 文件名: server.js
 * 版本: V31.0
 * 修改点: 扩展至8个房间，增加抢先模式逻辑，优化超时重置
 * ==========================================
 */

const { Server } = require("socket.io");
const http = require("http");

const httpServer = http.createServer();
const io = new Server(httpServer, {
  cors: { origin: "*", methods: ["GET", "POST"] }
});

const rooms = new Map();

// --- 24点逻辑 ---
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

function resetRoom(room) {
    room.status = 'waiting';
    room.cards = [];
    room.grabbedBy = null;
    room.winner = null;
    room.players.forEach(p => { p.ready = false; p.gaveUp = false; });
}

io.on("connection", (socket) => {
  socket.on("join-room", ({ roomId, playerId }) => {
    socket.join(roomId);
    if (!rooms.has(roomId)) {
      rooms.set(roomId, {
        id: roomId,
        mode: parseInt(roomId) <= 4 ? '搶答' : '搶先', // 1-4抢答，5-8抢先
        status: 'waiting',
        players: [],
        cards: [],
        grabbedBy: null
      });
    }
    const room = rooms.get(roomId);
    if (!room.players.find(p => p.id === playerId)) {
      room.players.push({ id: playerId, socketId: socket.id, ready: false, gaveUp: false });
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
          // 如果是抢先模式，全员皆可操作，不设 grabbedBy
          room.grabbedBy = room.mode === '搶先' ? 'ALL' : null; 
          io.to(roomId).emit("room-update", room);
        }, 2000);
      } else {
        io.to(roomId).emit("room-update", room);
      }
    }
  });

  socket.on("buzz", ({ roomId, playerId }) => {
    const room = rooms.get(roomId);
    if (room && room.mode === '搶答' && !room.grabbedBy && room.status === 'playing') {
      room.grabbedBy = playerId;
      io.to(roomId).emit("room-update", room);
    }
  });

  socket.on("give-up", ({ roomId, playerId }) => {
    const room = rooms.get(roomId);
    if (!room || room.status !== 'playing') return;
    
    if (room.mode === '搶答') {
        if (room.grabbedBy === playerId) {
            resetRoom(room);
            io.to(roomId).emit("game-result", { isWin: false, message: "玩家放棄，本轮結束。" });
            io.to(roomId).emit("room-update", room);
        }
    } else {
        const player = room.players.find(p => p.id === playerId);
        if (player) player.gaveUp = true;
        if (room.players.every(p => p.gaveUp)) {
            resetRoom(room);
            io.to(roomId).emit("game-result", { isWin: false, message: "全员放棄，重新發牌。" });
            io.to(roomId).emit("room-update", room);
        }
    }
  });

  socket.on("global-timeout", ({ roomId }) => {
      const room = rooms.get(roomId);
      if (room && room.status === 'playing') {
          resetRoom(room);
          io.to(roomId).emit("game-result", { isWin: false, message: "120秒時間到！重新開始。" });
          io.to(roomId).emit("room-update", room);
      }
  });

  socket.on("submit-cards", ({ roomId, cards, isWin, playerId }) => {
    const room = rooms.get(roomId);
    if (room && room.status === 'playing') {
      if (isWin) {
        room.status = 'won';
        room.winner = playerId;
        room.cards = cards;
        io.to(roomId).emit("room-update", room);
        setTimeout(() => {
          resetRoom(room);
          io.to(roomId).emit("room-update", room);
        }, 4000);
      } else {
        room.cards = cards;
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
httpServer.listen(PORT, () => console.log(`Server V31.0 on ${PORT}`));
