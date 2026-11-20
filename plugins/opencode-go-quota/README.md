# opencode-go-quota

CLIProxyAPI quota plugin that shows OpenCode Go subscription usage (rolling
5-hour, weekly, and monthly windows) on the dashboard's Quota page.

It serves `openai-compatibility` API keys whose group is named `opencode-go`
(provider key `openai-compatible-opencode-go`) and whose `base-url` is an
`opencode.ai/.../go/...` endpoint. For a base URL such as
`https://opencode.ai/inference/go/openai/v1` it calls
`GET https://opencode.ai/inference/go/v1/usage` with the key. OpenCode doesn't
document that endpoint, so it may change.

The plugin uses only the C ABI and its JSON envelopes, so the backend fork
needs no changes.

## Build and install

`bun run sync:local` builds it and installs it as
`~/.config/cliproxyapi/plugins/opencode-go-quota-v0.0.<timestamp>.dylib`. It then
updates a marker comment in `config.yaml`, so the proxy hot-swaps the plugin
without restarting.

Enable it in `config.yaml`:

```yaml
plugins:
    enabled: true
    dir: "~/.config/cliproxyapi/plugins"
    configs:
        opencode-go-quota:
            enabled: true
            priority: 1
```
