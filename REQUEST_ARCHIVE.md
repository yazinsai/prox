# Local request archive

Full request capture runs in the proxy backend, independently of this dashboard.
The backend source is the `backend/` git submodule (`main`, based on v8.0.56).
The backend fork is https://github.com/yazinsai/prox-backend.
See [the backend operational guide](https://github.com/yazinsai/prox-backend/blob/main/docs/request-archive.md) for
implementation details, search/export commands, limitations, and rollback.

The local service is configured with full request logging enabled and
`CLI_PROXY_REQUEST_ARCHIVE=1`. Completed exchanges are retained as lossless
`*.log.zst` records in `~/.config/cliproxyapi/logs/`. The indexer losslessly
optimizes completed records into shared Zstandard chunks and compressed manifests
under `request-chunks/` and `request-records/`, retaining their original logical
names and verifying complete-record SHA-256 digests before removing old sources.
Repeated images, conversation context, and upstream attempts share their unchanged
bytes. Manifests and chunks are packed to avoid small-file allocation overhead.
Back up both directories together, including `request-chunks/dictionaries/` when
trained dictionaries are active; they contain the authoritative payloads.
A persistent Python 3.14 indexer maintains `request-index.sqlite3` there without
copying bodies into SQLite.
Archive files do not expire automatically. Management credentials remain excluded,
and sensitive authentication headers keep the backend's existing masking.

The dashboard's request-log download action reconstructs complete archived records,
including legacy standalone files and 100-record ZIP packs during migration. Search
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

## Dashboard reporting

The dashboard's **Request archive** section reads the authenticated v8 endpoint
`GET /v8/management/observability/archive`. It reports verified records, compressed
archive storage, space saved, daily completed exchanges, last archive time, indexer
heartbeat, available disk space, and process-scoped recording errors. Counts are
from the verified SQLite index and may lag completed files by one scan. Storage
savings compare full log bytes with compressed archive bytes; index overhead is
shown separately. Activity uses UTC days; timestamps use your browser's locale.

The indexer publishes `request-archive-stats.json` atomically every ten seconds.
The proxy reads only this bounded metadata file; it neither scans payloads nor
adds a SQLite driver to the Go backend. No archive bodies or credentials are
returned by the statistics endpoint. The dashboard refreshes every fifteen seconds
while visible and clears results when connections change.

**Recording** means recording is enabled and the indexer has reported within a
minute. It does not promise crash-proof or fail-closed capture. An idle archive
can be healthy. Paused recording, missing/invalid/stale snapshots, indexing errors,
and low disk space have distinct states. Recording errors count failed exchange
finalizations since the running proxy started. A stale snapshot is explicitly
labelled; missing reporting never becomes a fabricated zero count.

## Keeping the forks in sync

Use **Actions → Sync upstream → Run workflow** in each repository:

- [Backend sync](https://github.com/yazinsai/prox-backend/actions/workflows/sync-upstream.yml)
- [Dashboard sync](https://github.com/yazinsai/prox/actions/workflows/sync-upstream.yml)

The workflow merges upstream `main` into a uniquely named branch. It stops on
conflicts or test failures and leaves `main` and the running application alone.
Backend sync runs archive regressions, race checks, Python index tests, and the Go
build. Dashboard sync runs `bun run verify`. Successful runs open a pull request
for review. Nothing auto-merges or installs. These are manual workflows; no
background update schedule has been enabled.

Keep local UI work committed before pulling a merged update. The workflow works
on GitHub and never stashes, resets, or touches your local working directory.
The backend's `tools/archive-upstream-base` records the included upstream commit;
`tools/build-archive.sh /tmp/cli-proxy-api` embeds it into the build so the dashboard
shows which upstream base is actually running. Rebuild and install the fork after
merging; downloading a stock upstream binary removes archive support.

The backend fork's inherited `agents-md-guard`, `translator-path-guard`, and
`auto-retarget-main-pr-to-dev` workflows implement upstream's contribution policy,
not fork compatibility checks. They should stay disabled in this fork: legitimate
upstream updates can change those paths, and fork sync PRs intentionally target
`main`. Archive regression/build checks remain enabled. Fork workflow permissions
must allow the sync workflow to create pull requests.

The complete upstream Go suite is still useful before deployment. It currently
has unrelated failures in the byte-write audit, media-relay integration, and service
heartbeat tests. The dedicated archive checks are a focused compatibility gate;
they do not certify every upstream behavior.
