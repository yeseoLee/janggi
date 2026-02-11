import { TEAM, PIECE_TYPE } from './constants';

export const getValidMoves = (board, r, c) => {
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

    // Add diagonal moves if in palace
    if (isInPalace(r, c)) {
      const palaceMoves = getPalaceDiagonalMoves(r, c);
      for (const move of palaceMoves) {
         // Creating a direction vector from the move
         // Actually palace diagonals are short. 
         // For Chariot/Cannon, they move along the diagonal lines ONLY if they are ON a line.
         // And they can move multiple steps if the line is long?
         // In Palace, max diagonal length is 2 steps (corner to corner).
         // Chariot can move corner->center->corner.
         // Cannon can jump corner->(center occupied)->corner.
         
         // Let's handle Palace Diagonals specially.
         // Currently simple iteration for orthogonal.
      }
    }
    
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
        // ... implement palace linear/jump logic ...
        // Simplification: hardcode diagonal paths in Palace.
    }
  };

  switch (type) {
    case PIECE_TYPE.GENERAL:
    case PIECE_TYPE.GUARD:
      // Move 1 step along lines in Palace.
      // 8 directions if in center.
      // Diagonals only if in corners or center.
      // Orthogonal always allowed within palace.
      getPalaceMoves(r, c).forEach(m => {
        if (isValidPos(m.r, m.c)) moves.push(m);
      });
      break;

    case PIECE_TYPE.HORSE:
      // L-move: 1 orthogonal + 1 diagonal
      // Blocked if orthogonal step is occupied.
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
      // Extended L-move: 1 orth + 2 diag
      // Blocked if orth or first diag is occupied.
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
       // Also Palace diagonal sliding
       if (isInPalace(r, c)) {
           // If at corner, can move to center or opposite corner.
           // If at center, can move to all 4 corners.
           // Need to handle "blocked" logic along diagonal.
           const diagonals = getPalaceDiagonalPaths(r, c);
           diagonals.forEach(path => {
               for (const pos of path) {
                   const target = board[pos.r][pos.c];
                   if (target) {
                       if (target.team !== team) moves.push(pos);
                       break;
                   } else {
                       moves.push(pos);
                   }
               }
           });
       }
       break;

    case PIECE_TYPE.CANNON:
       // Logic is complex for diagonal jumps in palace too.
       // addLinearMoves(true) handles orthogonal jumps.
       addLinearMoves(true);
       
       if (isInPalace(r, c)) {
           const diagonals = getPalaceDiagonalPaths(r, c);
            diagonals.forEach(path => {
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
           });
       }
       break;

    case PIECE_TYPE.SOLDIER:
      // Forward and Side.
      // Forward depends on team.
      // Side always allowed.
      // Diagonal forward allowed in Palace.
      {
         const dr = team === TEAM.HAN ? 1 : -1; // Han moves down (inc r), Cho moves up (dec r)
         // Forward
         addStepMove(dr, 0);
         // Side
         addStepMove(0, -1);
         addStepMove(0, 1);
         
         // Palace diagonal
         if (isInPalace(r, c)) {
             // Can move diagonally FORWARD only.
             // If at center (1,4) or (8,4), can move forward-diag to corners?
             // No, Soldier moves ALONG lines.
             // Start -> End.
             // corners -> center.
             // center -> forward corners.
             const palaceMoves = getPalaceMoves(r, c); 
             // checks if move is forward-diagonal
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


// Utils
function isInPalace(r, c) {
    if (c < 3 || c > 5) return false;
    if (r >= 0 && r <= 2) return true; // Top palace
    if (r >= 7 && r <= 9) return true; // Bottom palace
    return false;
}

function getPalaceMoves(r, c) {
    const moves = [];
    // Define moves based on position within palace
    // Corners can move to center (and orth).
    // Center can move to corners (and orth).
    // Orth moves handled by main logic? 
    // Wait, main logic for King/Guard uses this.
    
    // Orthogonal 1 step
    const dirs = [[-1,0], [1,0], [0,-1], [0,1]];
    dirs.forEach(([dr, dc]) => {
        const nr = r + dr, nc = c + dc;
        if (isInPalace(nr, nc)) moves.push({r:nr, c:nc});
    });
    
    // Diagonal
    // Top Palace center: 1, 4
    // Bottom Palace center: 8, 4
    const centers = [[1,4], [8,4]];
    const isCenter = centers.some(p => p[0] === r && p[1] === c);
    
    if (isCenter) {
        // Can move to all 4 corners
        const diags = [[-1,-1], [-1,1], [1,-1], [1,1]];
        diags.forEach(([dr, dc]) => {
            const nr = r + dr, nc = c + dc;
            // Bound check implicitly by geometric relation, but let's be safe
            if (isInPalace(nr, nc)) moves.push({r:nr, c:nc});
        });
    } else {
        // If on corner, can move to center
        // Corners: (0,3), (0,5), (2,3), (2,5)  and (7,3), (7,5), (9,3), (9,5)
        if ((Math.abs(r-1) === 1 && Math.abs(c-4) === 1) || (Math.abs(r-8) === 1 && Math.abs(c-4) === 1)) {
            // Yes, corner. Move to center.
            // Center is (1,4) or (8,4)
            const centerR = r < 5 ? 1 : 8;
            moves.push({r: centerR, c: 4});
        }
    }
    return moves;
}

function getPalaceDiagonalPaths(r, c) {
    // Returns array of paths (array of coords)
    // Only from corners passing through center.
    // Or from center to corners.
    const paths = [];
    const isCenter = (r===1 && c===4) || (r===8 && c===4);
    
    if (isCenter) {
        // 4 paths to corners (length 1)
        paths.push([{r:r-1, c:c-1}]);
        paths.push([{r:r-1, c:c+1}]);
        paths.push([{r:r+1, c:c-1}]);
        paths.push([{r:r+1, c:c+1}]);
    } else {
        // If corner, 1 path to opposite corner THROUGH center?
        // Yes, for sliding (Cha/Po).
        // e.g. (0,3) -> (1,4) -> (2,5).
        // Direction is fixed.
        // Identify which corner.
        const centerR = r < 5 ? 1 : 8;
        const dr = centerR - r; // 1 or -1
        const dc = 4 - c; // 1 or -1
        if (Math.abs(dr) === 1 && Math.abs(dc) === 1) {
            // Is corner
            paths.push([
                {r: r + dr, c: c + dc},      // Center
                {r: r + dr*2, c: c + dc*2}   // Opposite corner
            ]);
        }
    }
    return paths;
}
