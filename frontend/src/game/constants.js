export const TEAM = {
  CHO: 'cho', // Blue/Green
  HAN: 'han', // Red
};

export const PIECE_TYPE = {
  GENERAL: 'wang',
  GUARD: 'sa',
  HORSE: 'ma',
  ELEPHANT: 'sang',
  CHARIOT: 'cha',
  CANNON: 'po',
  SOLDIER: 'jol', // or byung for Han, but file name uses 'jol' for Cho and 'jol' is generic enough, or 'byung'
  // checking file list: chojol, hanjol. So 'jol' is used for both files names mostly? 
  // Wait, file list has 'chojol' and 'hanjol'. So 'jol' is the suffix in file? No.
  // The files are `chojol.svg`, `hanjol.svg`. So `jol` is the type key in filename.
};

// Map convenient names to file suffixes if needed
export const FILE_PIECE_TYPE = {
  [PIECE_TYPE.GENERAL]: 'wang',
  [PIECE_TYPE.GUARD]: 'sa',
  [PIECE_TYPE.HORSE]: 'ma',
  [PIECE_TYPE.ELEPHANT]: 'sang',
  [PIECE_TYPE.CHARIOT]: 'cha',
  [PIECE_TYPE.CANNON]: 'po',
  [PIECE_TYPE.SOLDIER]: 'jol',
};

// 10 rows (0-9), 9 cols (0-8)
export const INITIAL_BOARD = [
  // Row 0 (Han back rank)
  [
    { team: TEAM.HAN, type: PIECE_TYPE.CHARIOT },
    { team: TEAM.HAN, type: PIECE_TYPE.ELEPHANT }, // Default: Sang
    { team: TEAM.HAN, type: PIECE_TYPE.HORSE },    // Default: Ma
    { team: TEAM.HAN, type: PIECE_TYPE.GUARD },
    null, // General starts in center of palace (Row 1, Col 4)
    { team: TEAM.HAN, type: PIECE_TYPE.GUARD },
    { team: TEAM.HAN, type: PIECE_TYPE.HORSE },    // Default: Ma
    { team: TEAM.HAN, type: PIECE_TYPE.ELEPHANT }, // Default: Sang
    { team: TEAM.HAN, type: PIECE_TYPE.CHARIOT },
  ],
  // Row 1
  [
    null, null, null, null,
    { team: TEAM.HAN, type: PIECE_TYPE.GENERAL },
    null, null, null, null,
  ],
  // Row 2 (Cannons)
  [
    null,
    { team: TEAM.HAN, type: PIECE_TYPE.CANNON },
    null, null, null, null, null,
    { team: TEAM.HAN, type: PIECE_TYPE.CANNON },
    null,
  ],
  // Row 3 (Soldiers)
  [
    { team: TEAM.HAN, type: PIECE_TYPE.SOLDIER },
    null,
    { team: TEAM.HAN, type: PIECE_TYPE.SOLDIER },
    null,
    { team: TEAM.HAN, type: PIECE_TYPE.SOLDIER },
    null,
    { team: TEAM.HAN, type: PIECE_TYPE.SOLDIER },
    null,
    { team: TEAM.HAN, type: PIECE_TYPE.SOLDIER },
  ],
  // Row 4 (Empty)
  Array(9).fill(null),
  // Row 5 (Empty)
  Array(9).fill(null),
  // Row 6 (Cho Soldiers)
  [
    { team: TEAM.CHO, type: PIECE_TYPE.SOLDIER },
    null,
    { team: TEAM.CHO, type: PIECE_TYPE.SOLDIER },
    null,
    { team: TEAM.CHO, type: PIECE_TYPE.SOLDIER },
    null,
    { team: TEAM.CHO, type: PIECE_TYPE.SOLDIER },
    null,
    { team: TEAM.CHO, type: PIECE_TYPE.SOLDIER },
  ],
  // Row 7 (Cho Cannons)
  [
    null,
    { team: TEAM.CHO, type: PIECE_TYPE.CANNON },
    null, null, null, null, null,
    { team: TEAM.CHO, type: PIECE_TYPE.CANNON },
    null,
  ],
  // Row 8
  [
    null, null, null, null,
    { team: TEAM.CHO, type: PIECE_TYPE.GENERAL },
    null, null, null, null,
  ],
  // Row 9 (Cho back rank)
  [
    { team: TEAM.CHO, type: PIECE_TYPE.CHARIOT },
    { team: TEAM.CHO, type: PIECE_TYPE.ELEPHANT },
    { team: TEAM.CHO, type: PIECE_TYPE.HORSE },
    { team: TEAM.CHO, type: PIECE_TYPE.GUARD },
    null,
    { team: TEAM.CHO, type: PIECE_TYPE.GUARD },
    { team: TEAM.CHO, type: PIECE_TYPE.HORSE },
    { team: TEAM.CHO, type: PIECE_TYPE.ELEPHANT },
    { team: TEAM.CHO, type: PIECE_TYPE.CHARIOT },
  ],
];
