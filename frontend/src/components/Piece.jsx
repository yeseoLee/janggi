import React from 'react';
import './Piece.css';
import { FILE_PIECE_TYPE } from '../game/constants';

const Piece = ({ team, type, variant, styleVariant, inverted, rotated }) => {
  // Construct filename: team + type + (styleVariant ? styleVariant : '') + (inverted ? 'h' : '') + (rotated ? 'r' : '') + '.svg'
  // User spec: "2", "h2", "hr2", "r2" are suffixes.
  // Actually, the file list is like:
  // chacha.svg, chacha2.svg, chachah.svg, chachah2.svg, chachahr.svg, chachahr2.svg, chachar.svg, chachar2.svg
  // So the order seems to be: team + type + (inverted 'h' ?) + (rotated 'r' ?) + (style '2' ?).
  // Let's check file list again from previous step.
  // chocha.svg
  // chocha2.svg
  // chochah.svg
  // chochah2.svg
  // chochahr.svg
  // chochahr2.svg
  // chochar.svg
  // chochar2.svg
  
  // It seems 'h' and 'r' come before '2'.
  // e.g. chochahr2.svg -> cho + cha + h + r + 2
  // But wait, is it always that order?
  // cho + cha + h + 2 -> chochah2.svg. Yes.
  // cho + cha + r + 2 -> chochar2.svg. Yes.
  
  // So the suffix construction is:
  // let suffix = '';
  // if (inverted) suffix += 'h';
  // if (rotated) suffix += 'r';
  // if (styleVariant === '2') suffix += '2';
  
  const fileType = FILE_PIECE_TYPE[type];
  let suffix = '';
  if (inverted) suffix += 'h';
  if (rotated) suffix += 'r';
  if (styleVariant === '2') suffix += '2';
  
  const filename = `${team}${fileType}${suffix}.svg`;
  
  return (
    <div className={`piece ${team} ${type}`}>
       <img 
         src={`/assets/pieces/${filename}`} 
         alt={`${team} ${type}`} 
         draggable={false}
       />
    </div>
  );
};

export default Piece;
