package domain

const (
	TeamCho = "cho"
	TeamHan = "han"

	GupSuffix = "\uAE09"
	DanSuffix = "\uB2E8"

	DefaultAITier = 0

	BoardRows = 10
	BoardCols = 9

	EloKFactor       = 32
	EloDefaultRating = 1000
	EloMinRating     = 100

	MainThinkingTimeMS      = 5 * 60 * 1000
	ByoyomiTimeMS           = 30 * 1000
	ByoyomiPeriods          = 3
	SetupSelectionTimeoutMS = 20 * 1000
)

type Position struct {
	R int `json:"r"`
	C int `json:"c"`
}

type MovePayload struct {
	From Position `json:"from"`
	To   Position `json:"to"`
}

type MoveLogEvent struct {
	Type string    `json:"type"`
	Turn string    `json:"turn"`
	From *Position `json:"from,omitempty"`
	To   *Position `json:"to,omitempty"`
	At   string    `json:"at"`
}

type TeamClock struct {
	MainMS         int `json:"mainMs"`
	ByoyomiPeriods int `json:"byoyomiPeriods"`
}

type ParsedRank struct {
	Type  string
	Value int
}

type RankState struct {
	Rank       string `json:"rank"`
	RankWins   int    `json:"rankWins"`
	RankLosses int    `json:"rankLosses"`
}

type AILevel struct {
	Tier             int    `json:"tier"`
	Label            string `json:"label"`
	SkillLevel       int    `json:"skillLevel"`
	UseLimitStrength bool   `json:"useLimitStrength"`
	UCIElo           *int   `json:"uciElo"`
	MoveTimeMS       int    `json:"moveTimeMs"`
	Depth            int    `json:"depth"`
}

type AIUnlockState struct {
	PreviousUnlockedTier int  `json:"previousUnlockedTier"`
	UnlockedTier         int  `json:"unlockedTier"`
	Unlocked             bool `json:"unlocked"`
	JustUnlockedTier     *int `json:"justUnlockedTier"`
}
