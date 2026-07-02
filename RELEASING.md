# Releasing

Server and plugin live in one repo and share one version. Keep it boring and
repeatable.

## Versioning rule

Three tiers, encoded in the shared version:

- ALPHA: `0.0.x` — early, things may be unverified. Increment the patch.
- BETA: `0.x.0` — functional and in real-world testing, not yet declared
  stable. Increment the minor.
- RELEASE: `1.0.0` and up — verified stable. From here, normal semver: patch
  for fixes, minor for backward-compatible additions, major for breaking
  changes.

## Where the version lives

Bump all of these together (CI refuses a tag that does not match
`server/package.json`):

- `server/package.json` (and `package-lock.json` via `npm install`)
- `server/manifest.json`
- the `McpServer` version strings in `server/src/index.ts` and
  `server/src/stdio.ts`
- `plugins/totalmix/.claude-plugin/plugin.json`

## Release steps

1. Make the change, then in `server/`: `npm run typecheck`, `npm run build`,
   `npm run bundle` (the bundled plugin server is a committed artifact; CI
   fails if it is stale).
2. Bump the version everywhere listed above.
3. Move the `Unreleased` notes in `server/CHANGELOG.md` and/or
   `plugins/totalmix/CHANGELOG.md` under a new version heading with today's
   date.
4. Commit (signed), then tag:

   ```bash
   git add -A
   git commit -S -m "totalmix-mcp 0.6.0: <short summary>"
   git tag -s v0.6.0 -m "totalmix-mcp 0.6.0"
   git push --follow-tags
   ```

   Set the tag last, after all commits for the release are in, so it never
   needs a force update.
5. The release workflow builds `totalmix-mcp.mcpb` and `totalmix-skill.zip`
   on a macOS runner and attaches both to the GitHub release.

## Deploying the HTTP daemon

For hosts running the daemon as a systemd service (see `server/README.md`,
"Running as a systemd service"): sync `server/`, rebuild, then restart the
service:

```bash
sudo systemctl restart totalmix-mcp
```
