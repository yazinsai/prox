package main

import (
	"encoding/json"
	"testing"
)

func TestUsageURLForBaseURL(t *testing.T) {
	cases := map[string]string{
		"https://opencode.ai/inference/go/openai/v1": "https://opencode.ai/inference/go/v1/usage",
		"https://opencode.ai/zen/go/v1":              "https://opencode.ai/zen/go/v1/usage",
		"":                                           defaultUsageURL,
	}
	for in, want := range cases {
		got, err := usageURLForBaseURL(in)
		if err != nil || got != want {
			t.Fatalf("usageURLForBaseURL(%q) = %q, %v; want %q", in, got, err, want)
		}
	}
	for _, bad := range []string{
		"https://evil.example/zen/go/v1",
		"http://opencode.ai/zen/go/v1",
		"https://opencode.ai.evil.example/zen/go/v1",
		"https://opencode.ai/zen/v1",
	} {
		if _, err := usageURLForBaseURL(bad); err == nil {
			t.Fatalf("usageURLForBaseURL(%q) should fail", bad)
		}
	}
}

func TestBuildQuotaResponse(t *testing.T) {
	raw := []byte(`{"usage":{"rolling":{"status":"ok","percent":2,"resetsAt":"2026-11-20T07:25:05.000Z"},` +
		`"weekly":{"status":"ok","percent":105,"resetsAt":"2026-11-23T00:00:00.000Z"},` +
		`"monthly":{"status":"limited","percent":40,"resetsAt":"2026-12-07T02:24:59.000Z"}}}`)
	resp, err := buildQuotaResponse(raw)
	if err != nil {
		t.Fatal(err)
	}
	buckets := resp.Groups[0].Buckets
	if len(buckets) != 3 {
		t.Fatalf("got %d buckets", len(buckets))
	}
	if buckets[0].Window != "5h" || buckets[0].RemainingFraction != 0.98 {
		t.Fatalf("rolling bucket = %+v", buckets[0])
	}
	if buckets[1].RemainingFraction != 0 {
		t.Fatalf("over-limit weekly should clamp to 0, got %v", buckets[1].RemainingFraction)
	}
	if buckets[2].RemainingFraction != 0 {
		t.Fatalf("non-ok monthly should be exhausted, got %v", buckets[2].RemainingFraction)
	}
	if _, err := buildQuotaResponse([]byte(`{"usage":{}}`)); err == nil {
		t.Fatal("empty usage should fail")
	}
}

func TestHandleMethodRegistration(t *testing.T) {
	raw, ok := handleMethod("plugin.register", nil)
	if !ok {
		t.Fatal("register failed")
	}
	var env struct {
		OK     bool `json:"ok"`
		Result struct {
			Capabilities map[string]bool `json:"capabilities"`
		} `json:"result"`
	}
	if err := json.Unmarshal(raw, &env); err != nil || !env.OK || !env.Result.Capabilities["quota_provider"] {
		t.Fatalf("bad registration: %s", raw)
	}
	if _, ok := handleMethod("quota.fetch", []byte(`{"attributes":{}}`)); ok {
		t.Fatal("fetch without api key should fail")
	}
}
