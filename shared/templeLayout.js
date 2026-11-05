/** Shared render/interaction layout. All positions are world metres. */
export const HALL_LAYOUTS = Object.freeze({
  'hall-main': Object.freeze({
    id: 'hall-main',
    x: 0,
    z: -20,
    width: 35,
    depth: 23,
    floor: 1.35,
    eave: 10.6,
    rise: 3.7,
    detailScale: 1.35,
    stairsWidth: 10.5,
    stairsCount: 7,
    stairsDepth: 0.62,
    platformMargin: 1.6,
  }),
  'hall-west': Object.freeze({
    id: 'hall-west',
    x: -43,
    z: -33,
    width: 25,
    depth: 17,
    floor: 1.15,
    eave: 8.3,
    rise: 3.2,
    detailScale: 1.05,
    stairsWidth: 8.2,
    stairsCount: 6,
    stairsDepth: 0.6,
    platformMargin: 1.45,
  }),
  'hall-east': Object.freeze({
    id: 'hall-east',
    x: 43,
    z: -33,
    width: 25,
    depth: 17,
    floor: 1.15,
    eave: 8.3,
    rise: 3.2,
    detailScale: 1.05,
    stairsWidth: 8.2,
    stairsCount: 6,
    stairsDepth: 0.6,
    platformMargin: 1.45,
  }),
  'hall-north': Object.freeze({
    id: 'hall-north',
    x: 0,
    z: -66,
    width: 25,
    depth: 17,
    floor: 1.15,
    eave: 8.3,
    rise: 3.2,
    detailScale: 1.05,
    stairsWidth: 8.2,
    stairsCount: 6,
    stairsDepth: 0.6,
    platformMargin: 1.45,
  }),
});

export const SEATS = Object.freeze(
  Object.values(HALL_LAYOUTS).flatMap((hall) => {
    const main = hall.id === 'hall-main';
    const columns = main ? [-13, -9.7, -6.4, -3.3, 3.3, 6.4, 9.7, 13] : [-8, -4.2, 4.2, 8];
    const rows = main ? 6 : 5;
    const front = hall.z + hall.depth / 2;
    const spacing = main ? 2.3 : 2.05;
    const y = hall.floor + 0.2;
    return Array.from({ length: rows }, (_, row) =>
      columns.map((column, col) => {
        const x = hall.x + column;
        const z = front - (main ? 2.5 : 2.2) - row * spacing;
        return Object.freeze({
          id: `${hall.id}-seat-${String(row * columns.length + col + 1).padStart(2, '0')}`,
          hallId: hall.id,
          row,
          column: col,
          x,
          y,
          z,
          // The wooden fish sits on a low stand ahead and to the right of its cushion.
          moktak: Object.freeze({ x: x + 0.55, y: y + 0.43, z: z - 0.72 }),
        });
      }),
    ).flat();
  }),
);
