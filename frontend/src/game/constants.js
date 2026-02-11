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
// Setup Types based on Ma/Sang position in the 4 slots (Inner-Left, Outer-Left, Inner-Right, Outer-Right)
// The indices for the relevant row (0 for Han, 9 for Cho) are:
// Left Outer: 1, Left Inner: 2, Right Inner: 6, Right Outer: 7
// Note: Standard naming usually refers to "Inside" and "Outside".
// Ma-Sang-Ma-Sang (Left to Right): Ma(1), Sang(2), Ma(6), Sang(7) -- (Outer, Inner, Inner, Outer)?
// Actually, usually described as "Left side Ma/Sang, Right side Ma/Sang".
// Let's use specific indices for clarity.
// Slots: 1(L-Out), 2(L-In), 6(R-In), 7(R-Out).
export const SETUP_TYPES = {
  MSMS: 'Ma-Sang-Ma-Sang', // 1:Ma, 2:Sang, 6:Ma, 7:Sang
  MSSM: 'Ma-Sang-Sang-Ma', // 1:Ma, 2:Sang, 6:Sang, 7:Ma
  SMMS: 'Sang-Ma-Ma-Sang', // 1:Sang, 2:Ma, 6:Ma, 7:Sang
  SMSM: 'Sang-Ma-Sang-Ma', // 1:Sang, 2:Ma, 6:Sang, 7:Ma
};

// Helper to get row configuration based on setup type and team
// Han is Row 0, Cho is Row 9.
const getSetupRow = (team, setupType) => {
  const row = Array(9).fill(null);
  
  // Fixed pieces
  row[0] = { team, type: PIECE_TYPE.CHARIOT };
  row[8] = { team, type: PIECE_TYPE.CHARIOT };
  row[3] = { team, type: PIECE_TYPE.GUARD };
  row[5] = { team, type: PIECE_TYPE.GUARD };
  if (team === TEAM.HAN) {
      // Han General is at (1,4), so row 0, col 4 is empty?
      // No, in my INITIAL_BOARD, Han General was at (1,4).
      // Row 0 has 4 empty slot for General? No.
      // Row 0 is the back rank.
      // Wait, standard Janggi board:
      // Row 0: Cha, X, X, Sa, Empty, Sa, X, X, Cha.
      // Row 1: General at 4.
      // Row 9: Cha, X, X, Sa, Empty, Sa, X, X, Cha.
      // Row 8: General at 4.
      row[4] = null; 
  } else {
      row[4] = null;
  }

  // Variable pieces (Ma, Sang) at indices 1, 2, 6, 7
  let p1, p2, p6, p7;
  const Ma = { team, type: PIECE_TYPE.HORSE };
  const Sang = { team, type: PIECE_TYPE.ELEPHANT };

  switch (setupType) {
    case SETUP_TYPES.MSMS: // M S M S
      p1 = Ma; p2 = Sang; p6 = Ma; p7 = Sang;
      break;
    case SETUP_TYPES.MSSM: // M S S M
      p1 = Ma; p2 = Sang; p6 = Sang; p7 = Ma;
      break;
    case SETUP_TYPES.SMMS: // S M M S
      p1 = Sang; p2 = Ma; p6 = Ma; p7 = Sang;
      break;
    case SETUP_TYPES.SMSM: // S M S M
      p1 = Sang; p2 = Ma; p6 = Sang; p7 = Ma;
      break;
    default: // Default to MSMS if undefined
      p1 = Ma; p2 = Sang; p6 = Ma; p7 = Sang;
      break;
  }

  row[1] = p1;
  row[2] = p2;
  row[6] = p6;
  row[7] = p7;

  return row;
};


export const generateBoard = (choSetup, hanSetup) => {
  const board = Array(10).fill(null).map(() => Array(9).fill(null));

  // --- HAN (Top, Red) ---
  // Row 0: Back rank (Variable)
  board[0] = getSetupRow(TEAM.HAN, hanSetup);
  
  // Row 1: General
  board[1][4] = { team: TEAM.HAN, type: PIECE_TYPE.GENERAL };
  
  // Row 2: Cannons
  board[2][1] = { team: TEAM.HAN, type: PIECE_TYPE.CANNON };
  board[2][7] = { team: TEAM.HAN, type: PIECE_TYPE.CANNON };
  
  // Row 3: Soldiers
  board[3][0] = { team: TEAM.HAN, type: PIECE_TYPE.SOLDIER };
  board[3][2] = { team: TEAM.HAN, type: PIECE_TYPE.SOLDIER };
  board[3][4] = { team: TEAM.HAN, type: PIECE_TYPE.SOLDIER };
  board[3][6] = { team: TEAM.HAN, type: PIECE_TYPE.SOLDIER };
  board[3][8] = { team: TEAM.HAN, type: PIECE_TYPE.SOLDIER };


  // --- CHO (Bottom, Blue) ---
  // Row 6: Soldiers
  board[6][0] = { team: TEAM.CHO, type: PIECE_TYPE.SOLDIER };
  board[6][2] = { team: TEAM.CHO, type: PIECE_TYPE.SOLDIER };
  board[6][4] = { team: TEAM.CHO, type: PIECE_TYPE.SOLDIER };
  board[6][6] = { team: TEAM.CHO, type: PIECE_TYPE.SOLDIER };
  board[6][8] = { team: TEAM.CHO, type: PIECE_TYPE.SOLDIER };

  // Row 7: Cannons
  board[7][1] = { team: TEAM.CHO, type: PIECE_TYPE.CANNON };
  board[7][7] = { team: TEAM.CHO, type: PIECE_TYPE.CANNON };

  // Row 8: General
  board[8][4] = { team: TEAM.CHO, type: PIECE_TYPE.GENERAL };

  // Row 9: Back rank (Variable)
  board[9] = getSetupRow(TEAM.CHO, choSetup);

  return board;
};
