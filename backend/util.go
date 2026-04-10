package main

import (
	"encoding/json"
	"math"
	"strconv"
	"strings"
)

func itoa(value int) string {
	return strconv.Itoa(value)
}

func toString(value any) string {
	switch typed := value.(type) {
	case string:
		return typed
	case []byte:
		return string(typed)
	default:
		return ""
	}
}

func toInt(value any) (int, bool) {
	switch typed := value.(type) {
	case int:
		return typed, true
	case int8:
		return int(typed), true
	case int16:
		return int(typed), true
	case int32:
		return int(typed), true
	case int64:
		return int(typed), true
	case uint:
		return int(typed), true
	case uint8:
		return int(typed), true
	case uint16:
		return int(typed), true
	case uint32:
		return int(typed), true
	case uint64:
		return int(typed), true
	case float32:
		if math.IsNaN(float64(typed)) || math.IsInf(float64(typed), 0) {
			return 0, false
		}
		return int(typed), true
	case float64:
		if math.IsNaN(typed) || math.IsInf(typed, 0) {
			return 0, false
		}
		return int(typed), true
	case json.Number:
		parsed, err := typed.Int64()
		if err != nil {
			floatValue, floatErr := typed.Float64()
			if floatErr != nil || math.IsNaN(floatValue) || math.IsInf(floatValue, 0) {
				return 0, false
			}
			return int(floatValue), true
		}
		return int(parsed), true
	case string:
		trimmed := strings.TrimSpace(typed)
		if trimmed == "" {
			return 0, false
		}
		parsed, err := strconv.Atoi(trimmed)
		if err != nil {
			floatValue, floatErr := strconv.ParseFloat(trimmed, 64)
			if floatErr != nil || math.IsNaN(floatValue) || math.IsInf(floatValue, 0) {
				return 0, false
			}
			return int(floatValue), true
		}
		return parsed, true
	default:
		return 0, false
	}
}
