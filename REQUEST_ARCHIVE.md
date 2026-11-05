# Local request archive

Full request capture runs in the proxy backend, independently of this dashboard.
The backend source is in `../CLIProxyAPI`, on `main`, based on v8.0.56.
The backend fork is https://github.com/yazinsai/CLIProxyAPI.
See [the backend operational guide](https://github.com/yazinsai/CLIProxyAPI/blob/main/docs/request-archive.md) for
implementation details, search/export commands, limitations, and rollback.

The local service is configured with full request logging enabled and
`CLI_PROXY_REQUEST_ARCHIVE=1`. Completed exchanges are retained as lossless
`*.log.zst` records in `~/.config/cliproxyapi/logs/`. A persistent Python 3.14
indexer maintains `request-index.sqlite3` there without copying bodies into SQLite.
Archive files do not expire automatically. Management credentials remain excluded,
and sensitive authentication headers keep the backend's existing masking.

The dashboard's request-log download action also reads archived records. Search
and export are currently available through the backend's archive CLI; there is no
new dashboard search page.

The proxy binary and launch-agent configuration are local installations. An upstream
binary upgrade must preserve/reapply the backend archive changes. Original binary,
configuration, and proxy launch agent are backed up under
`~/.local/share/cliproxyapi/backups/before-request-archive-20261105143904/`.

Verification: focused backend tests, focused archive race tests, Python index tests,
Go build, isolated/live HTTP capture, header masking, and archived downloads passed.
The full backend test run failed an existing byte-write audit in
`internal/kvstore/bolt_store.go`. The broader management race run also exposed a
race in the existing targeted OAuth test. Neither failure involves archive code.
No frontend source changed for this feature; frontend/browser checks were not run.

## Check that recording is running

```sh
launchctl list | rg 'com.local.cliproxyapi'
ls -lt ~/.config/cliproxyapi/logs/*.log.zst | head -3
sqlite3 ~/.config/cliproxyapi/logs/request-index.sqlite3 \
  "SELECT count(*) AS records, datetime(max(modified_ns)/1000000000, 'unixepoch', 'localtime') AS latest_record FROM records;"
```

Both launch agents should have a numeric PID in the first column. A dash means the
job is stopped. After an API request completes, a new `.log.zst` should appear; its
index row should appear within about ten seconds. No new records while idle is normal.
The archive indexer diagnostics are in
`~/.local/share/cliproxyapi/logs/request-index-stderr.log`.

Both agents start automatically at login and restart if they exit. A stock upstream
proxy binary does not implement the local archive feature; keep using the fork.
