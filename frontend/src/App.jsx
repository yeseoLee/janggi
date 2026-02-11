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
      <Board 
        viewTeam={viewTeam}
        setViewTeam={setViewTeam}
        invertColor={invertColor}
        setInvertColor={setInvertColor}
        useRotatedPieces={useRotatedPieces}
        setUseRotatedPieces={setUseRotatedPieces}
        styleVariant={styleVariant}
        setStyleVariant={setStyleVariant}
      />
    </div>
  )
}

export default App
