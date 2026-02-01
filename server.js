const { Server } = require("socket.io");
const http = require("http");

const httpServer = http.createServer();
const io = new Server(httpServer, {
  cors: {
    origin: "*", 
    methods: ["GET", "POST"]
  }
});

const rooms = new Map();

// --- 24点发牌逻辑 ---
const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
const SUITS = ['spades', 'hearts', 'clubs', 'diamonds'];

// 递归检测是否有解
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

// 生成有解的牌组
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

// 核心功能：重置房间状态，让所有人重新准备
function resetRoom(room) {
    room.status = 'waiting';
    room.cards = [];
    room.grabbedBy = null;
    room.winner = null;
    // 重置所有玩家的准备状态，确保必须重新点“开始”
    room.players.forEach(p => p.ready = false);
}

io.on("connection", (socket) => {
  console.log("Player connected:", socket.id);

  socket.on("join-room", ({ roomId, playerId }) => {
    socket.join(roomId);
    if (!rooms.has(roomId)) {
      rooms.set(roomId, {
        id: roomId,
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
        room.status = 'counting'; // 进入倒计时阶段
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

  // 处理抢答超时：重置房间
  socket.on("buzz-timeout", ({ roomId }) => {
      const room = rooms.get(roomId);
      if (room && room.grabbedBy) {
          console.log(`Room ${roomId}: Buzz timeout by ${room.grabbedBy}`);
          resetRoom(room);
          io.to(roomId).emit("room-update", room);
          io.to(roomId).emit("game-result", { isWin: false, message: "抢答超时，挑战失败！请重新准备。" });
      }
  });

  // 处理全局120秒超时
  socket.on("global-timeout", ({ roomId }) => {
      const room = rooms.get(roomId);
      if (room && room.status === 'playing') {
          console.log(`Room ${roomId}: Global game timeout`);
          resetRoom(room);
          io.to(roomId).emit("room-update", room);
          io.to(roomId).emit("game-result", { isWin: false, message: "时间到，这题太难了，换一题！" });
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
        // 胜利后4秒自动重置回大厅状态
        setTimeout(() => {
          resetRoom(room);
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
      if (room.players.length === 0) {
          rooms.delete(roomId);
      } else {
          io.to(roomId).emit("room-update", room);
      }
    });
  });
});

const PORT = process.env.PORT || 3001;
httpServer.listen(PORT, () => {
  console.log(`24-Point Game Server running on port ${PORT}`);
});
