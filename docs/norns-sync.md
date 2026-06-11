# Syncing the norns package

This repository is the source of truth for the norns code under `norns/`.
The `murmuration-norns` repository is intended to be the maiden-installable package.

## Destination repository

Create this repository on GitHub:

```text
https://github.com/Seinzu/murmuration-norns
```

Its default branch should be `main`. It can start empty.

## GitHub secret

The workflow in `.github/workflows/sync-norns.yml` needs a token which can push to `Seinzu/murmuration-norns`.

Create a fine-grained GitHub personal access token with write access to the `murmuration-norns` repository, then add it to `Seinzu/murmuration` as:

```text
COPYBARA_GITHUB_TOKEN
```

## What gets synced

Copybara takes:

```text
norns/**
```

and moves it to the root of `murmuration-norns`, producing:

```text
murmuration.lua
README.md
lib/boids.lua
lib/Engine_Murmuration.sc
```

The workflow runs on pushes to `main` that change `norns/**`, `copy.bara.sky`, or the workflow itself. It can also be run manually from GitHub Actions.

## Maiden install

Once synced, install on norns with:

```text
;install https://github.com/Seinzu/murmuration-norns
```

Restart norns after install so the SuperCollider engine is registered.
