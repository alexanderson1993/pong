import {
  uint8,
  int16,
  string8,
  uint64,
  Model,
  BufferSchema,
} from "@geckos.io/typed-array-buffer-schema";

const playerSchema = BufferSchema.schema("player", {
  id: string8,
  x: { type: int16, digits: 4 },
  y: { type: int16, digits: 4 },
});
const ballSchema = BufferSchema.schema("ball", {
  id: string8,
  x: { type: int16, digits: 4 },
  y: { type: int16, digits: 4 },
  snap: { type: uint8 },
});
const scoreSchema = BufferSchema.schema("score", {
  id: string8,
  score: { type: int16, digits: 0 },
});
const snapshotSchema = BufferSchema.schema("snapshot", {
  id: { type: string8, length: 6 },
  time: uint64,
  state: {
    players: [playerSchema],
    balls: [ballSchema],
    scores: [scoreSchema],
  },
});
export const snapshotModel = new Model(snapshotSchema);

const updateSchema = BufferSchema.schema("update", {
  y: { type: int16, digits: 4 },
});

export const updateModel = new Model(updateSchema);
