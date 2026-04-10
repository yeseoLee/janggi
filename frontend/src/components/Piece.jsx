import React from 'react';
import './Piece.css';
import { FILE_PIECE_TYPE } from '../game/constants';

const Piece = ({ team, type, inverted, rotated }) => {
  const fileType = FILE_PIECE_TYPE[type];
  let suffix = '';
  if (inverted) suffix += 'h';
  if (rotated) suffix += 'r';
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
