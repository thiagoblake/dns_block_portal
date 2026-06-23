package services

import (
	"net"
	"net/url"
	"regexp"
	"strings"
)

var domainPattern = regexp.MustCompile(`^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}\.$`)

type NormalizeResult struct {
	Original         string `json:"original"`
	Normalized       string `json:"normalized"`
	IsValid          bool   `json:"is_valid"`
	Error            string `json:"error,omitempty"`
	IsDuplicate      bool   `json:"is_duplicate"`
	PreexistingNote  string `json:"preexisting_note,omitempty"`
}

func NormalizeDomain(input string) (string, string) {
	value := StripInvisibleRunes(strings.TrimSpace(strings.ToLower(input)))
	if value == "" {
		return "", "empty domain"
	}
	if strings.Contains(value, "<script") || strings.Contains(value, ">") {
		return "", "invalid html/script content"
	}

	if strings.HasPrefix(value, "http://") || strings.HasPrefix(value, "https://") {
		parsed, err := url.Parse(value)
		if err == nil {
			value = parsed.Host
		}
	}
	value = strings.Split(value, "/")[0]
	value = strings.Split(value, "?")[0]
	value = strings.Split(value, "#")[0]
	value = strings.TrimPrefix(value, "*.")
	value = strings.TrimPrefix(value, "www.")
	value = strings.TrimSuffix(value, ".")

	if value == "" || value == "localhost" {
		return "", "invalid domain"
	}
	if strings.Contains(value, " ") || strings.Contains(value, "..") || strings.HasPrefix(value, ".") {
		return "", "invalid format"
	}
	if net.ParseIP(value) != nil {
		return "", "ip address not allowed"
	}
	if !strings.Contains(value, ".") {
		return "", "domain must contain dot"
	}

	normalized := value + "."
	if !domainPattern.MatchString(normalized) {
		return "", "invalid domain syntax"
	}
	return normalized, ""
}

