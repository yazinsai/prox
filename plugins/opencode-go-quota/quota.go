package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math"
	"net/http"
	"net/url"
	"strings"
	"time"
)

const (
	pluginID         = "opencode-go-quota"
	pluginVersion    = "0.1.0"
	quotaIdentifier  = "openai-compatible-opencode-go"
	defaultUsageURL  = "https://opencode.ai/zen/go/v1/usage"
	opencodeHost     = "opencode.ai"
	maxResponseBytes = 1 << 20
)

// quotaFetchRequest mirrors the fields of pluginapi.QuotaFetchRequest this plugin reads.
type quotaFetchRequest struct {
	AuthIndex  string            `json:"auth_index"`
	Provider   string            `json:"provider"`
	Attributes map[string]string `json:"attributes,omitempty"`
}

type usageWindow struct {
	Status   string   `json:"status"`
	Percent  *float64 `json:"percent"`
	ResetsAt string   `json:"resetsAt"`
}

type usageResponse struct {
	Usage map[string]usageWindow `json:"usage"`
}

type quotaBucket struct {
	Window            string  `json:"window,omitempty"`
	RemainingFraction float64 `json:"remainingFraction"`
	ResetTime         string  `json:"resetTime,omitempty"`
	Description       string  `json:"description,omitempty"`
}

type quotaGroup struct {
	DisplayName string        `json:"displayName,omitempty"`
	Buckets     []quotaBucket `json:"buckets,omitempty"`
}

type quotaSubscription struct {
	Plan     string `json:"plan,omitempty"`
	TierName string `json:"tierName,omitempty"`
}

type quotaFetchResponse struct {
	Subscription *quotaSubscription `json:"subscription,omitempty"`
	Groups       []quotaGroup       `json:"groups,omitempty"`
}

// Upstream window keys in display order, with the window names the dashboard
// already understands (5h and weekly get period-aware pacing).
var usageWindows = []struct {
	key, window, label string
}{
	{"rolling", "5h", "5-hour"},
	{"weekly", "weekly", "Weekly"},
	{"monthly", "monthly", "Monthly"},
}

// usageURLForBaseURL derives the usage endpoint from the configured inference base URL,
// e.g. https://opencode.ai/inference/go/openai/v1 -> https://opencode.ai/inference/go/v1/usage.
// Only opencode.ai hosts are accepted so the API key is never sent elsewhere.
func usageURLForBaseURL(baseURL string) (string, error) {
	baseURL = strings.TrimSpace(baseURL)
	if baseURL == "" {
		return defaultUsageURL, nil
	}
	parsed, errParse := url.Parse(baseURL)
	if errParse != nil || parsed.Scheme != "https" {
		return "", fmt.Errorf("unsupported base URL %q", baseURL)
	}
	host := strings.ToLower(parsed.Hostname())
	if host != opencodeHost && !strings.HasSuffix(host, "."+opencodeHost) {
		return "", fmt.Errorf("base URL host %q is not %s", host, opencodeHost)
	}
	segments := strings.Split(strings.Trim(parsed.Path, "/"), "/")
	for i, segment := range segments {
		if segment == "go" {
			prefix := strings.Join(segments[:i+1], "/")
			return fmt.Sprintf("https://%s/%s/v1/usage", parsed.Host, prefix), nil
		}
	}
	return "", fmt.Errorf("base URL %q is not an OpenCode Go endpoint", baseURL)
}

func buildQuotaResponse(raw []byte) (quotaFetchResponse, error) {
	var parsed usageResponse
	if errDecode := json.Unmarshal(raw, &parsed); errDecode != nil {
		return quotaFetchResponse{}, fmt.Errorf("decode usage response: %w", errDecode)
	}
	buckets := make([]quotaBucket, 0, len(usageWindows))
	for _, spec := range usageWindows {
		window, ok := parsed.Usage[spec.key]
		if !ok || window.Percent == nil {
			continue
		}
		remaining := 1 - *window.Percent/100
		if remaining < 0 {
			remaining = 0
		}
		if remaining > 1 {
			remaining = 1
		}
		if !strings.EqualFold(strings.TrimSpace(window.Status), "ok") && window.Status != "" {
			// A non-ok status (e.g. rate-limited) means the window is exhausted.
			remaining = 0
		}
		buckets = append(buckets, quotaBucket{
			Window:            spec.window,
			RemainingFraction: math.Round(remaining*10000) / 10000,
			ResetTime:         strings.TrimSpace(window.ResetsAt),
			Description:       spec.label,
		})
	}
	if len(buckets) == 0 {
		return quotaFetchResponse{}, errors.New("usage response contained no usage windows")
	}
	return quotaFetchResponse{
		Subscription: &quotaSubscription{Plan: "OpenCode Go", TierName: "Go"},
		Groups:       []quotaGroup{{DisplayName: "OpenCode Go", Buckets: buckets}},
	}, nil
}

var httpClient = &http.Client{
	Timeout:   20 * time.Second,
	Transport: &http.Transport{Proxy: http.ProxyFromEnvironment},
}

func fetchQuota(ctx context.Context, payload []byte) (quotaFetchResponse, error) {
	var req quotaFetchRequest
	if errDecode := json.Unmarshal(payload, &req); errDecode != nil {
		return quotaFetchResponse{}, fmt.Errorf("decode quota request: %w", errDecode)
	}
	apiKey := strings.TrimSpace(req.Attributes["api_key"])
	if apiKey == "" {
		return quotaFetchResponse{}, errors.New("credential has no API key")
	}
	usageURL, errURL := usageURLForBaseURL(req.Attributes["base_url"])
	if errURL != nil {
		return quotaFetchResponse{}, errURL
	}
	httpReq, errReq := http.NewRequestWithContext(ctx, http.MethodGet, usageURL, nil)
	if errReq != nil {
		return quotaFetchResponse{}, errReq
	}
	httpReq.Header.Set("Authorization", "Bearer "+apiKey)
	httpReq.Header.Set("Accept", "application/json")
	resp, errDo := httpClient.Do(httpReq)
	if errDo != nil {
		return quotaFetchResponse{}, fmt.Errorf("usage request failed: %w", errDo)
	}
	defer func() { _ = resp.Body.Close() }()
	body, errRead := io.ReadAll(io.LimitReader(resp.Body, maxResponseBytes))
	if errRead != nil {
		return quotaFetchResponse{}, fmt.Errorf("read usage response: %w", errRead)
	}
	if resp.StatusCode != http.StatusOK {
		return quotaFetchResponse{}, fmt.Errorf("usage endpoint returned HTTP %d", resp.StatusCode)
	}
	return buildQuotaResponse(body)
}
