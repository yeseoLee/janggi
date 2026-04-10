package main

import "testing"

func createEmptyBoard() [][]map[string]any {
	board := make([][]map[string]any, boardRows)
	for r := range board {
		board[r] = make([]map[string]any, boardCols)
	}
	return board
}

func createStartBoard() [][]map[string]any {
	board := createEmptyBoard()

	board[0][0] = map[string]any{"team": teamHan, "type": "cha"}
	board[0][1] = map[string]any{"team": teamHan, "type": "ma"}
	board[0][2] = map[string]any{"team": teamHan, "type": "sang"}
	board[0][3] = map[string]any{"team": teamHan, "type": "sa"}
	board[0][5] = map[string]any{"team": teamHan, "type": "sa"}
	board[0][6] = map[string]any{"team": teamHan, "type": "sang"}
	board[0][7] = map[string]any{"team": teamHan, "type": "ma"}
	board[0][8] = map[string]any{"team": teamHan, "type": "cha"}
	board[1][4] = map[string]any{"team": teamHan, "type": "wang"}
	board[2][1] = map[string]any{"team": teamHan, "type": "po"}
	board[2][7] = map[string]any{"team": teamHan, "type": "po"}
	board[3][0] = map[string]any{"team": teamHan, "type": "jol"}
	board[3][2] = map[string]any{"team": teamHan, "type": "jol"}
	board[3][4] = map[string]any{"team": teamHan, "type": "jol"}
	board[3][6] = map[string]any{"team": teamHan, "type": "jol"}
	board[3][8] = map[string]any{"team": teamHan, "type": "jol"}

	board[6][0] = map[string]any{"team": teamCho, "type": "jol"}
	board[6][2] = map[string]any{"team": teamCho, "type": "jol"}
	board[6][4] = map[string]any{"team": teamCho, "type": "jol"}
	board[6][6] = map[string]any{"team": teamCho, "type": "jol"}
	board[6][8] = map[string]any{"team": teamCho, "type": "jol"}
	board[7][1] = map[string]any{"team": teamCho, "type": "po"}
	board[7][7] = map[string]any{"team": teamCho, "type": "po"}
	board[8][4] = map[string]any{"team": teamCho, "type": "wang"}
	board[9][0] = map[string]any{"team": teamCho, "type": "cha"}
	board[9][1] = map[string]any{"team": teamCho, "type": "ma"}
	board[9][2] = map[string]any{"team": teamCho, "type": "sang"}
	board[9][3] = map[string]any{"team": teamCho, "type": "sa"}
	board[9][5] = map[string]any{"team": teamCho, "type": "sa"}
	board[9][6] = map[string]any{"team": teamCho, "type": "sang"}
	board[9][7] = map[string]any{"team": teamCho, "type": "ma"}
	board[9][8] = map[string]any{"team": teamCho, "type": "cha"}

	return board
}

func TestBoardToJanggiFEN(t *testing.T) {
	fen, err := boardToJanggiFEN(createStartBoard(), teamCho)
	if err != nil {
		t.Fatalf("boardToJanggiFEN returned error: %v", err)
	}

	want := "rnba1abnr/4k4/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/4K4/RNBA1ABNR w - - 0 1"
	if fen != want {
		t.Fatalf("expected %q, got %q", want, fen)
	}
}

func TestParseEngineMove(t *testing.T) {
	move := parseEngineMove("a10a9")
	if move == nil || move.From != (position{R: 0, C: 0}) || move.To != (position{R: 1, C: 0}) {
		t.Fatalf("unexpected move: %#v", move)
	}

	move = parseEngineMove("i1g1")
	if move == nil || move.From != (position{R: 9, C: 8}) || move.To != (position{R: 9, C: 6}) {
		t.Fatalf("unexpected move: %#v", move)
	}
}

func TestParseEngineMoveInvalid(t *testing.T) {
	for _, value := range []string{"(none)", "0000", "bad-move"} {
		if move := parseEngineMove(value); move != nil {
			t.Fatalf("expected nil for %q, got %#v", value, move)
		}
	}
}

func TestIsValidBoardState(t *testing.T) {
	board := make([]any, boardRows)
	startBoard := createStartBoard()
	for idx := range startBoard {
		row := make([]any, len(startBoard[idx]))
		for col := range startBoard[idx] {
			if startBoard[idx][col] == nil {
				row[col] = nil
			} else {
				row[col] = startBoard[idx][col]
			}
		}
		board[idx] = row
	}

	if !isValidBoardState(board) {
		t.Fatal("expected valid board")
	}

	row := board[0].([]any)
	row[0] = map[string]any{"team": teamHan, "type": "invalid_piece"}
	if isValidBoardState(board) {
		t.Fatal("expected invalid board")
	}
}

func TestClampDepth(t *testing.T) {
	if got := clampDepth(nil, 8); got != 8 {
		t.Fatalf("expected 8, got %d", got)
	}
	if got := clampDepth("5", 8); got != 5 {
		t.Fatalf("expected 5, got %d", got)
	}
	if got := clampDepth(0, 8); got != 1 {
		t.Fatalf("expected 1, got %d", got)
	}
	if got := clampDepth(45, 8); got != 30 {
		t.Fatalf("expected 30, got %d", got)
	}
}
