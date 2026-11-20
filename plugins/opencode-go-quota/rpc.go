package main

import (
	"context"
	"encoding/json"
	"time"
)

type envelope struct {
	OK     bool            `json:"ok"`
	Result json.RawMessage `json:"result,omitempty"`
	Error  *envelopeError  `json:"error,omitempty"`
}

type envelopeError struct {
	Code       string `json:"code"`
	Message    string `json:"message"`
	HTTPStatus int    `json:"http_status,omitempty"`
}

type registration struct {
	SchemaVersion uint32         `json:"schema_version"`
	Metadata      map[string]any `json:"metadata"`
	Capabilities  map[string]any `json:"capabilities"`
}

func registrationResult() registration {
	return registration{
		SchemaVersion: 1,
		Metadata: map[string]any{
			"Name":             "OpenCode Go",
			"Version":          pluginVersion,
			"Author":           "prox",
			"GitHubRepository": "https://github.com/yazinsai/prox",
			"ConfigFields":     []any{},
		},
		Capabilities: map[string]any{"quota_provider": true},
	}
}

// handleMethod dispatches one RPC call and returns the JSON envelope plus success.
func handleMethod(method string, payload []byte) ([]byte, bool) {
	switch method {
	case "plugin.register", "plugin.reconfigure":
		return okEnvelope(registrationResult())
	case "plugin.quiesce", "plugin.shutdown":
		return okEnvelope(struct{}{})
	case "quota.identifier":
		return okEnvelope(map[string]string{"identifier": quotaIdentifier})
	case "quota.describe":
		return okEnvelope(map[string]any{
			"supported_providers": []string{quotaIdentifier},
			"display_name":        "OpenCode Go",
			"supports_reset":      false,
		})
	case "quota.fetch":
		ctx, cancel := context.WithTimeout(context.Background(), 25*time.Second)
		defer cancel()
		resp, errFetch := fetchQuota(ctx, payload)
		if errFetch != nil {
			return errorEnvelope("quota_fetch_failed", errFetch.Error()), false
		}
		return okEnvelope(resp)
	case "quota.reset":
		return errorEnvelope("unsupported", "OpenCode Go usage cannot be reset"), false
	default:
		return errorEnvelope("unknown_method", "unknown method: "+method), false
	}
}

func okEnvelope(result any) ([]byte, bool) {
	raw, errMarshal := json.Marshal(result)
	if errMarshal != nil {
		return errorEnvelope("marshal_failed", errMarshal.Error()), false
	}
	out, _ := json.Marshal(envelope{OK: true, Result: raw})
	return out, true
}

func errorEnvelope(code, message string) []byte {
	raw, _ := json.Marshal(envelope{OK: false, Error: &envelopeError{Code: code, Message: message}})
	return raw
}
