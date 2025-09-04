import type * as Party from "partykit/server";
import { SnapshotInterpolation } from "@geckos.io/snapshot-interpolation";
import { snapshotModel, updateModel } from "./playerSchema";
import {
  BALL_WIDTH,
  GAME_FPS,
  NETWORK_FPS,
  TOTAL_PADDLE_HEIGHT,
} from "./constants";
import { parseUUID, uuidToId } from "./uuid";
import { encode } from "@msgpack/msgpack";

export default class Server implements Party.Server {
  constructor(readonly room: Party.Room) {}
  scores = [
    { id: "left", score: 0 },
    { id: "right", score: 0 },
  ];
  players: { id: string; x: number; y: number; vx: number; vy: number }[] = [];
  balls = [{ id: "0", x: 0.5, y: 0.2, vx: 0.3, vy: 0.2, snap: 0 }];
  SI = new SnapshotInterpolation();

  gameFPS = GAME_FPS;
  networkFPS = NETWORK_FPS;
  looping = false;
  lastLoop = Date.now();
  serializeFormat: "json" | "msgpack" | "byte" = "byte";
  loop() {
    if (!this.looping) return;
    const delta = (Date.now() - this.lastLoop) / 1000;

    for (const player of this.players) {
      player.x += player.vx * delta;
      player.y += player.vy * delta;
    }
    for (const ball of this.balls) {
      ball.x += ball.vx * delta;
      ball.y += ball.vy * delta;

      if (ball.y <= 0 || ball.y + BALL_WIDTH >= 1) {
        ball.vy *= -1;
      }

      // Side collisions
      if (ball.x <= 0 || ball.x + BALL_WIDTH >= 1) {
        const score = this.scores.find(
          (s) => s.id === (ball.x <= 0 ? "right" : "left")
        )!;
        score.score += 1;
        ball.vx = ball.x <= 0 ? 0.3 : -0.3;
        ball.vy = 0.3;
        ball.y = 0.2;
        ball.x = 0.5;
        ball.snap = 1;
      }

      // Paddle collisions
      for (const player of this.players) {
        const paddleBounds = [
          player.x,
          player.y,
          player.x + BALL_WIDTH,
          player.y + TOTAL_PADDLE_HEIGHT,
        ];
        if (ball.x <= paddleBounds[2] && ball.x >= paddleBounds[0]) {
          if (ball.y >= paddleBounds[1] && ball.y <= paddleBounds[3]) {
            ball.vx *= -1;
            break;
          }
        }
      }
    }

    this.lastLoop = Date.now();
    setTimeout(this.loop.bind(this), 1000 / this.gameFPS);
  }
  networkLoop() {
    if (!this.looping) return;

    const snapshot = this.SI.snapshot.create({
      scores: this.scores,
      players: this.players.map(({ vx, vy, ...b }) => b),
      balls: this.balls.map(({ vx, vy, ...b }) => b),
    });
    if (this.serializeFormat === "byte") {
      this.room.broadcast(snapshotModel.toBuffer(snapshot));
    }
    if (this.serializeFormat === "json") {
      this.room.broadcast(JSON.stringify(snapshot));
    }
    if (this.serializeFormat === "msgpack") {
      this.room.broadcast(encode(snapshot));
    }

    for (const ball of this.balls) {
      ball.snap = 0;
    }

    setTimeout(this.networkLoop.bind(this), 1000 / this.networkFPS);
  }

  onConnect(conn: Party.Connection, ctx: Party.ConnectionContext) {
    this.players.push({
      id: uuidToId(conn.id),
      x: this.players.length % 2 === 0 ? 0.05 : 0.95,
      y: 0.5,
      vx: 0,
      vy: 0,
    });
    if (!this.looping) {
      this.looping = true;
      this.loop();
      this.networkLoop();
    }
  }
  onClose(connection: Party.Connection): void | Promise<void> {
    const playerIndex = this.players.findIndex((p) => p.id === connection.id);
    this.players.splice(playerIndex, 1);
    if (this.players.length === 0) {
      this.looping = false;
    }
  }

  onMessage(message: string | ArrayBuffer, sender: Party.Connection) {
    if (message === "ping") {
      return sender.send("pong");
    }

    if (typeof message !== "string") {
      const player = this.players.find((p) => p.id === uuidToId(sender.id));
      if (player) {
        player.y = updateModel.fromBuffer(message).y - TOTAL_PADDLE_HEIGHT / 2;
      }
    } else if (message.startsWith("{")) {
      const data = JSON.parse(message);
      switch (data.type) {
        case "networkFPS":
          this.networkFPS = data.fps;
          this.room.broadcast(
            JSON.stringify({ type: "networkFPS", fps: data.fps })
          );
        case "serialize":
          this.serializeFormat = data.method;
      }
    }
  }
}

Server satisfies Party.Worker;
