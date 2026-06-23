package services

import (
	"bytes"
	"strings"
)

var utf8BOM = []byte{0xEF, 0xBB, 0xBF}

func StripUTF8BOMFromBytes(data []byte) []byte {
	return bytes.TrimPrefix(data, utf8BOM)
}

func StripUTF8BOMFromString(s string) string {
	return strings.TrimPrefix(s, "\ufeff")
}

func StripInvisibleRunes(s string) string {
	s = StripUTF8BOMFromString(s)
	return strings.Map(func(r rune) rune {
		switch r {
		case '\u200b', '\u200c', '\u200d', '\u2060', '\ufeff':
			return -1
		default:
			return r
		}
	}, s)
}
