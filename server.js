const path = require("path");
const http = require("http");
const express = require("express");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, "public")));

const PORT = process.env.PORT || 3000;
const MAX_PLAYERS = 8;

// all the rooms that are open right now, key = room code
const rooms = {};


// ---------- words ----------
const words = {
  english: [
    "cat", "dog", "elephant", "fish", "monkey", "snake", "rabbit", "horse", "tiger", "butterfly",
    "owl", "turtle", "giraffe", "penguin", "spider", "pizza", "banana", "ice cream", "burger", "cake",
    "apple", "rice", "dosa", "egg", "mango", "popcorn", "sandwich", "carrot", "tomato", "cookie",
    "umbrella", "bicycle", "clock", "key", "chair", "phone", "glasses", "candle", "rocket", "guitar",
    "lamp", "scissors", "bottle", "bus", "door", "mountain", "rainbow", "beach", "train", "robot"
  ],
  // [kannada, english]
  kannada: [
    ["ಮನೆ", "house"], ["ನೀರು", "water"], ["ಹೂವು", "flower"], ["ಮರ", "tree"],
    ["ಸೂರ್ಯ", "sun"], ["ಚಂದ್ರ", "moon"], ["ಆನೆ", "elephant"], ["ಹಸು", "cow"],
    ["ಮೀನು", "fish"], ["ಪುಸ್ತಕ", "book"], ["ಕಾರು", "car"], ["ಹಕ್ಕಿ", "bird"],
    ["ನಾಯಿ", "dog"], ["ಬೆಕ್ಕು", "cat"], ["ಮಳೆ", "rain"], ["ಕೊಡೆ", "umbrella"], ["ಹಾಲು", "milk"]
  ]
};


// ---------- small helpers ----------
function makeRoomCode() {
  const letters = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  do {
    code = "";
    for (let i = 0; i < 5; i++) {
      code += letters[Math.floor(Math.random() * letters.length)];
    }
  } while (rooms[code]);
  return code;
}

function findPlayer(room, id) {
  for (let i = 0; i < room.players.length; i++) {
    if (room.players[i].id === id) return room.players[i];
  }
  return null;
}

function cleanName(name) {
  if (typeof name !== "string") return "";
  return name.trim().slice(0, 14);
}

// this is what every player is allowed to see (never the secret word)
function publicRoom(room) {
  return {
    code: room.code,
    hostId: room.hostId,
    state: room.state,
    settings: room.settings,
    round: room.round,
    drawerId: room.drawerId,
    hint: room.hint,
    timeLeft: room.timeLeft,
    revealWord: room.state === "between" && room.word ? room.word.answer : "",
    players: room.players.map(function (p) {
      return { id: p.id, name: p.name, score: p.score, guessed: p.guessed };
    })
  };
}

function sendRoom(room) {
  io.to(room.code).emit("room", publicRoom(room));
}

function sendChat(room, text, kind) {
  io.to(room.code).emit("chat", { name: "", text: text, kind: kind });
}

function pickWord(room) {
  const list = words[room.settings.pack];
  let item;
  let tries = 0;

  do {
    item = list[Math.floor(Math.random() * list.length)];
    tries++;
  } while (room.used.indexOf(String(item)) !== -1 && tries < 30);

  room.used.push(String(item));

  if (room.settings.pack === "kannada") {
    return { answer: item[1], show: item[0] + "  (" + item[1] + ")", alt: item[0] };
  }
  return { answer: item, show: item, alt: null };
}

function makeHint(room) {
  let text = "";
  const word = room.word.answer;

  for (let i = 0; i < word.length; i++) {
    if (word[i] === " ") {
      text += "   ";
    } else if (room.revealed[i]) {
      text += word[i] + " ";
    } else {
      text += "_ ";
    }
  }
  return text;
}

function revealLetter(room) {
  const word = room.word.answer;
  const hidden = [];

  for (let i = 0; i < word.length; i++) {
    if (word[i] !== " " && !room.revealed[i]) hidden.push(i);
  }

  // keep at least 2 letters hidden
  if (hidden.length <= 2) return;

  const pick = hidden[Math.floor(Math.random() * hidden.length)];
  room.revealed[pick] = true;
  room.hint = makeHint(room);
  sendRoom(room);
}

function cleanSegment(seg) {
  if (!seg) return null;

  const nums = [seg.x0, seg.y0, seg.x1, seg.y1, seg.size];
  for (let i = 0; i < nums.length; i++) {
    if (typeof nums[i] !== "number" || !isFinite(nums[i])) return null;
  }
  if (typeof seg.color !== "string" || !/^#[0-9a-fA-F]{6}$/.test(seg.color)) return null;

  return {
    x0: seg.x0, y0: seg.y0, x1: seg.x1, y1: seg.y1,
    color: seg.color,
    size: Math.min(40, Math.max(1, seg.size))
  };
}


// ---------- game flow ----------
function startGame(room) {
  for (let i = 0; i < room.players.length; i++) {
    room.players[i].score = 0;
    room.players[i].guessed = false;
  }

  room.order = room.players.map(function (p) { return p.id; });
  room.totalTurns = room.settings.rounds * room.order.length;
  room.turnCount = 0;
  room.used = [];
  room.round = 1;

  startTurn(room);
}

function startTurn(room) {
  if (room.players.length < 2) {
    room.state = "lobby";
    sendChat(room, "Not enough players, back to the lobby.", "system");
    sendRoom(room);
    return;
  }

  // find the next drawer who is still in the room
  let drawer = null;
  while (room.turnCount < room.totalTurns) {
    const id = room.order[room.turnCount % room.order.length];
    room.turnCount++;
    drawer = findPlayer(room, id);
    if (drawer) break;
  }

  if (!drawer) {
    endGame(room);
    return;
  }

  room.round = Math.ceil(room.turnCount / room.order.length);
  room.state = "drawing";
  room.drawerId = drawer.id;
  room.word = pickWord(room);
  room.revealed = [];
  for (let i = 0; i < room.word.answer.length; i++) {
    room.revealed.push(false);
  }
  room.hint = makeHint(room);
  room.strokes = [];
  room.timeLeft = room.settings.time;

  for (let i = 0; i < room.players.length; i++) {
    room.players[i].guessed = false;
  }

  io.to(room.code).emit("clear");
  sendRoom(room);
  io.to(drawer.id).emit("yourWord", room.word.show);
  sendChat(room, drawer.name + " is drawing now!", "system");

  clearInterval(room.timerId);
  room.timerId = setInterval(function () {
    room.timeLeft--;
    io.to(room.code).emit("timer", room.timeLeft);

    // a new letter every 20 seconds
    if (room.timeLeft > 0 && room.timeLeft % 20 === 0) {
      revealLetter(room);
    }

    if (room.timeLeft <= 0) {
      endTurn(room);
    }
  }, 1000);
}

function endTurn(room) {
  if (room.state !== "drawing") return;

  clearInterval(room.timerId);
  room.state = "between";
  sendChat(room, "The word was: " + room.word.answer, "system");
  sendRoom(room);

  room.nextId = setTimeout(function () {
    if (rooms[room.code] === room && room.state === "between") {
      startTurn(room);
    }
  }, 4000);
}

function endGame(room) {
  clearInterval(room.timerId);
  room.state = "ended";
  room.drawerId = "";
  sendRoom(room);
}

function removePlayer(room, id) {
  const player = findPlayer(room, id);
  if (!player) return;

  room.players = room.players.filter(function (p) { return p.id !== id; });

  if (room.players.length === 0) {
    clearInterval(room.timerId);
    clearTimeout(room.nextId);
    delete rooms[room.code];
    return;
  }

  // host left, give the room to the next person
  if (room.hostId === id) {
    room.hostId = room.players[0].id;
  }

  sendChat(room, player.name + " left.", "system");

  if (room.state === "drawing" && room.drawerId === id) {
    endTurn(room);
  }

  sendRoom(room);
}


// ---------- sockets ----------
io.on("connection", function (socket) {

  function myRoom() {
    return rooms[socket.roomCode] || null;
  }

  function joinRoom(room, name) {
    const player = { id: socket.id, name: name, score: 0, guessed: false };
    room.players.push(player);
    socket.join(room.code);
    socket.roomCode = room.code;

    sendChat(room, name + " joined.", "system");
    sendRoom(room);
    socket.emit("strokes", room.strokes);
  }

  socket.on("createRoom", function (data, reply) {
    const name = cleanName(data && data.name);
    if (!name) {
      reply({ ok: false, error: "Enter your name first." });
      return;
    }

    const code = makeRoomCode();
    rooms[code] = {
      code: code,
      hostId: socket.id,
      state: "lobby",
      settings: { rounds: 2, time: 60, pack: "english" },
      players: [],
      order: [],
      round: 1,
      totalTurns: 0,
      turnCount: 0,
      drawerId: "",
      word: null,
      revealed: [],
      hint: "",
      timeLeft: 0,
      strokes: [],
      used: [],
      timerId: null,
      nextId: null
    };

    joinRoom(rooms[code], name);
    reply({ ok: true, code: code });
  });

  socket.on("joinRoom", function (data, reply) {
    const name = cleanName(data && data.name);
    const code = String((data && data.code) || "").trim().toUpperCase();
    const room = rooms[code];

    if (!name) {
      reply({ ok: false, error: "Enter your name first." });
      return;
    }
    if (!room) {
      reply({ ok: false, error: "Room not found. Check the link or code." });
      return;
    }
    if (room.players.length >= MAX_PLAYERS) {
      reply({ ok: false, error: "This room is full." });
      return;
    }
    if (socket.roomCode) {
      reply({ ok: false, error: "You are already in a room." });
      return;
    }

    joinRoom(room, name);
    reply({ ok: true, code: code });
  });

  socket.on("settings", function (data) {
    const room = myRoom();
    if (!room || room.hostId !== socket.id) return;
    if (room.state !== "lobby" && room.state !== "ended") return;

    const rounds = Number(data && data.rounds);
    const time = Number(data && data.time);
    const pack = data && data.pack;

    if ([1, 2, 3, 4, 5].indexOf(rounds) !== -1) room.settings.rounds = rounds;
    if ([30, 45, 60, 90].indexOf(time) !== -1) room.settings.time = time;
    if (words[pack]) room.settings.pack = pack;

    sendRoom(room);
  });

  socket.on("startGame", function () {
    const room = myRoom();
    if (!room || room.hostId !== socket.id) return;
    if (room.state !== "lobby" && room.state !== "ended") return;
    if (room.players.length < 2) return;

    startGame(room);
  });

  socket.on("draw", function (seg) {
    const room = myRoom();
    if (!room || room.state !== "drawing" || room.drawerId !== socket.id) return;

    const clean = cleanSegment(seg);
    if (!clean) return;

    if (room.strokes.length < 30000) room.strokes.push(clean);
    socket.to(room.code).emit("draw", clean);
  });

  socket.on("clearCanvas", function () {
    const room = myRoom();
    if (!room || room.state !== "drawing" || room.drawerId !== socket.id) return;

    room.strokes = [];
    io.to(room.code).emit("clear");
  });

  socket.on("chat", function (text) {
    const room = myRoom();
    const player = room ? findPlayer(room, socket.id) : null;
    if (!room || !player) return;
    if (typeof text !== "string") return;

    text = text.trim().slice(0, 100);
    if (text === "") return;

    const isDrawer = room.drawerId === socket.id;
    const lower = text.toLowerCase();

    if (room.state === "drawing" && room.word) {
      const answer = room.word.answer.toLowerCase();
      const isCorrect = lower === answer || (room.word.alt && text === room.word.alt);

      // correct guess
      if (isCorrect && !isDrawer && !player.guessed) {
        const points = Math.max(50, Math.round((room.timeLeft / room.settings.time) * 300));
        player.score += points;
        player.guessed = true;

        const drawer = findPlayer(room, room.drawerId);
        if (drawer) drawer.score += 30;

        sendChat(room, player.name + " guessed the word! (+" + points + ")", "correct");
        sendRoom(room);

        // everybody except the drawer got it, so end early
        const others = room.players.filter(function (p) { return p.id !== room.drawerId; });
        const allDone = others.every(function (p) { return p.guessed; });
        if (allDone) endTurn(room);
        return;
      }

      // don't let the drawer or people who already guessed leak the word
      if ((isDrawer || player.guessed) && lower.indexOf(answer) !== -1) {
        return;
      }
    }

    io.to(room.code).emit("chat", { name: player.name, text: text, kind: "msg" });
  });

  socket.on("disconnect", function () {
    const room = myRoom();
    if (room) removePlayer(room, socket.id);
  });
});

server.listen(PORT, function () {
  console.log("Doodle Online running on http://localhost:" + PORT);
});
