import { TEAM, PIECE_TYPE } from './constants';

// ... existing getValidMoves ... (keep as is, but maybe rename or use a wrapper)

// Original getValidMoves returns purely geometric valid moves (including captures)
// It does NOT check if the move leaves the King in check.
export const getValidMoves = (board, r, c) => {
    // ... (logic from before) ...
    const piece = board[r][c];
    if (!piece) return [];
  
    const moves = [];
    const { team, type } = piece;
  
    // Helper to check bounds and occupancy
    const isValidPos = (nr, nc) => {
      if (nr < 0 || nr >= 10 || nc < 0 || nc >= 9) return false;
      const target = board[nr][nc];
      if (target && target.team === team) return false; // Blocked by own piece
      return true; // Empty or enemy (capture)
    };
  
    // Helper for step moves (King, Guard, Soldier)
    const addStepMove = (dr, dc) => {
      const nr = r + dr;
      const nc = c + dc;
      if (isValidPos(nr, nc)) {
        moves.push({ r: nr, c: nc });
      }
    };
  
    // Helper for linear moves (Chariot, Cannon)
    // isCannon: boolean. If true, needs jump logic.
    const addLinearMoves = (isCannon) => {
      const directions = [
        { dr: -1, dc: 0 }, { dr: 1, dc: 0 }, { dr: 0, dc: -1 }, { dr: 0, dc: 1 }
      ];
  
      // Orthogonal
      for (const dir of directions) {
        let jumpFound = false; // For cannon
        for (let i = 1; i < 10; i++) {
          const nr = r + dir.dr * i;
          const nc = c + dir.dc * i;
          if (nr < 0 || nr >= 10 || nc < 0 || nc >= 9) break;
  
          const target = board[nr][nc];
          
          if (isCannon) {
             if (!jumpFound) {
               if (target) {
                 // Found screen.
                 // Cannot use another Cannon as screen.
                 if (target.type === PIECE_TYPE.CANNON) break; 
                 jumpFound = true;
               }
             } else {
               // After jump
               if (target) {
                 // Capture?
                 if (target.team !== team && target.type !== PIECE_TYPE.CANNON) {
                   moves.push({ r: nr, c: nc });
                 }
                 break; // Stop after first piece (capture or block)
               } else {
                 // Empty space after jump
                 moves.push({ r: nr, c: nc });
               }
             }
          } else {
            // Chariot (or other sliding?) No, only Chariot slides orthogonally.
            if (target) {
              if (target.team !== team) {
                moves.push({ r: nr, c: nc });
              }
              break; // Blocked
            } else {
              moves.push({ r: nr, c: nc });
            }
          }
        }
      }
      
      // Palace Diagonal Logic for Cha/Po
      if (isInPalace(r, c)) {
           const diagonals = getPalaceDiagonalPaths(r, c);
           diagonals.forEach(path => {
               if (isCannon) {
                   // Cannon Palace Jump
                   let jumpFound = false;
                   for (const pos of path) {
                       const target = board[pos.r][pos.c];
                       if (!jumpFound) {
                           if (target) {
                               if (target.type === PIECE_TYPE.CANNON) break;
                               jumpFound = true;
                           }
                       } else {
                           if (target) {
                               if (target.team !== team && target.type !== PIECE_TYPE.CANNON) moves.push(pos);
                               break;
                           } else {
                               moves.push(pos);
                           }
                       }
                   }
               } else {
                   // Chariot Palace Slide
                   for (const pos of path) {
                      const target = board[pos.r][pos.c];
                      if (target) {
                          if (target.team !== team) moves.push(pos);
                          break;
                      } else {
                          moves.push(pos);
                      }
                  }
               }
          });
      }
    };
  
    switch (type) {
      case PIECE_TYPE.GENERAL:
      case PIECE_TYPE.GUARD:
        getPalaceMoves(r, c).forEach(m => {
          if (isValidPos(m.r, m.c)) moves.push(m);
        });
        break;
  
      case PIECE_TYPE.HORSE:
        {
          const horseMoves = [
            { r: -2, c: -1, check: { r: -1, c: 0 } },
            { r: -2, c: 1, check: { r: -1, c: 0 } },
            { r: 2, c: -1, check: { r: 1, c: 0 } },
            { r: 2, c: 1, check: { r: 1, c: 0 } },
            { r: -1, c: -2, check: { r: 0, c: -1 } },
            { r: 1, c: -2, check: { r: 0, c: -1 } },
            { r: -1, c: 2, check: { r: 0, c: 1 } },
            { r: 1, c: 2, check: { r: 0, c: 1 } },
          ];
          for (const hm of horseMoves) {
             const nr = r + hm.r;
             const nc = c + hm.c;
             const br = r + hm.check.r;
             const bc = c + hm.check.c;
             if (board[br] && !board[br][bc]) { // Not blocked at check point
               if (isValidPos(nr, nc)) moves.push({ r: nr, c: nc });
             }
          }
        }
        break;
  
      case PIECE_TYPE.ELEPHANT:
        {
           const elephantMoves = [
              // Up-Left/Right
              { r: -3, c: -2, checks: [{r:-1, c:0}, {r:-2, c:-1}] },
              { r: -3, c: 2, checks: [{r:-1, c:0}, {r:-2, c:1}] },
              // Down-Left/Right
              { r: 3, c: -2, checks: [{r:1, c:0}, {r:2, c:-1}] },
              { r: 3, c: 2, checks: [{r:1, c:0}, {r:2, c:1}] },
              // Left-Up/Down
              { r: -2, c: -3, checks: [{r:0, c:-1}, {r:-1, c:-2}] },
              { r: 2, c: -3, checks: [{r:0, c:-1}, {r:1, c:-2}] },
              // Right-Up/Down
              { r: -2, c: 3, checks: [{r:0, c:1}, {r:-1, c:2}] },
              { r: 2, c: 3, checks: [{r:0, c:1}, {r:1, c:2}] },
           ];
           for (const em of elephantMoves) {
               const nr = r + em.r;
               const nc = c + em.c;
               if (isValidPos(nr, nc)) {
                   // Check blocks
                   const b1 = board[r + em.checks[0].r][c + em.checks[0].c];
                   const b2 = board[r + em.checks[1].r][c + em.checks[1].c];
                   if (!b1 && !b2) {
                       moves.push({ r: nr, c: nc });
                   }
               }
           }
        }
        break;
  
      case PIECE_TYPE.CHARIOT:
         addLinearMoves(false); // Can slide
         break;
  
      case PIECE_TYPE.CANNON:
         addLinearMoves(true);
         break;
  
      case PIECE_TYPE.SOLDIER:
        {
           const dr = team === TEAM.HAN ? 1 : -1;
           // Forward
           addStepMove(dr, 0);
           // Side
           addStepMove(0, -1);
           addStepMove(0, 1);
           
           // Palace diagonal
           if (isInPalace(r, c)) {
               const palaceMoves = getPalaceMoves(r, c); 
               palaceMoves.forEach(m => {
                   const dRow = m.r - r;
                   const dCol = m.c - c;
                   if (dRow === dr && Math.abs(dCol) === 1) {
                       if (isValidPos(m.r, m.c)) moves.push(m);
                   }
               });
           }
        }
        break;
    }
    
    return moves;
};

// --- Check / Checkmate Logic ---

// Check if 'team' is in Check.
// This means the General of 'team' is being attacked by any opponent piece.
export const isCheck = (board, team) => {
    // 1. Find General
    let generalPos = null;
    for (let r = 0; r < 10; r++) {
        for (let c = 0; c < 9; c++) {
            const p = board[r][c];
            if (p && p.team === team && p.type === PIECE_TYPE.GENERAL) {
                generalPos = { r, c };
                break;
            }
        }
        if (generalPos) break;
    }

    if (!generalPos) return false; // Should not happen

    // 2. Check if any opponent piece can move to generalPos
    for (let r = 0; r < 10; r++) {
        for (let c = 0; c < 9; c++) {
            const p = board[r][c];
            if (p && p.team !== team) {
                const moves = getValidMoves(board, r, c);
                if (moves.some(m => m.r === generalPos.r && m.c === generalPos.c)) {
                    return true;
                }
            }
        }
    }
    return false;
};

// Wrapper for getValidMoves that only returns moves that do NOT result in self-check.
export const getSafeMoves = (board, r, c) => {
    const rawMoves = getValidMoves(board, r, c);
    const piece = board[r][c];
    if (!piece) return [];
    
    const safeMoves = [];
    
    for (const move of rawMoves) {
        // Stimulate move
        const newBoard = board.map(row => [...row]); // Shallow copy rows
        newBoard[move.r][move.c] = piece;
        newBoard[r][c] = null;
        
        // Check if MY team is in check after this move
        if (!isCheck(newBoard, piece.team)) {
            safeMoves.push(move);
        }
    }
    
    return safeMoves;
};

// Check if 'team' has valid moves. If not, and is in Check, it's Checkmate.
export const isCheckmate = (board, team) => {
    // 1. Is in Check? (If not in check, it's Stalemate or just stuck? Janggi doesn't have stalemate draw usually, you lose if no moves? Or pass?)
    // Janggi allows passing, but passing is a specific action. 
    // If you are in Check, you MUST resolve it. If you can't, you lose.
    if (!isCheck(board, team)) return false; 
    
    // 2. Can any piece move to resolve check?
    for (let r = 0; r < 10; r++) {
        for (let c = 0; c < 9; c++) {
            const p = board[r][c];
            if (p && p.team === team) {
                const moves = getSafeMoves(board, r, c);
                if (moves.length > 0) return false; // At least one safe move exists
            }
        }
    }
    
    return true; // No safe moves
};


// Utils
function isInPalace(r, c) {
    if (c < 3 || c > 5) return false;
    if (r >= 0 && r <= 2) return true; // Top palace
    if (r >= 7 && r <= 9) return true; // Bottom palace
    return false;
}

function getPalaceMoves(r, c) {
    const moves = [];
    const dirs = [[-1,0], [1,0], [0,-1], [0,1]];
    dirs.forEach(([dr, dc]) => {
        const nr = r + dr, nc = c + dc;
        if (isInPalace(nr, nc)) moves.push({r:nr, c:nc});
    });
    
    const centers = [[1,4], [8,4]];
    const isCenter = centers.some(p => p[0] === r && p[1] === c);
    
    if (isCenter) {
        const diags = [[-1,-1], [-1,1], [1,-1], [1,1]];
        diags.forEach(([dr, dc]) => {
            const nr = r + dr, nc = c + dc;
            if (isInPalace(nr, nc)) moves.push({r:nr, c:nc});
        });
    } else {
        if ((Math.abs(r-1) === 1 && Math.abs(c-4) === 1) || (Math.abs(r-8) === 1 && Math.abs(c-4) === 1)) {
            const centerR = r < 5 ? 1 : 8;
            moves.push({r: centerR, c: 4});
        }
    }
    return moves;
}

function getPalaceDiagonalPaths(r, c) {
    const paths = [];
    const isCenter = (r===1 && c===4) || (r===8 && c===4);
    
    if (isCenter) {
        paths.push([{r:r-1, c:c-1}]);
        paths.push([{r:r-1, c:c+1}]);
        paths.push([{r:r+1, c:c-1}]);
        paths.push([{r:r+1, c:c+1}]);
    } else {
        const centerR = r < 5 ? 1 : 8;
        const dr = centerR - r;
        const dc = 4 - c; 
        if (Math.abs(dr) === 1 && Math.abs(dc) === 1) {
            paths.push([
                {r: r + dr, c: c + dc},      
                {r: r + dr*2, c: c + dc*2}   
            ]);
        }
    }
    return paths;
}

export const calculateScore = (board) => {
    const points = {
        [PIECE_TYPE.CHARIOT]: 13,
        [PIECE_TYPE.CANNON]: 7,
        [PIECE_TYPE.HORSE]: 5,
        [PIECE_TYPE.ELEPHANT]: 3,
        [PIECE_TYPE.GUARD]: 3,
        [PIECE_TYPE.SOLDIER]: 2,
        [PIECE_TYPE.GENERAL]: 0,
    };

    let choScore = 0;
    let hanScore = 1.5; // Han gets 1.5 komi (dum)

    for (let r = 0; r < 10; r++) {
        for (let c = 0; c < 9; c++) {
            const piece = board[r][c];
            if (piece) {
                const score = points[piece.type] || 0;
                if (piece.team === TEAM.CHO) {
                    choScore += score;
                } else {
                    hanScore += score;
                }
            }
        }
    }

    return { cho: choScore, han: hanScore };
};
