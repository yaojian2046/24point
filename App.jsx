/**
 * ==========================================
 * 【前端代码 / CLIENT SIDE】
 * 文件名: App.jsx
 * 版本: 黄金版 V1.0 (全逻辑对齐版本)
 * * 核心特性:
 * 1. 采用服务器权威计时 (Server-Side Authoritative Timer)。
 * 2. 界面布局比例加固 (h-[35%] 操作区)，确保在任何手机屏幕不截断。
 * 3. 完整音效链路：点牌、合并、抢答、警告、获胜、背景音乐。
 * 4. 实时积分显示与同步。
 * 5. 支持乘方 (^) 运算。
 * ==========================================
 */

import React, { useState, useEffect, useRef } from 'react';

// 注意：部署到生产环境时请确保此 URL 与你的 Render 后端地址一致
const SERVER_URL = "https://two4point.onrender.com"; 

const SFX = {
  click: 'https://assets.mixkit.co/active_storage/sfx/2571/2571-preview.mp3',      // 点选卡片
  success: 'https://assets.mixkit.co/active_storage/sfx/600/600-preview.mp3',    // 计算合并成功
  fail: 'https://assets.mixkit.co/active_storage/sfx/2572/2572-preview.mp3',       // 失败/超时
  buzz: 'https://assets.mixkit.co/active_storage/sfx/951/951-preview.mp3',       // 抢答成功
  warn: 'https://assets.mixkit.co/active_storage/sfx/997/997-preview.mp3',       // 最后6秒警示
  win: 'https://assets.mixkit.co/active_storage/sfx/1435/1435-preview.mp3',      // 获胜
  bgm: 'https://actions.google.com/config/en/resources/explore/audio/game_sounds/ambience/space_wind.mp3' // 背景音乐
};

// 玩家唯一 ID 生成与持久化
const getUID = () => {
  let uid = localStorage.getItem('v24_uid') || 'P-' + Math.random().toString(36).substring(2, 10);
  localStorage.setItem('v24_uid', uid);
  return uid;
};

// 玩家昵称生成与持久化
const getNick = () => {
  let nick = localStorage.getItem('v24_nick');
  if (!nick) {
    const NAMES = ["神算子", "数字猎手", "心算大师", "闪电侠", "速算精英", "脑力达人"];
    nick = NAMES[Math.floor(Math.random() * NAMES.length)] + (Math.floor(Math.random()*90)+10);
    localStorage.setItem('v24_nick', nick);
  }
  return nick;
};

const MY_ID = getUID();
const MY_NICK = getNick();

export default function App() {
  const [socket, setSocket] = useState(null);
  const [view, setView] = useState('lobby'); // lobby 或 game
  const [room, setRoom] = useState(null);
  const [activeRoomId, setActiveRoomId] = useState(null);
  const [timer, setTimer] = useState(120);
  const [errorMsg, setErrorMsg] = useState("");
  const [selectedId, setSelectedId] = useState(null);
  const [pendingOp, setPendingOp] = useState(null);
  const [history, setHistory] = useState([]); // 用于撤销操作
  const [connStatus, setConnStatus] = useState('connecting');

  const audioRef = useRef({});
  const isAudioEnabled = useRef(false);

  // 1. 初始化 Socket 连接与音效加载
  useEffect(() => {
    Object.entries(SFX).forEach(([k, url]) => {
      const audio = new Audio(url);
      audio.preload = "auto";
      if(k === 'bgm') { audio.loop = true; audio.volume = 0.1; }
      audioRef.current[k] = audio;
    });

    const script = document.createElement("script");
    script.src = "https://cdn.socket.io/4.7.2/socket.io.min.js";
    script.async = true;
    script.onload = () => {
      const s = window.io(SERVER_URL);
      
      s.on("connect", () => setConnStatus('online'));
      s.on("disconnect", () => setConnStatus('offline'));

      // 接收服务器推送的房间更新
      s.on("room-update", (data) => {
          setRoom(data);
          // 同步本地分数缓存
          const me = data.players.find(p => p.id === MY_ID);
          if (me) localStorage.setItem('v24_score', (me.score || 0).toString());

          if (data.status !== 'playing') {
              setHistory([]);
              setSelectedId(null);
              setPendingOp(null);
          }
      });

      // 接收服务器强制同步的倒计时
      s.on("timer-sync", ({ timeLeft }) => {
          setTimer(timeLeft);
          if (timeLeft <= 6 && timeLeft > 0) playSound('warn');
      });

      // 接收强制超时指令
      s.on("force-timeout", ({ message }) => {
          setErrorMsg(message);
          playSound('fail');
          setTimeout(() => setErrorMsg(""), 3000);
      });

      setSocket(s);
    };
    document.head.appendChild(script);
  }, []);

  // 2. 音效激活逻辑 (针对浏览器安全策略)
  const enableAudio = () => {
    if (isAudioEnabled.current) return;
    Object.values(audioRef.current).forEach(a => {
      a.play().then(() => { a.pause(); a.currentTime = 0; }).catch(()=>{});
    });
    isAudioEnabled.current = true;
    audioRef.current['bgm']?.play().catch(()=>{});
  };

  const playSound = (k) => {
    const a = audioRef.current[k];
    if (a) {
        a.pause();
        a.currentTime = 0;
        a.play().catch(()=>{});
    }
  };

  // 3. 核心游戏动作
  const joinRoom = (id) => {
    enableAudio();
    setActiveRoomId(id);
    const score = parseInt(localStorage.getItem('v24_score') || '0');
    socket?.emit("join-room", { roomId: id, playerId: MY_ID, nick: MY_NICK, score });
    setView('game');
    playSound('click');
  };

  const leaveRoom = () => {
    socket?.emit("leave-room", { roomId: activeRoomId, playerId: MY_ID });
    setView('lobby');
    setActiveRoomId(null);
    setRoom(null);
    playSound('click');
  };

  const compute = (id1, id2, op) => {
    if (!room || room.status !== 'playing') return;
    
    const c1 = room.cards.find(c => c.id === id1);
    const c2 = room.cards.find(c => c.id === id2);
    if (!c1 || !c2) return;
    
    let res;
    try {
      if (op === '+') res = c1.val + c2.val;
      else if (op === '-') res = c1.val - c2.val;
      else if (op === '×') res = c1.val * c2.val;
      else if (op === '÷') {
        if (Math.abs(c2.val) < 0.0001) return;
        res = c1.val / c2.val;
      }
      else if (op === '^') {
        res = Math.pow(c1.val, c2.val);
        if (!isFinite(res) || isNaN(res)) return;
      }
    } catch(e) { return; }

    playSound('success');
    // 保存历史记录用于撤销
    setHistory([...history, JSON.parse(JSON.stringify(room.cards))]);

    const nextCards = room.cards.filter(c => c.id !== id1 && c.id !== id2).map(c => ({...c}));
    nextCards.push({
      id: "R-" + Math.random(),
      val: res,
      displayVal: Number.isInteger(res) && res < 1000000 ? res.toString() : res.toFixed(1),
      suit: 'star',
      color: 'text-emerald-400'
    });

    const isWin = nextCards.length === 1 && Math.abs(nextCards[0].val - 24) < 0.01;
    let score = parseInt(localStorage.getItem('v24_score') || '0');
    if (isWin) {
        score += 3; // 赢一局加3分
        playSound('win');
    }

    socket.emit("submit-cards", { roomId: activeRoomId, cards: nextCards, isWin, playerId: MY_ID, score });
    setSelectedId(null); 
    setPendingOp(null);
  };

  const handleUndo = () => {
    if (history.length === 0) return;
    const lastState = history[history.length - 1];
    setHistory(history.slice(0, -1));
    socket.emit("submit-cards", { roomId: activeRoomId, cards: lastState, isWin: false, playerId: MY_ID, score: parseInt(localStorage.getItem('v24_score') || '0') });
    playSound('click');
  };

  const canOperate = () => {
    if (!room || room.status !== 'playing') return false;
    if (room.mode === '搶先') return true;
    return room.grabbedBy === MY_ID;
  };

  // 4. UI 渲染
  return (
    <div className="fixed inset-0 bg-slate-950 text-white flex flex-col font-sans overflow-hidden select-none" onClick={enableAudio}>
      
      {/* 顶部标题栏 (5%) */}
      <div className="h-[6%] border-b border-white/10 flex items-center justify-between px-6 bg-black/40">
        <span className="text-[10px] font-black tracking-tighter text-emerald-500 italic uppercase">24PT GOLDEN V1.0</span>
        <div className="flex items-center gap-4">
            <div className={`w-2 h-2 rounded-full ${connStatus === 'online' ? 'bg-emerald-500 animate-pulse' : 'bg-red-500'}`} />
            <span className="text-[10px] font-bold text-white/60">{MY_NICK}</span>
            <span className="text-[10px] font-black text-yellow-500 tracking-widest">🏆 {localStorage.getItem('v24_score') || 0}</span>
        </div>
      </div>

      {/* 浮动提示信息 */}
      {errorMsg && (
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-yellow-400 text-black px-8 py-4 rounded-[2rem] z-[100] font-black shadow-[0_0_50px_rgba(250,204,21,0.5)] animate-in zoom-in duration-300">
          {errorMsg}
        </div>
      )}

      {view === 'lobby' ? (
        /* 大厅视图 */
        <div className="flex-1 p-6 grid grid-cols-2 gap-4 overflow-y-auto content-start pb-24">
          <div className="col-span-2 text-center py-6">
              <div className="text-7xl font-black italic tracking-tighter drop-shadow-2xl">24<span className="text-emerald-500">.</span></div>
              <p className="text-[10px] text-white/20 uppercase tracking-[0.5em] mt-2">The Golden Version</p>
          </div>
          {[1,2,3,4,5,6,7,8].map(n => (
            <button key={n} onClick={() => joinRoom(n.toString())} className="aspect-[4/3] bg-white/[0.03] border border-white/10 rounded-[2.5rem] p-6 text-left active:scale-95 transition-all group relative overflow-hidden">
               <div className="text-3xl font-black text-emerald-500 group-hover:scale-110 transition-transform">#{n}</div>
               <div className="text-[10px] opacity-40 uppercase font-black mt-2 tracking-widest">{n<=4?'抢答擂台':'抢先竞赛'}</div>
               <div className="absolute -right-4 -bottom-6 text-8xl font-black text-white/[0.02] italic group-hover:text-white/[0.05] transition-all">{n}</div>
            </button>
          ))}
        </div>
      ) : (
        /* 游戏视图 */
        <div className="flex-1 flex flex-col relative h-full">
          
          {/* 在线玩家积分榜 (10%) */}
          <div className="h-[10%] bg-black/30 flex items-center px-4 gap-3 overflow-x-auto no-scrollbar border-b border-white/5 shrink-0">
            {room?.players.map(p => (
              <div key={p.id} className={`shrink-0 px-4 py-1.5 rounded-full border flex items-center gap-2 ${p.id === MY_ID ? 'bg-emerald-500/10 border-emerald-500/30' : 'bg-white/5 border-white/5'}`}>
                <div className={`w-2 h-2 rounded-full ${p.ready ? 'bg-emerald-500 shadow-[0_0_8px_#10b981]' : 'bg-white/10'}`} />
                <span className="text-[10px] font-bold truncate max-w-[70px]">{p.nick} {p.id===MY_ID && "(我)"}</span>
                <span className="text-[10px] font-black text-yellow-500">[{p.score || 0}]</span>
              </div>
            ))}
          </div>

          <div className="flex-1 flex flex-col items-center justify-between p-4 overflow-hidden">
            {room?.status === 'waiting' ? (
              /* 等待开局 */
              <div className="flex-1 flex flex-col items-center justify-center gap-12">
                <button onClick={() => { playSound('click'); socket.emit("toggle-ready", {roomId: activeRoomId, playerId: MY_ID}); }} 
                  className={`w-44 h-44 rounded-full border-[6px] font-black text-2xl transition-all duration-500 ${room.players.find(p=>p.id===MY_ID)?.ready ? 'bg-emerald-500 border-white text-black scale-110 shadow-[0_0_60px_#10b981]' : 'bg-transparent border-white/10 text-white/20 hover:border-white/40'}`}>
                  {room.players.find(p=>p.id===MY_ID)?.ready ? 'READY!' : 'START'}
                </button>
                <div className="flex flex-col items-center gap-6">
                    <p className="text-[10px] text-white/20 font-black uppercase tracking-[0.4em]">等待所有玩家就绪 ({room.players.filter(p=>p.ready).length}/{room.players.length})</p>
                    <button onClick={leaveRoom} className="px-12 py-3 rounded-full bg-white/5 border border-white/10 text-[10px] font-black text-white/40 hover:text-red-500 hover:border-red-500/30 transition-all uppercase">退出房间</button>
                </div>
              </div>
            ) : room?.status === 'playing' ? (
              /* 游戏进行中 */
              <div className="w-full h-full flex flex-col">
                
                {/* 计时器区 (12%) */}
                <div className="h-[12%] flex flex-col items-center justify-center shrink-0">
                   <div className={`text-6xl font-black tabular-nums transition-all ${timer <= 10 ? 'text-red-500 animate-pulse scale-110' : 'text-emerald-500'}`}>
                    {timer}<span className="text-xl ml-1 opacity-40 font-medium">S</span>
                   </div>
                   {room.grabbedBy && <div className="text-[10px] font-black text-red-400 mt-1 uppercase tracking-widest animate-pulse">
                    ⚠️ {room.players.find(p=>p.id===room.grabbedBy)?.nick} 正在作答
                   </div>}
                </div>

                {/* 卡片渲染区 (43%) */}
                <div className={`h-[43%] grid grid-cols-2 gap-6 items-center justify-items-center transition-all duration-700 ${!canOperate() ? 'blur-xl grayscale opacity-10 scale-90 pointer-events-none' : 'scale-100'}`}>
                  {room.cards.map(c => (
                    <div key={c.id} onClick={() => { if(!canOperate()) return; playSound('click'); if(!pendingOp) setSelectedId(c.id === selectedId ? null : c.id); else compute(pendingOp.cardId, c.id, pendingOp.op); }}
                      className={`w-32 h-44 bg-white rounded-[2rem] flex items-center justify-center border-[8px] transition-all active:scale-90 ${selectedId === c.id ? 'border-emerald-500 -translate-y-4 shadow-[0_25px_50px_rgba(16,185,129,0.4)]' : 'border-transparent shadow-2xl'}`}>
                      <span className={`text-6xl font-black ${c.color}`}>{c.displayVal}</span>
                    </div>
                  ))}
                </div>

                {/* 固定高度操作面板 (35%) */}
                <div className="h-[35%] flex flex-col items-center justify-center bg-white/[0.03] rounded-t-[4rem] border-t border-white/10 p-8 shrink-0 relative">
                   {room.mode === '搶答' && !room.grabbedBy ? (
                     <button onClick={() => { socket.emit("buzz", {roomId: activeRoomId, playerId: MY_ID}); playSound('buzz'); }} 
                      className="w-28 h-28 bg-red-500 rounded-full text-4xl font-black shadow-[0_0_50px_rgba(239,68,68,0.6)] active:scale-75 animate-bounce">抢</button>
                   ) : canOperate() ? (
                     <div className="w-full h-full flex flex-col justify-between">
                        <div className="grid grid-cols-5 gap-3">
                          {['+', '-', '×', '÷', '^'].map(op => (
                            <button key={op} onClick={() => { if(!selectedId) return; setPendingOp({cardId: selectedId, op}); playSound('click'); }} 
                              className={`aspect-square rounded-[1.5rem] font-black text-3xl transition-all ${pendingOp?.op === op ? 'bg-emerald-500 text-black scale-110 shadow-xl' : 'bg-white/10 text-emerald-400 active:bg-white/20'}`}>
                              {op}
                            </button>
                          ))}
                        </div>
                        <div className="flex gap-4">
                            <button onClick={handleUndo} 
                                className="flex-1 py-5 bg-white/5 rounded-2xl text-[11px] font-black uppercase tracking-[0.3em] border border-white/10 active:bg-white/10 disabled:opacity-10"
                                disabled={history.length === 0}>
                                Undo 撤销
                            </button>
                        </div>
                     </div>
                   ) : <div className="text-[11px] font-black opacity-10 uppercase tracking-[0.6em] animate-pulse">对方正在思考...</div>}
                </div>
              </div>
            ) : room?.status === 'won' ? (
               /* 胜利结算 */
               <div className="flex-1 flex flex-col items-center justify-center animate-in zoom-in-50 duration-700">
                  <div className="text-9xl mb-8 drop-shadow-[0_0_40px_rgba(255,255,255,0.3)] animate-bounce">🏆</div>
                  <div className="text-5xl font-black italic tracking-tighter mb-4">{room.winner === MY_ID ? 'VICTORY' : 'DEFEATED'}</div>
                  <div className="text-[11px] font-bold text-yellow-500 uppercase tracking-[0.4em] bg-white/5 px-8 py-2 rounded-full border border-white/10">下一局即将自动开始...</div>
               </div>
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
}
