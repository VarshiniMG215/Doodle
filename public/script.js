const socket = io();

// ---------- state ----------
let room = null;       // latest room info from the server
let myWord = "";       // only the drawer gets this
let isDrawing = false;
let lastPos = null;
let brushColor = "#222222";
let erasing = false;

const colorList = ["#222222", "#e03131", "#1971c2", "#2f9e44", "#f08c00", "#862e9c"];

// room code from the link, like ?room=AB3XY
const params = new URLSearchParams(window.location.search);
const inviteCode = (params.get("room") || "").toUpperCase();


// ---------- elements ----------
function $(id) {
  return document.getElementById(id);
}

const screens = ["homeScreen", "lobbyScreen", "gameScreen", "endScreen"];
const board = $("board");
const ctx = board.getContext("2d");
board.width = 800;
board.height = 500;


// ---------- helpers ----------
function showScreen(name) {
  for (let i = 0; i < screens.length; i++) {
    $(screens[i]).classList.add("hidden");
  }
  $(name).classList.remove("hidden");
}

function amIHost() {
  return room && room.hostId === socket.id;
}

function amIDrawer() {
  return room && room.state === "drawing" && room.drawerId === socket.id;
}

function whiteOut() {
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, board.width, board.height);
}

function drawLine(seg) {
  ctx.strokeStyle = seg.color;
  ctx.lineWidth = seg.size;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.beginPath();
  ctx.moveTo(seg.x0, seg.y0);
  ctx.lineTo(seg.x1, seg.y1);
  ctx.stroke();
}

function fillPlayers(listEl) {
  listEl.innerHTML = "";

  for (let i = 0; i < room.players.length; i++) {
    const p = room.players[i];
    const li = document.createElement("li");
    li.textContent = p.name + (p.id === socket.id ? " (you)" : "") + " - " + p.score;

    if (p.id === room.hostId) addTag(li, "host", "");
    if (room.state === "drawing" && p.id === room.drawerId) addTag(li, "drawing", "drawing");
    if (room.state === "drawing" && p.guessed) addTag(li, "guessed", "guessed");

    listEl.appendChild(li);
  }
}

function addTag(li, text, extraClass) {
  const span = document.createElement("span");
  span.className = "tag " + extraClass;
  span.textContent = text;
  li.appendChild(span);
}

function addChat(data) {
  const p = document.createElement("p");
  p.className = data.kind;

  if (data.kind === "msg") {
    const strong = document.createElement("strong");
    strong.textContent = data.name + ": ";
    p.appendChild(strong);
    p.appendChild(document.createTextNode(data.text));
  } else {
    p.textContent = data.text;
  }

  const box = $("chatBox");
  box.appendChild(p);
  box.scrollTop = box.scrollHeight;
}


// ---------- drawing the screens ----------
function render() {
  if (!room) {
    showScreen("homeScreen");
    return;
  }

  if (room.state === "lobby") {
    showScreen("lobbyScreen");
    renderLobby();
  } else if (room.state === "ended") {
    showScreen("endScreen");
    renderEnd();
  } else {
    showScreen("gameScreen");
    renderGame();
  }
}

function renderLobby() {
  $("shareLink").value = window.location.origin + window.location.pathname + "?room=" + room.code;
  fillPlayers($("lobbyPlayers"));

  $("roundsSelect").value = room.settings.rounds;
  $("timeSelect").value = room.settings.time;
  $("packSelect").value = room.settings.pack;

  const host = amIHost();
  $("roundsSelect").disabled = !host;
  $("timeSelect").disabled = !host;
  $("packSelect").disabled = !host;

  $("startBtn").classList.toggle("hidden", !host);
  $("startBtn").disabled = room.players.length < 2;

  if (room.players.length < 2) {
    $("lobbyNote").textContent = "You need at least 2 players to start.";
  } else if (host) {
    $("lobbyNote").textContent = "";
  } else {
    $("lobbyNote").textContent = "Waiting for the host to start the game...";
  }
}

function renderGame() {
  $("roundInfo").textContent = "Round " + room.round + " of " + room.settings.rounds;
  $("timerText").textContent = room.timeLeft + "s";
  fillPlayers($("gamePlayers"));

  if (amIDrawer()) {
    $("hintText").textContent = "Draw: " + myWord;
  } else {
    $("hintText").textContent = room.hint;
  }

  $("tools").classList.toggle("hidden", !amIDrawer());
  board.style.cursor = amIDrawer() ? "crosshair" : "default";

  if (room.state === "between") {
    $("banner").textContent = "The word was: " + room.revealWord;
    $("banner").classList.remove("hidden");
  } else {
    $("banner").classList.add("hidden");
  }
}

function renderEnd() {
  const sorted = room.players.slice().sort(function (a, b) {
    return b.score - a.score;
  });

  if (sorted.length > 1 && sorted[0].score === sorted[1].score) {
    $("winnerText").textContent = "It's a tie!";
  } else {
    $("winnerText").textContent = sorted[0].name + " wins!";
  }

  const list = $("finalList");
  list.innerHTML = "";
  for (let i = 0; i < sorted.length; i++) {
    const li = document.createElement("li");
    li.textContent = sorted[i].name + ": " + sorted[i].score;
    list.appendChild(li);
  }

  const host = amIHost();
  $("againBtn").classList.toggle("hidden", !host);
  $("againBtn").disabled = room.players.length < 2;
  $("endNote").textContent = host ? "" : "Waiting for the host to start another game...";
}


// ---------- home screen ----------
function getName() {
  const name = $("nameInput").value.trim();
  if (name === "") {
    $("homeError").textContent = "Enter your name first.";
    return "";
  }
  try {
    localStorage.setItem("doodleName", name);
  } catch (e) {
    // ignore
  }
  return name;
}

function afterJoin(res) {
  if (!res.ok) {
    $("homeError").textContent = res.error;
    return;
  }
  $("homeError").textContent = "";
  window.history.replaceState(null, "", "?room=" + res.code);
}

$("createBtn").addEventListener("click", function () {
  const name = getName();
  if (name === "") return;
  socket.emit("createRoom", { name: name }, afterJoin);
});

$("joinBtn").addEventListener("click", function () {
  const name = getName();
  if (name === "") return;
  socket.emit("joinRoom", { name: name, code: $("codeInput").value }, afterJoin);
});

$("inviteJoinBtn").addEventListener("click", function () {
  const name = getName();
  if (name === "") return;
  socket.emit("joinRoom", { name: name, code: inviteCode }, afterJoin);
});

$("copyBtn").addEventListener("click", function () {
  const input = $("shareLink");
  input.select();

  if (navigator.clipboard) {
    navigator.clipboard.writeText(input.value);
  } else {
    document.execCommand("copy");
  }
  $("copyBtn").textContent = "Copied!";
  setTimeout(function () {
    $("copyBtn").textContent = "Copy link";
  }, 1500);
});


// ---------- lobby ----------
function sendSettings() {
  socket.emit("settings", {
    rounds: $("roundsSelect").value,
    time: $("timeSelect").value,
    pack: $("packSelect").value
  });
}

$("roundsSelect").addEventListener("change", sendSettings);
$("timeSelect").addEventListener("change", sendSettings);
$("packSelect").addEventListener("change", sendSettings);

$("startBtn").addEventListener("click", function () {
  socket.emit("startGame");
});

$("againBtn").addEventListener("click", function () {
  socket.emit("startGame");
});


// ---------- chat ----------
function sendChat() {
  const text = $("chatInput").value.trim();
  if (text === "") return;
  socket.emit("chat", text);
  $("chatInput").value = "";
}

$("sendBtn").addEventListener("click", sendChat);
$("chatInput").addEventListener("keydown", function (e) {
  if (e.key === "Enter") sendChat();
});


// ---------- drawing with mouse or finger ----------
function getPos(e) {
  const rect = board.getBoundingClientRect();
  return {
    x: Math.round((e.clientX - rect.left) * (board.width / rect.width)),
    y: Math.round((e.clientY - rect.top) * (board.height / rect.height))
  };
}

function makeSegment(from, to) {
  const size = Number($("brushSize").value);
  return {
    x0: from.x, y0: from.y, x1: to.x, y1: to.y,
    color: erasing ? "#ffffff" : brushColor,
    size: erasing ? size * 3 : size
  };
}

board.addEventListener("pointerdown", function (e) {
  if (!amIDrawer()) return;
  isDrawing = true;
  if (board.setPointerCapture) board.setPointerCapture(e.pointerId);

  lastPos = getPos(e);
  const seg = makeSegment(lastPos, lastPos); // a dot
  drawLine(seg);
  socket.emit("draw", seg);
});

board.addEventListener("pointermove", function (e) {
  if (!isDrawing || !amIDrawer()) return;

  const pos = getPos(e);
  const seg = makeSegment(lastPos, pos);
  drawLine(seg);
  socket.emit("draw", seg);
  lastPos = pos;
});

function stopDrawing() {
  isDrawing = false;
}
board.addEventListener("pointerup", stopDrawing);
board.addEventListener("pointercancel", stopDrawing);
board.addEventListener("pointerleave", stopDrawing);


// ---------- tools ----------
function makeColorButtons() {
  const box = $("colors");

  for (let i = 0; i < colorList.length; i++) {
    const btn = document.createElement("button");
    btn.className = "color-btn";
    btn.style.background = colorList[i];
    btn.setAttribute("aria-label", "colour " + (i + 1));
    if (i === 0) btn.classList.add("selected");

    btn.addEventListener("click", function () {
      brushColor = colorList[i];
      erasing = false;
      $("eraserBtn").classList.remove("on");

      const all = box.querySelectorAll(".color-btn");
      for (let j = 0; j < all.length; j++) {
        all[j].classList.remove("selected");
      }
      btn.classList.add("selected");
    });

    box.appendChild(btn);
  }
}

$("eraserBtn").addEventListener("click", function () {
  erasing = !erasing;
  $("eraserBtn").classList.toggle("on", erasing);
});

$("clearBtn").addEventListener("click", function () {
  socket.emit("clearCanvas");
});


// ---------- messages from the server ----------
socket.on("room", function (data) {
  room = data;
  render();
});

socket.on("yourWord", function (word) {
  myWord = word;
  if (room && room.state === "drawing") renderGame();
});

socket.on("timer", function (seconds) {
  if (room) room.timeLeft = seconds;
  $("timerText").textContent = seconds + "s";
});

socket.on("draw", function (seg) {
  drawLine(seg);
});

socket.on("clear", function () {
  whiteOut();
});

socket.on("strokes", function (list) {
  whiteOut();
  for (let i = 0; i < list.length; i++) {
    drawLine(list[i]);
  }
});

socket.on("chat", function (data) {
  addChat(data);
});

socket.on("disconnect", function () {
  room = null;
  showScreen("homeScreen");
  $("homeError").textContent = "Connection lost. Refresh the page to join again.";
});


// ---------- start ----------
whiteOut();
makeColorButtons();

try {
  $("nameInput").value = localStorage.getItem("doodleName") || "";
} catch (e) {
  // ignore
}

if (inviteCode !== "") {
  $("createArea").classList.add("hidden");
  $("inviteArea").classList.remove("hidden");
  $("inviteText").textContent = "You are invited to room " + inviteCode + ". Enter your name and join.";
}

showScreen("homeScreen");
