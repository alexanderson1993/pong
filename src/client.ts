import { SnapshotInterpolation } from "@geckos.io/snapshot-interpolation";
import { snapshotModel, updateModel } from "./playerSchema";
import "./styles.css";

import PartySocket from "partysocket";
import { NETWORK_FPS } from "./constants";
import { decode } from "@msgpack/msgpack";

const url = new URL(window.location.toString());
const isAdmin = url.searchParams.has("admin");
let SI = new SnapshotInterpolation(NETWORK_FPS);
let shouldInterpolate = false;

// Let's append all the messages we get into this DOM element
const output = document.getElementById("app") as HTMLDivElement;

const scoreLeft = Object.assign(document.createElement("div"), {
  id: "score-left",
  className: "score",
});
const scoreRight = Object.assign(document.createElement("div"), {
  id: "score-right",
  className: "score",
});
const scores = Object.assign(document.createElement("div"), { id: "scores" });

scores.appendChild(scoreLeft);
scores.appendChild(scoreRight);

output.appendChild(scores);

const stats = Object.assign(document.createElement("div"), {
  id: "stats",
  innerText: "Soup",
});
output.appendChild(stats);

const controls = Object.assign(document.createElement("div"), {
  id: "controls",
});
if (isAdmin) {
  output.appendChild(controls);
}
controls.appendChild(
  Object.assign(document.createElement("label"), {
    innerHTML: `<input type="radio" id="json" name="transport" /> JSON`,
  })
);

controls.appendChild(
  Object.assign(document.createElement("label"), {
    innerHTML: `<input type="radio" id="msgpack" name="transport" /> msgpack`,
  })
);

controls.appendChild(
  Object.assign(document.createElement("label"), {
    innerHTML: `<input type="radio" id="byte" name="transport" checked/> Byte Serialize`,
  })
);
controls.appendChild(
  Object.assign(document.createElement("label"), {
    innerHTML: `<input type="checkbox" id="interpolate" name="transport" ${
      shouldInterpolate ? "checked" : ""
    }/> Interpolate`,
  })
);
const fpsControl = Object.assign(document.createElement("input"), {
  placeholder: "Network FPS",
  value: NETWORK_FPS,
});
controls.appendChild(fpsControl);

document.getElementById("interpolate")?.addEventListener("change", (event) => {
  // @ts-ignore
  shouldInterpolate = event.target.checked;
});

const balls = new Map<string, HTMLDivElement>();
const players = new Map<string, HTMLDivElement>();
// A PartySocket is like a WebSocket, except it's a bit more magical.
// It handles reconnection logic, buffering messages while it's offline, and more.
const conn = new PartySocket({
  host: window.location.host,
  party: "pong-server",
  room: "my-new-room",
});

fpsControl.addEventListener("blur", (event) => {
  // @ts-ignore
  const val = Number(event.currentTarget?.value);
  if (!val) return;
  conn.send(JSON.stringify({ type: "networkFPS", fps: val }));
});
document.getElementById("byte")?.addEventListener("change", (event) => {
  // @ts-ignore
  if (event.target.checked) {
    conn.send(JSON.stringify({ type: "serialize", method: "byte" }));
  }
});
document.getElementById("json")?.addEventListener("change", (event) => {
  // @ts-ignore
  if (event.target.checked) {
    conn.send(JSON.stringify({ type: "serialize", method: "json" }));
  }
});
document.getElementById("msgpack")?.addEventListener("change", (event) => {
  // @ts-ignore
  if (event.target.checked) {
    conn.send(JSON.stringify({ type: "serialize", method: "msgpack" }));
  }
});

let roundtripTime = 30;
let startRoundtrip = Date.now();
setInterval(() => {
  conn.send("ping");
  startRoundtrip = Date.now();
}, 50);

let bandwidthTimer = Math.round(Date.now() / 1000);
let currentBandwidth = 0;
let nextBandwidth = 0;

// You can even start sending messages before the connection is open!
conn.addEventListener("message", async (event) => {
  if (event.data === "pong") {
    roundtripTime = Date.now() - startRoundtrip;
    return;
  }

  if (bandwidthTimer !== Math.round(Date.now() / 1000)) {
    bandwidthTimer = Math.round(Date.now() / 1000);
    currentBandwidth = nextBandwidth;
    nextBandwidth = 0;
  }
  const previousSnapshot = SI.vault.get();
  let snapshot;
  if (event.data instanceof Blob) {
    nextBandwidth += event.data.size;
    if ((await event.data.slice(0, 3).text()) === "#rf") {
      snapshot = snapshotModel.fromBuffer(await event.data.arrayBuffer());
    }
    if ((await event.data.slice(0, 4).text()) === "��id") {
      snapshot = decode(await event.data.arrayBuffer());
    }
  } else {
    if (typeof event.data === "string" && event.data.startsWith("{")) {
      nextBandwidth += event.data.length;
      const data = JSON.parse(event.data);
      switch (data.type) {
        case "networkFPS":
          SI = new SnapshotInterpolation(data.fps);
          return;
        default:
          snapshot = data;
      }
    }
  }

  const removeEls = new Set([...balls.keys(), ...players.keys()]);
  for (const ball of snapshot.state.balls) {
    removeEls.delete(ball.id);
    let ballEl = balls.get(ball.id);
    if (!ballEl) {
      ballEl = Object.assign(document.createElement("div"), {
        id: ball.id,
        className: "ball-container",
      });
      const ballObj = Object.assign(document.createElement("div"), {
        className: "ball",
      });
      ballEl.appendChild(ballObj);
      output.appendChild(ballEl);
      balls.set(ball.id, ballEl);
    }
    if (ball.snap) {
      if (previousSnapshot && !Array.isArray(previousSnapshot?.state)) {
        for (const oldBall of previousSnapshot.state.balls) {
          oldBall.x = ball.x;
          oldBall.y = ball.y;
        }
      }
    }
  }

  for (const player of snapshot.state.players) {
    removeEls.delete(player.id);
    let playerEl = players.get(player.id);
    if (!playerEl) {
      playerEl = Object.assign(document.createElement("div"), {
        id: player.id,
        className: "player-container",
      });
      const playerObj = Object.assign(document.createElement("div"), {
        className: "player",
      });
      playerEl.appendChild(playerObj);
      output.appendChild(playerEl);
      players.set(player.id, playerEl);
    }
  }

  for (const score of snapshot.state.scores) {
    if (score.id.startsWith("left")) {
      scoreLeft.innerText = score.score;
    } else {
      scoreRight.innerText = score.score;
    }
  }

  for (const elId of removeEls) {
    const el = balls.get(elId);
    el?.remove();
    balls.delete(elId);
    players.delete(elId);
  }

  SI.snapshot.add(snapshot);
});

function loop() {
  const vault = SI.vault.get();

  const interpolatedBalls = shouldInterpolate
    ? SI.calcInterpolation("x y", "balls")?.state || []
    : // @ts-ignore
      vault?.state.balls || [];
  for (const ball of interpolatedBalls) {
    const el = balls.get(ball.id);
    if (el) {
      el.style.transform = `translate(${Number(ball.x) * 100}%, ${
        Number(ball.y) * 100
      }%)`;
    }
  }

  const interpolatedPlayers = shouldInterpolate
    ? SI.calcInterpolation("x y", "players")?.state || []
    : // @ts-ignore
      vault?.state.players || [];
  for (const player of interpolatedPlayers) {
    const el = players.get(player.id);
    if (el) {
      el.style.transform = `translate(${Number(player.x) * 100}%, ${
        Number(player.y) * 100
      }%)`;
    }
  }

  stats.innerHTML = `Bandwidth: ${currentBandwidth}bps<br/>Roundtrip: ${roundtripTime}ms`;
  requestAnimationFrame(loop);
}

loop();

document.addEventListener("pointermove", (e) => {
  const y = e.clientY / window.innerHeight;

  conn.send(updateModel.toBuffer({ y }));
});
