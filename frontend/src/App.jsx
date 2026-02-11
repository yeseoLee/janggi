import { useState } from 'react'
import './App.css'
import Board from './components/Board'
import { TEAM } from './game/constants'

function App() {
  const [viewTeam, setViewTeam] = useState(TEAM.CHO);
  const [invertColor, setInvertColor] = useState(false);
  const [useRotatedPieces, setUseRotatedPieces] = useState(false);
  const [styleVariant, setStyleVariant] = useState('2'); // Default to '2' as requested

  return (
    <div className="App">
      <h1>Janggi (Korean Chess)</h1>
      
      <div className="controls">
        <div className="control-row">
          <label>
            View Point:
            <select value={viewTeam} onChange={(e) => setViewTeam(e.target.value)}>
              <option value={TEAM.CHO}>Cho (Blue)</option>
              <option value={TEAM.HAN}>Han (Red)</option>
            </select>
          </label>
          
          <label>
             Style:
             <select value={styleVariant} onChange={(e) => setStyleVariant(e.target.value)}>
               <option value="normal">Normal</option>
               <option value="2">Calligraphy 2</option>
             </select>
          </label>
        </div>

        <div className="control-row">
          <label>
            <input 
              type="checkbox" 
              checked={invertColor} 
              onChange={(e) => setInvertColor(e.target.checked)} 
            /> Invert Color
          </label>
          
          <label>
            <input 
              type="checkbox" 
              checked={useRotatedPieces} 
              onChange={(e) => setUseRotatedPieces(e.target.checked)} 
            /> Rotated Pieces (Opponent)
          </label>
        </div>
      </div>

      <Board 
        viewTeam={viewTeam}
        invertColor={invertColor}
        useRotatedPieces={useRotatedPieces}
        styleVariant={styleVariant}
      />
    </div>
  )
}

export default App
